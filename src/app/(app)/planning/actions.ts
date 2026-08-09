"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { startOfWeek } from "@/lib/week";

const CellSchema = z.object({
  assignmentId: z.string().min(1),
  weekStartDate: z.string().min(1),
  hours: z.coerce.number().min(0).max(999),
});
export type PlanCell = z.infer<typeof CellSchema>;

export async function savePlanAction(cells: PlanCell[]): Promise<{ error?: string }> {
  const user = await requireUser();

  const parsed = z.array(CellSchema).safeParse(cells);
  if (!parsed.success) return { error: "Invalid input." };
  if (parsed.data.length === 0) return {};

  const assignmentIds = [...new Set(parsed.data.map((c) => c.assignmentId))];
  const assignments = await prisma.assignment.findMany({
    where: { id: { in: assignmentIds } },
    include: { milestone: { include: { project: true } } },
  });
  const assignmentMap = new Map(assignments.map((a) => [a.id, a]));

  // A PM plans capacity for the whole company, not just people on projects they personally
  // manage — matching proxy time entry's scope (see time/actions.ts). Still independently
  // verify every assignment actually belongs to the caller's own company, since assignmentIds
  // come straight from the client.
  if (!can(user, "projects:manage:any") && user.role !== "PM") {
    return { error: "You do not have permission to plan resources." };
  }
  if (assignments.some((a) => a.milestone.project.companyId !== user.companyId)) {
    return { error: "Invalid assignment." };
  }

  // Re-check each assignment's overall allocatedHours cap against the sum of all its planned weeks.
  const requestedByAssignment = new Map<string, number>();
  for (const cell of parsed.data) {
    requestedByAssignment.set(cell.assignmentId, (requestedByAssignment.get(cell.assignmentId) ?? 0) + cell.hours);
  }
  const weekKeysByAssignment = new Map<string, Set<string>>();
  for (const cell of parsed.data) {
    const set = weekKeysByAssignment.get(cell.assignmentId) ?? new Set<string>();
    set.add(startOfWeek(new Date(cell.weekStartDate)).toISOString());
    weekKeysByAssignment.set(cell.assignmentId, set);
  }

  for (const [assignmentId, requestedSum] of requestedByAssignment) {
    const assignment = assignmentMap.get(assignmentId);
    if (!assignment?.allocatedHours) continue;
    const weeksTouched = weekKeysByAssignment.get(assignmentId)!;
    const otherWeeksSum = await prisma.assignmentPlan.aggregate({
      where: {
        assignmentId,
        weekStartDate: { notIn: [...weeksTouched].map((w) => new Date(w)) },
      },
      _sum: { hours: true },
    });
    const total = requestedSum + Number(otherWeeksSum._sum.hours ?? 0);
    if (total > Number(assignment.allocatedHours)) {
      return {
        error: `${assignment.milestone.name}: planned total (${total}h) would exceed the assignment's ${assignment.allocatedHours}h allocation.`,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const cell of parsed.data) {
      const weekStart = startOfWeek(new Date(cell.weekStartDate));
      if (cell.hours <= 0) {
        await tx.assignmentPlan.deleteMany({ where: { assignmentId: cell.assignmentId, weekStartDate: weekStart } });
        continue;
      }
      await tx.assignmentPlan.upsert({
        where: { assignmentId_weekStartDate: { assignmentId: cell.assignmentId, weekStartDate: weekStart } },
        create: { assignmentId: cell.assignmentId, weekStartDate: weekStart, hours: cell.hours },
        update: { hours: cell.hours },
      });
    }
  });

  revalidatePath("/planning");
  return {};
}
