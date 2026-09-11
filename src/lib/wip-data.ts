import "server-only";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/permissions";
import { TIME_BILLED_TYPES, type UnbilledEntry } from "@/lib/wip";
import { effectiveBillRate } from "@/lib/revenue";
import { netZeroEntryIds } from "@/lib/invoice-time-link";

// Loads unbilled work-in-progress from the DB. Shaping/grouping helpers live in the pure
// `@/lib/wip` module so client components can reuse them.
export * from "@/lib/wip";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Every unbilled approved entry the user can see, flattened. `asOf` drives the age calculation
 *  (defaults to now) — passed explicitly so callers/tests get a stable reference point. */
export async function loadUnbilledEntries(user: SessionUser, asOf: Date = new Date()): Promise<UnbilledEntry[]> {
  const projectIds = await visibleProjectIds(user);
  const projectWhere = projectIds === "ALL" ? { companyId: user.companyId } : { companyId: user.companyId, id: { in: projectIds } };

  const rows = await prisma.timeEntry.findMany({
    where: {
      invoiceLineId: null,
      timeCard: { status: "APPROVED" },
      // Only time-billed work belongs here — see TIME_BILLED_TYPES. A fixed-price milestone's
      // salesPrice is a lump sum, so hours x rate would be nonsense.
      milestone: { billable: true, project: { ...projectWhere, billingType: { in: [...TIME_BILLED_TYPES] } } },
    },
    select: {
      id: true,
      date: true,
      hours: true,
      billRate: true,
      assignmentId: true,
      taskId: true,
      user: { select: { name: true } },
      assignment: { select: { billRate: true } },
      milestone: {
        select: {
          id: true, name: true, salesPrice: true, budgetHours: true,
          project: { select: { id: true, name: true, billingType: true, client: { select: { name: true } } } },
        },
      },
    },
    orderBy: { date: "asc" },
  });

  // Compare at UTC midnight — TimeEntry.date is stored there, so a same-day entry ages 0, not -1.
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  // A correction that exactly cancels hours on the same day (e.g. +4h planning copy, −4h) is not
  // work waiting to be billed — drop the pair rather than show a phantom negative.
  const cancelled = netZeroEntryIds(rows.map((e) => ({ id: e.id, hours: Number(e.hours), date: e.date.toISOString().slice(0, 10), milestoneId: e.milestone.id, taskId: e.taskId, assignmentId: e.assignmentId })));
  return rows.filter((e) => !cancelled.has(e.id)).map((e) => {
    const hours = Number(e.hours);
    const rate = effectiveBillRate({
      entryBillRate: e.billRate == null ? null : Number(e.billRate),
      assignmentBillRate: e.assignment.billRate == null ? null : Number(e.assignment.billRate),
      milestoneSalesPrice: Number(e.milestone.salesPrice),
      milestoneBudgetHours: e.milestone.budgetHours == null ? null : Number(e.milestone.budgetHours),
      billingType: e.milestone.project.billingType,
    });
    const iso = e.date.toISOString().slice(0, 10);
    return {
      entryId: e.id,
      projectId: e.milestone.project.id,
      projectName: e.milestone.project.name,
      clientName: e.milestone.project.client.name,
      milestoneId: e.milestone.id,
      milestoneName: e.milestone.name,
      userName: e.user.name,
      date: iso,
      month: iso.slice(0, 7),
      hours: round2(hours),
      rate: round2(rate),
      value: round2(hours * rate),
      ageDays: Math.max(0, Math.floor((today - e.date.getTime()) / 86_400_000)),
    };
  });
}

