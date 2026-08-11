"use server";

import { revalidatePath } from "next/cache";
import { addDays, format, parseISO } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { startOfWeek } from "@/lib/week";

const CellSchema = z.object({
  assignmentId: z.string().min(1),
  // null / omitted = assignment-level plan; a task id = a task-level breakdown row.
  taskId: z.string().nullish(),
  weekStartDate: z.string().min(1),
  hours: z.coerce.number().min(0).max(999),
});
export type PlanCell = z.infer<typeof CellSchema>;

// Thrown inside the save transaction when a cap is exceeded, so the transaction rolls back and we
// can surface a friendly message (distinct from an unexpected DB error, which should still throw).
class PlanCapError extends Error {}

export async function savePlanAction(cells: PlanCell[]): Promise<{ error?: string }> {
  const user = await requireUser();

  const parsed = z.array(CellSchema).safeParse(cells);
  if (!parsed.success) return { error: "Invalid input." };
  if (parsed.data.length === 0) return {};

  // A PM plans capacity for the whole company, not just people on projects they personally
  // manage — matching proxy time entry's scope (see time/actions.ts).
  if (!can(user, "projects:manage:any") && user.role !== "PM") {
    return { error: "You do not have permission to plan resources." };
  }

  // Still independently verify every assignment belongs to the caller's own company, since
  // assignmentIds come straight from the client.
  const assignmentIds = [...new Set(parsed.data.map((c) => c.assignmentId))];
  const assignments = await prisma.assignment.findMany({
    where: { id: { in: assignmentIds } },
    include: { milestone: { include: { project: true } } },
  });
  const assignmentMap = new Map(assignments.map((a) => [a.id, a]));
  if (assignments.length !== assignmentIds.length || assignments.some((a) => a.milestone.project.companyId !== user.companyId)) {
    return { error: "Invalid assignment." };
  }

  // Task cells: every referenced task must belong to its assignment — same milestone AND assigned
  // to the assignment's user (taskId comes from the client, so never trust it).
  const taskIds = [...new Set(parsed.data.map((c) => c.taskId).filter((t): t is string => !!t))];
  const tasks = taskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, name: true, milestoneId: true, assigneeId: true, estimatedHours: true },
      })
    : [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  for (const cell of parsed.data) {
    if (!cell.taskId) continue;
    const task = taskMap.get(cell.taskId);
    const assignment = assignmentMap.get(cell.assignmentId);
    if (!task || !assignment || task.milestoneId !== assignment.milestoneId || task.assigneeId !== assignment.userId) {
      return { error: "Invalid task for this assignment." };
    }
  }

  // Reject any cell whose week falls outside the assignment's own start/end window (the ground
  // truth for valid weeks, same as the Time Entry grid's "pickable" check). Applies to task cells
  // too. Clearing a cell to 0 is always allowed, even outside the window, so stale values can go.
  for (const cell of parsed.data) {
    if (cell.hours <= 0) continue;
    const assignment = assignmentMap.get(cell.assignmentId)!;
    const weekStart = startOfWeek(new Date(cell.weekStartDate));
    const weekEnd = addDays(weekStart, 6);
    if (assignment.startDate > weekEnd || assignment.endDate < weekStart) {
      return {
        error: `${assignment.milestone.name}: the week of ${format(weekStart, "MMM d, yyyy")} is outside this assignment's window (${format(assignment.startDate, "MMM d")} – ${format(assignment.endDate, "MMM d, yyyy")}) — nothing was saved.`,
      };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Apply each cell. The delete-first rules keep the core invariant: for any (assignment,
      // week) there is EITHER one assignment-level row (taskId null) OR task-level rows, never both.
      for (const cell of parsed.data) {
        const weekStart = startOfWeek(new Date(cell.weekStartDate));
        if (cell.taskId) {
          if (cell.hours <= 0) {
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: cell.taskId, weekStartDate: weekStart } });
          } else {
            // Convert the week to task-mode: drop any assignment-level row, replace this task's row.
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: null, weekStartDate: weekStart } });
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: cell.taskId, weekStartDate: weekStart } });
            await tx.assignmentPlan.create({ data: { assignmentId: cell.assignmentId, taskId: cell.taskId, weekStartDate: weekStart, hours: cell.hours } });
          }
        } else {
          if (cell.hours <= 0) {
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: null, weekStartDate: weekStart } });
          } else {
            // Switch the week back to assignment-mode: drop any task rows, replace the single row.
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: { not: null }, weekStartDate: weekStart } });
            await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, taskId: null, weekStartDate: weekStart } });
            await tx.assignmentPlan.create({ data: { assignmentId: cell.assignmentId, taskId: null, weekStartDate: weekStart, hours: cell.hours } });
          }
        }
      }

      // Caps validated post-apply against the actual stored rows (robust across both tiers), then
      // thrown to roll back on violation. Task estimate cap (only when the task has an estimate):
      for (const taskId of taskIds) {
        const task = taskMap.get(taskId);
        if (!task?.estimatedHours) continue;
        const total = Number((await tx.assignmentPlan.aggregate({ where: { taskId }, _sum: { hours: true } }))._sum.hours ?? 0);
        if (total > Number(task.estimatedHours)) {
          throw new PlanCapError(`Task "${task.name}": planned ${total}h would exceed its ${Number(task.estimatedHours)}h estimate.`);
        }
      }
      // Assignment allocation cap (sum of all rows, assignment-level + task-level):
      for (const assignmentId of assignmentIds) {
        const assignment = assignmentMap.get(assignmentId);
        if (!assignment?.allocatedHours) continue;
        const total = Number((await tx.assignmentPlan.aggregate({ where: { assignmentId }, _sum: { hours: true } }))._sum.hours ?? 0);
        if (total > Number(assignment.allocatedHours)) {
          throw new PlanCapError(`${assignment.milestone.name}: planned total (${total}h) would exceed the assignment's ${Number(assignment.allocatedHours)}h allocation.`);
        }
      }
    });
  } catch (e) {
    if (e instanceof PlanCapError) return { error: e.message };
    throw e;
  }

  revalidatePath("/planning");
  revalidatePath("/my-planning");
  return {};
}

const UpdateEndDateSchema = z.object({
  assignmentId: z.string().min(1),
  endDate: z.string().min(1),
});
export type UpdateEndDateInput = z.infer<typeof UpdateEndDateSchema>;

/** Drag-to-resize on the Planner grid: moves an assignment's endDate to `endDate`, either
 *  direction. Extending forward is capped by the parent project's own endDate (if it has one) —
 *  an assignment can never outlive its project. Shrinking backward is capped by the latest
 *  SUBMITTED or APPROVED time entry already logged on the assignment — never past real
 *  committed work, even though it's fine to shrink past a week that only has *planned* (not
 *  actual) hours, or an unsubmitted DRAFT entry (those just become read-only/out-of-window,
 *  same as any other out-of-window cell, not silently deleted). */
export async function updateAssignmentEndDateAction(input: UpdateEndDateInput): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = UpdateEndDateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };

  if (!can(user, "projects:manage:any") && user.role !== "PM") {
    return { error: "You do not have permission to manage assignments." };
  }

  const assignment = await prisma.assignment.findFirst({
    where: { id: parsed.data.assignmentId },
    include: { milestone: { include: { project: true } } },
  });
  if (!assignment || assignment.milestone.project.companyId !== user.companyId) {
    return { error: "Invalid assignment." };
  }

  const newEndDate = parseISO(parsed.data.endDate);
  if (Number.isNaN(newEndDate.getTime())) return { error: "Invalid date." };
  if (newEndDate < assignment.startDate) {
    return { error: "The end date can't be before the assignment's start date." };
  }
  if (newEndDate.getTime() === assignment.endDate.getTime()) return {};

  if (newEndDate > assignment.endDate) {
    const projectEndDate = assignment.milestone.project.endDate;
    if (projectEndDate && newEndDate > projectEndDate) {
      return { error: `Can't extend past the project's end date (${format(projectEndDate, "MMM d, yyyy")}).` };
    }
  } else {
    const latestEntry = await prisma.timeEntry.findFirst({
      where: { assignmentId: assignment.id, timeCard: { status: { in: ["SUBMITTED", "APPROVED"] } } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (latestEntry && newEndDate < latestEntry.date) {
      return {
        error: `Can't move the end date before ${format(latestEntry.date, "MMM d, yyyy")} — that's the latest submitted time entry on this assignment.`,
      };
    }
  }

  await prisma.assignment.update({ where: { id: assignment.id }, data: { endDate: newEndDate } });
  revalidatePath("/planning");
  revalidatePath("/time");
  return {};
}
