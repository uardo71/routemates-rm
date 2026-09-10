import { addDays, parseISO } from "date-fns";
import { Prisma, type LeaveType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfWeek, toDateParam } from "@/lib/week";
import { isWorkingDay, walkVacationBalance } from "@/lib/vacation-calc";
import { computeHourlyCostRateEUR } from "@/lib/cost-rate";

// This module (deliberately still named "vacation" — the original leave type, and the only one
// with entitlement/balance math) now backs all LeaveTypes: VACATION, SICK, PATERNITY, MATERNITY.
export { ANNUAL_VACATION_ENTITLEMENT, countWorkingDays, entitlementForYear, isWorkingDay } from "@/lib/vacation-calc";

const STANDARD_WORKDAY_HOURS = 8;

// Only VACATION has an entitlement/balance concept (computeVacationBalance below) — SICK is
// uncapped/just tracked (see countApprovedLeaveDays), and PATERNITY/MATERNITY are one-time
// per-event periods with no annual quota at all. Each still gets its own dedicated milestone so
// they're distinguishable from each other and from real billable work in Planner/reports.
const LEAVE_MILESTONE_NAME: Record<LeaveType, string> = {
  VACATION: "Vacation",
  SICK: "Sick Leave",
  PATERNITY: "Paternity Leave",
  MATERNITY: "Maternity Leave",
};

export type VacationBalance = {
  year: number;
  joinDate: Date;
  entitlement: number;
  carriedIn: number;
  taken: number;
  balance: number;
};

/** Balance is computed live (not materialized) by walking every year from the person's join
 *  year up to `asOfYear`, since carryover is uncapped and depends on every prior year's usage.
 *  A request spanning a year boundary (e.g. Dec 24 - Jan 2) is attributed entirely to its
 *  *start* date's year — a deliberate simplification matching common payroll practice, rather
 *  than splitting one request's days across the boundary. VACATION only — SICK/PATERNITY/
 *  MATERNITY have no entitlement to balance against. */
export async function computeVacationBalance(userId: string, asOfYear?: number): Promise<VacationBalance> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { employment: true },
  });
  const joinDate = user.employment?.startDate ?? user.createdAt;
  const targetYear = asOfYear ?? new Date().getFullYear();

  // Manual opening balance (set by an admin for people onboarded onto the app mid-life, with no
  // historical LeaveRequests to walk). When present, the walk starts at that year seeded with the
  // entered days — everything before it is captured by that one number rather than re-derived —
  // and every year from the baseline on grants the full annual entitlement (an established
  // employee, so no first-year proration off the hire date).
  const openingDays = user.employment?.carriedInVacationDays;
  const openingYear = user.employment?.carriedInVacationYear ?? null;

  const approved = await prisma.leaveRequest.findMany({
    where: { userId, type: "VACATION", status: "APPROVED" },
    select: { startDate: true, workingDays: true },
  });
  const takenByYear = new Map<number, number>();
  for (const r of approved) {
    const y = r.startDate.getFullYear();
    takenByYear.set(y, (takenByYear.get(y) ?? 0) + Number(r.workingDays));
  }

  const walk = walkVacationBalance({
    joinDate,
    openingDays: openingDays != null ? Number(openingDays) : null,
    openingYear,
    asOfYear: targetYear,
    takenByYear: (y) => takenByYear.get(y) ?? 0,
  });
  return { ...walk, joinDate };
}

/** SICK has no balance/entitlement — just a running total, for record-keeping / visibility. */
export async function countApprovedLeaveDays(userId: string, type: LeaveType, year?: number): Promise<number> {
  const targetYear = year ?? new Date().getFullYear();
  const rows = await prisma.leaveRequest.findMany({
    where: { userId, type, status: "APPROVED" },
    select: { startDate: true, workingDays: true },
  });
  return rows
    .filter((r) => r.startDate.getFullYear() === targetYear)
    .reduce((sum, r) => sum + Number(r.workingDays), 0);
}

/** Creates (or reuses) a non-billable milestone (named per LeaveType) under `projectId`, and an
 *  assignment for `userId` on it — Assignment's unique (milestoneId, userId) constraint means a
 *  second leave period of the same type approved under the same project naturally lands on the
 *  same assignment, so this widens its date range instead of colliding. */
async function ensureLeaveAssignment(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
  type: LeaveType,
  startDate: Date,
  endDate: Date
) {
  const milestoneName = LEAVE_MILESTONE_NAME[type];
  let milestone = await tx.milestone.findFirst({ where: { projectId, name: milestoneName } });
  if (!milestone) {
    milestone = await tx.milestone.create({
      data: {
        projectId,
        name: milestoneName,
        billable: false,
        salesPrice: 0,
        cost: 0,
        status: "ACTIVE",
        timeEntryOpen: true,
      },
    });
  }

  const employment = await tx.employment.findUnique({ where: { userId } });
  const costRate = employment ? employment.costRate : 0;

  const existing = await tx.assignment.findUnique({
    where: { milestoneId_userId: { milestoneId: milestone.id, userId } },
  });
  if (existing) {
    const widenedStart = existing.startDate < startDate ? existing.startDate : startDate;
    const widenedEnd = existing.endDate > endDate ? existing.endDate : endDate;
    if (widenedStart.getTime() !== existing.startDate.getTime() || widenedEnd.getTime() !== existing.endDate.getTime()) {
      return tx.assignment.update({ where: { id: existing.id }, data: { startDate: widenedStart, endDate: widenedEnd } });
    }
    return existing;
  }
  return tx.assignment.create({
    data: { milestoneId: milestone.id, userId, costRate, status: "ACTIVE", startDate, endDate },
  });
}

/** Approves a leave request (any LeaveType): ensures the type-specific leave assignment under
 *  `projectId`, plans the working days onto AssignmentPlan, and writes pre-APPROVED TimeCard/
 *  TimeEntry rows for every working day in range — so the time off shows up as planned AND
 *  logged without the employee doing anything. `approverId` is credited as both the leave
 *  decider and the time cards' approver. */
export type LeaveApprovedHook = (tx: Prisma.TransactionClient, before: Record<string, unknown>, after: Record<string, unknown>) => Promise<void>;

export async function provisionLeave(leaveRequestId: string, projectId: string, approverId: string, onApproved?: LeaveApprovedHook): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const request = await tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } });
      const milestoneName = LEAVE_MILESTONE_NAME[request.type];

      const assignment = await ensureLeaveAssignment(tx, projectId, request.userId, request.type, request.startDate, request.endDate);

      const weekHours = new Map<string, number>();
      const dayEntries: { date: Date; hours: number }[] = [];
      for (let d = new Date(request.startDate); d <= request.endDate; d = addDays(d, 1)) {
        if (!isWorkingDay(d)) continue;
        const weekKey = toDateParam(startOfWeek(d));
        weekHours.set(weekKey, (weekHours.get(weekKey) ?? 0) + STANDARD_WORKDAY_HOURS);
        dayEntries.push({ date: new Date(d), hours: STANDARD_WORKDAY_HOURS });
      }

      // Additive — a week that already holds other planned hours (e.g. from a previous
      // overlapping leave batch on this same assignment) keeps them.
      for (const [weekKey, hours] of weekHours) {
        // parseISO (not the native Date constructor) to match parseDateParam's local-time
        // interpretation of date-only strings elsewhere — the native constructor treats
        // "yyyy-MM-dd" as UTC, which drifts a couple hours off local-midnight in non-UTC
        // server timezones and silently misses the weekStartDate lookups pages rely on.
        const weekStart = parseISO(weekKey);
        // Leave assignments never carry tasks, so these are always assignment-level rows
        // (taskId null). findFirst + update/create instead of upsert, since Prisma can't take a
        // null in a compound-unique where.
        const existing = await tx.assignmentPlan.findFirst({
          where: { assignmentId: assignment.id, taskId: null, weekStartDate: weekStart },
        });
        if (existing) {
          await tx.assignmentPlan.update({ where: { id: existing.id }, data: { hours: { increment: hours } } });
        } else {
          await tx.assignmentPlan.create({ data: { assignmentId: assignment.id, taskId: null, weekStartDate: weekStart, hours } });
        }
      }

      const entriesByWeek = new Map<string, { date: Date; hours: number }[]>();
      for (const e of dayEntries) {
        const weekKey = toDateParam(startOfWeek(e.date));
        const list = entriesByWeek.get(weekKey) ?? [];
        list.push(e);
        entriesByWeek.set(weekKey, list);
      }

      const now = new Date();
      for (const [weekKey, entries] of entriesByWeek) {
        const card = await tx.timeCard.create({
          data: {
            userId: request.userId,
            assignmentId: assignment.id,
            milestoneId: assignment.milestoneId,
            weekStartDate: parseISO(weekKey),
            status: "APPROVED",
            submittedAt: now,
            submittedById: approverId,
            approverId,
            decidedAt: now,
            comment: `${milestoneName} — auto-approved`,
          },
        });
        for (const e of entries) {
          // These entries are created already-APPROVED, so freeze the historical cost rate for the
          // day now (leave is paid time — its cost is real overhead). Falls back to the leave
          // assignment's snapshot rate when no salary/FX covers the date.
          const costRate = (await computeHourlyCostRateEUR(request.userId, e.date)) ?? Number(assignment.costRate);
          await tx.timeEntry.create({
            data: {
              userId: request.userId,
              assignmentId: assignment.id,
              milestoneId: assignment.milestoneId,
              timeCardId: card.id,
              date: e.date,
              hours: e.hours,
              description: milestoneName,
              costRate,
            },
          });
        }
      }

      const approved = await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: {
          status: "APPROVED",
          decidedById: approverId,
          decidedAt: now,
          milestoneId: assignment.milestoneId,
          assignmentId: assignment.id,
        },
      });
      // The audit row (if the caller wants one) commits with the approval, not after it.
      if (onApproved) await onApproved(tx, request, approved);
    },
    { timeout: 20000 }
  );
}

/** Un-provisions an early/partial return to work within an already-APPROVED, already-provisioned
 *  LeaveRequest: removes the TimeEntry rows for each working day in [startDate, endDate],
 *  decrements the affected AssignmentPlan weeks by the same hours (deleting a week's plan row if
 *  it hits 0), deletes any TimeCard left with no entries, and decrements the parent request's
 *  workingDays by the number of working days actually returned — which is what gives those days
 *  back to computeVacationBalance for VACATION (SICK/PATERNITY/MATERNITY get the same
 *  un-provisioning but have no balance to give back to). Assumes the caller has already validated
 *  the range falls within the request's own dates and doesn't overlap an existing LeaveReturn —
 *  this function trusts its inputs, same convention as provisionLeave/ensureLeaveAssignment. */
export async function recordLeaveReturn(
  leaveRequestId: string,
  startDate: Date,
  endDate: Date,
  recordedById: string
): Promise<{ workingDaysReturned: number }> {
  return prisma.$transaction(
    async (tx) => {
      const request = await tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId } });
      if (!request.assignmentId) {
        throw new Error("This leave request hasn't been provisioned yet.");
      }
      const assignmentId = request.assignmentId;

      const workingDates: Date[] = [];
      for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) {
        if (isWorkingDay(d)) workingDates.push(new Date(d));
      }

      const hoursRemovedByWeek = new Map<string, number>();
      for (const date of workingDates) {
        const entry = await tx.timeEntry.findFirst({ where: { assignmentId, date } });
        if (!entry) continue;
        await tx.timeEntry.delete({ where: { id: entry.id } });
        const weekKey = toDateParam(startOfWeek(date));
        hoursRemovedByWeek.set(weekKey, (hoursRemovedByWeek.get(weekKey) ?? 0) + Number(entry.hours));
      }

      for (const [weekKey, hoursRemoved] of hoursRemovedByWeek) {
        const weekStart = parseISO(weekKey);
        const plan = await tx.assignmentPlan.findFirst({
          where: { assignmentId, taskId: null, weekStartDate: weekStart },
        });
        if (!plan) continue;
        const remaining = Number(plan.hours) - hoursRemoved;
        if (remaining <= 0) {
          await tx.assignmentPlan.delete({ where: { id: plan.id } });
        } else {
          await tx.assignmentPlan.update({ where: { id: plan.id }, data: { hours: remaining } });
        }

        // A TimeCard left with no TimeEntry rows after the deletions above is a dangling
        // artifact — clean it up rather than leaving an empty approved card in the grid.
        const remainingEntries = await tx.timeEntry.count({
          where: { assignmentId, timeCard: { weekStartDate: weekStart } },
        });
        if (remainingEntries === 0) {
          await tx.timeCard.deleteMany({ where: { assignmentId, weekStartDate: weekStart } });
        }
      }

      const workingDaysReturned = workingDates.length;
      await tx.leaveRequest.update({
        where: { id: leaveRequestId },
        data: { workingDays: Math.max(0, Number(request.workingDays) - workingDaysReturned) },
      });

      await tx.leaveReturn.create({
        data: { leaveRequestId, startDate, endDate, workingDays: workingDaysReturned, recordedById },
      });

      return { workingDaysReturned };
    },
    { timeout: 20000 }
  );
}
