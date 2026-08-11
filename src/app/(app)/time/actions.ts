"use server";

import { revalidatePath } from "next/cache";
import { addDays } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { startOfWeek } from "@/lib/week";
import { stampCostRatesForCards } from "@/lib/cost-rate";

const CellSchema = z.object({
  lineId: z.string().min(1),
  assignmentId: z.string().min(1),
  taskId: z.string().nullable(),
  date: z.string().min(1),
  hours: z.coerce.number().min(-24, "Max 24 hours per entry").max(24, "Max 24 hours per entry"),
  description: z.string().max(255, "Note must be 255 characters or fewer").optional().default(""),
});
export type TimeGridCell = z.infer<typeof CellSchema>;

const SaveTimeGridSchema = z.object({
  targetUserId: z.string().min(1),
  weekStartDate: z.string().min(1),
  cells: z.array(CellSchema),
});

export async function saveTimeGridAction(input: {
  targetUserId: string;
  weekStartDate: string;
  cells: TimeGridCell[];
}): Promise<{ error?: string }> {
  const caller = await requireUser();

  const parsed = SaveTimeGridSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { targetUserId, cells } = parsed.data;
  const weekStart = startOfWeek(new Date(parsed.data.weekStartDate));
  const weekEnd = addDays(weekStart, 6);

  if (cells.length === 0) return {};

  const isProxy = targetUserId !== caller.id;
  if (isProxy && caller.role !== "ADMIN" && caller.role !== "PM") {
    return { error: "You do not have permission to enter time for other people." };
  }

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId: caller.companyId } });
  if (!targetUser) return { error: "Resource not found." };

  const assignmentIds = [...new Set(cells.map((c) => c.assignmentId))];
  const assignments = await prisma.assignment.findMany({
    where: { id: { in: assignmentIds } },
    include: { milestone: { include: { tasks: true, project: true } } },
  });
  const assignmentMap = new Map(assignments.map((a) => [a.id, a]));

  // Daily notes are mandatory on every logged (non-zero) cell.
  for (const cell of cells) {
    if (cell.hours !== 0 && !cell.description.trim()) {
      const assignment = assignmentMap.get(cell.assignmentId);
      return { error: `${assignment?.milestone.name ?? "Entry"}: a note is required for every day you log hours.` };
    }
  }

  // A line is either logged work (positive) or a correction undoing previously approved hours
  // (negative) — never both. Keeping them separate means a line's sign alone tells you whether
  // Submit should auto-approve it, with no need to net opposing cells first.
  {
    const cellsByLine = new Map<string, TimeGridCell[]>();
    for (const cell of cells) {
      if (cell.hours === 0) continue;
      const arr = cellsByLine.get(cell.lineId) ?? [];
      arr.push(cell);
      cellsByLine.set(cell.lineId, arr);
    }
    for (const [, lineCells] of cellsByLine) {
      const hasPositive = lineCells.some((c) => c.hours > 0);
      const hasNegative = lineCells.some((c) => c.hours < 0);
      if (hasPositive && hasNegative) {
        const assignment = assignmentMap.get(lineCells[0].assignmentId);
        return {
          error: `${assignment?.milestone.name ?? "This line"}: cannot mix positive and negative hours on the same line — use a separate line for the correction.`,
        };
      }
    }
  }

  // Validate every non-zero cell.
  const nonZeroCells = cells.filter((c) => c.hours !== 0);
  const existingSumsByAssignment = new Map<string, number>();
  const existingSumsByTask = new Map<string, number>();

  for (const cell of nonZeroCells) {
    const assignment = assignmentMap.get(cell.assignmentId);
    if (!assignment || assignment.userId !== targetUserId) {
      return { error: "Invalid assignment for this resource." };
    }
    if (assignment.status !== "ACTIVE") return { error: `${assignment.milestone.name}: assignment is not active.` };
    if (!assignment.milestone.timeEntryOpen) {
      return { error: `${assignment.milestone.name}: closed for time entry.` };
    }

    const entryDate = new Date(cell.date);
    if (entryDate < assignment.startDate) {
      return { error: `${assignment.milestone.name}: assignment starts ${assignment.startDate.toLocaleDateString()}.` };
    }
    if (entryDate > assignment.endDate) {
      return { error: `${assignment.milestone.name}: assignment ended ${assignment.endDate.toLocaleDateString()}.` };
    }

    const milestoneTasks = assignment.milestone.tasks;
    // Time can be logged either at the assignment level (taskId null) or against a specific task,
    // even on milestones that have tasks — so an assignment-level plan copies straight onto the line
    // without being forced into a task. A provided taskId must still belong to the milestone.
    if (cell.taskId && !milestoneTasks.some((t) => t.id === cell.taskId)) {
      return { error: `${assignment.milestone.name}: invalid task.` };
    }

    if (assignment.allocatedHours !== null) {
      const key = assignment.id;
      if (!existingSumsByAssignment.has(key)) {
        const used = await prisma.timeEntry.aggregate({
          where: { assignmentId: assignment.id, date: { lt: weekStart } },
          _sum: { hours: true },
        });
        const usedAfter = await prisma.timeEntry.aggregate({
          where: { assignmentId: assignment.id, date: { gt: weekEnd } },
          _sum: { hours: true },
        });
        existingSumsByAssignment.set(key, Number(used._sum.hours ?? 0) + Number(usedAfter._sum.hours ?? 0));
      }
    }
    if (cell.taskId) {
      const task = milestoneTasks.find((t) => t.id === cell.taskId);
      if (task?.estimatedHours && !existingSumsByTask.has(cell.taskId)) {
        const usedBefore = await prisma.timeEntry.aggregate({
          where: { taskId: cell.taskId, date: { lt: weekStart } },
          _sum: { hours: true },
        });
        const usedAfter = await prisma.timeEntry.aggregate({
          where: { taskId: cell.taskId, date: { gt: weekEnd } },
          _sum: { hours: true },
        });
        existingSumsByTask.set(cell.taskId, Number(usedBefore._sum.hours ?? 0) + Number(usedAfter._sum.hours ?? 0));
      }
    }
  }

  // Sum requested hours per assignment/task within this batch and re-check against caps.
  const batchByAssignment = new Map<string, number>();
  const batchByTask = new Map<string, number>();
  for (const cell of nonZeroCells) {
    batchByAssignment.set(cell.assignmentId, (batchByAssignment.get(cell.assignmentId) ?? 0) + cell.hours);
    if (cell.taskId) batchByTask.set(cell.taskId, (batchByTask.get(cell.taskId) ?? 0) + cell.hours);
  }
  for (const [assignmentId, requested] of batchByAssignment) {
    const assignment = assignmentMap.get(assignmentId)!;
    if (requested < 0) {
      // A negative line undoes previously approved hours — it can't undo more than was actually
      // approved, or the assignment's apparent remaining capacity would inflate beyond its real
      // cap (e.g. reducing by 100h with nothing approved yet would otherwise free up 100h that
      // was never really used).
      const approved = await prisma.timeEntry.aggregate({
        where: { assignmentId, timeCard: { status: "APPROVED" } },
        _sum: { hours: true },
      });
      const approvedTotal = Number(approved._sum.hours ?? 0);
      if (Math.abs(requested) > approvedTotal) {
        return {
          error: `${assignment.milestone.name}: cannot reduce by more than the ${approvedTotal}h already approved.`,
        };
      }
    } else if (assignment.allocatedHours !== null) {
      const already = existingSumsByAssignment.get(assignmentId) ?? 0;
      const remaining = Number(assignment.allocatedHours) - already;
      if (requested > remaining) {
        return { error: `${assignment.milestone.name}: only ${remaining}h remaining on this assignment.` };
      }
    }
  }
  for (const [taskId, requested] of batchByTask) {
    const assignment = [...assignmentMap.values()].find((a) => a.milestone.tasks.some((t) => t.id === taskId))!;
    const task = assignment.milestone.tasks.find((t) => t.id === taskId)!;
    if (requested < 0) {
      const approved = await prisma.timeEntry.aggregate({
        where: { taskId, timeCard: { status: "APPROVED" } },
        _sum: { hours: true },
      });
      const approvedTotal = Number(approved._sum.hours ?? 0);
      if (Math.abs(requested) > approvedTotal) {
        return { error: `${task.name}: cannot reduce by more than the ${approvedTotal}h already approved.` };
      }
    } else if (task.estimatedHours) {
      const already = existingSumsByTask.get(taskId) ?? 0;
      const remaining = Number(task.estimatedHours) - already;
      if (requested > remaining) {
        return { error: `${task.name}: only ${remaining}h remaining on this task.` };
      }
    }
  }

  // Group cells by line (one TimeCard per line — lineId is either an existing TimeCard's id, or
  // a client-generated id used to create a brand new one).
  const lineIds = [...new Set(cells.map((c) => c.lineId))];
  const existingCards = await prisma.timeCard.findMany({ where: { id: { in: lineIds }, userId: targetUserId } });
  const existingCardMap = new Map(existingCards.map((c) => [c.id, c]));

  for (const [lineId, card] of existingCardMap) {
    if (card.status === "SUBMITTED") {
      return { error: "One of these lines is submitted and awaiting approval — recall it to make changes." };
    }
    if (card.status === "APPROVED") {
      return { error: "One of these lines is already approved — add a new line to adjust the total." };
    }
    void lineId;
  }

  await prisma.$transaction(async (tx) => {
    const cellsByLine = new Map<string, TimeGridCell[]>();
    for (const cell of cells) {
      const arr = cellsByLine.get(cell.lineId) ?? [];
      arr.push(cell);
      cellsByLine.set(cell.lineId, arr);
    }

    for (const [lineId, lineCells] of cellsByLine) {
      const hasHours = lineCells.some((c) => c.hours !== 0);
      const existing = existingCardMap.get(lineId);
      const first = lineCells[0];

      let cardId: string;
      if (existing) {
        cardId = existing.id;
        if (existing.status === "REJECTED") {
          // Editing a rejected line starts it over — back to draft, needs resubmitting.
          await tx.timeCard.update({
            where: { id: cardId },
            data: { status: "DRAFT", submittedAt: null, approverId: null, decidedAt: null, comment: null },
          });
        }
      } else {
        if (!hasHours) continue; // never persist an empty new line
        const assignment = assignmentMap.get(first.assignmentId)!;
        // Saving always lands a line in DRAFT — auto-approval only ever happens at Submit time,
        // and only when the submitter is literally the project's manager submitting for someone else.
        // One card covers the whole assignment for the week — it can span several tasks, each
        // just an hours sub-row; status/submit/delete only ever apply to the card as a whole.
        const created = await tx.timeCard.create({
          data: {
            id: lineId,
            userId: targetUserId,
            assignmentId: first.assignmentId,
            milestoneId: assignment.milestoneId,
            weekStartDate: weekStart,
            status: "DRAFT",
          },
        });
        cardId = created.id;
      }

      for (const cell of lineCells) {
        const existingEntry = await tx.timeEntry.findFirst({
          where: { timeCardId: cardId, taskId: cell.taskId, date: new Date(cell.date) },
        });
        if (cell.hours === 0) {
          if (existingEntry) await tx.timeEntry.delete({ where: { id: existingEntry.id } });
          continue;
        }
        if (existingEntry) {
          await tx.timeEntry.update({
            where: { id: existingEntry.id },
            data: { hours: cell.hours, description: cell.description || null },
          });
        } else {
          const assignment = assignmentMap.get(cell.assignmentId)!;
          await tx.timeEntry.create({
            data: {
              userId: targetUserId,
              assignmentId: cell.assignmentId,
              milestoneId: assignment.milestoneId,
              taskId: cell.taskId,
              timeCardId: cardId,
              date: new Date(cell.date),
              hours: cell.hours,
              description: cell.description || null,
            },
          });
        }
      }

      // If every cell on this line was cleared to zero, drop the now-empty card.
      if (!hasHours) {
        const remaining = await tx.timeEntry.count({ where: { timeCardId: cardId } });
        if (remaining === 0) await tx.timeCard.delete({ where: { id: cardId } });
      }
    }
  });

  revalidatePath("/time");
  revalidatePath("/approvals");
  return {};
}

export async function submitTimeCardsAction(cardIds: string[]): Promise<{ error?: string }> {
  const caller = await requireUser();
  if (cardIds.length === 0) return { error: "Nothing to submit." };

  const cards = await prisma.timeCard.findMany({
    where: { id: { in: cardIds } },
    include: { milestone: { include: { project: true } }, entries: true },
  });
  if (cards.length !== cardIds.length) return { error: "One or more lines were not found." };

  const totalsByCard = new Map<string, number>();
  for (const card of cards) {
    if (card.status !== "DRAFT" && card.status !== "REJECTED") {
      return { error: "Only draft or rejected lines can be submitted." };
    }
    const total = card.entries.reduce((s, e) => s + Number(e.hours), 0);
    if (total === 0) return { error: "One of the selected lines has no hours logged." };
    totalsByCard.set(card.id, total);
    const isProxy = card.userId !== caller.id;
    // Any PM/Admin can submit on someone's behalf company-wide — whether it auto-approves is a
    // separate question, decided below by whether the caller actually manages *this* project.
    if (isProxy && caller.role !== "ADMIN" && caller.role !== "PM") {
      return { error: "You do not have permission to submit time for other people." };
    }
  }

  const now = new Date();
  const autoApprovedIds: string[] = [];
  await prisma.$transaction(
    cards.map((card) => {
      const total = totalsByCard.get(card.id)!;
      // A negative line is a correction undoing previously approved hours (validated at Save time
      // to never exceed what was actually approved) — it takes effect immediately regardless of
      // who submits it, the same way the undo it represents doesn't need re-approving. Otherwise,
      // auto-approval only ever applies when the actual project manager submits time for someone
      // else — never for self-submission, and never for an Admin who isn't that project's manager
      // (they still just submit into the normal approval queue).
      const isProxy = card.userId !== caller.id;
      const isCorrection = total < 0;
      const autoApprove = isCorrection || (isProxy && card.milestone.project.managerId === caller.id);
      if (autoApprove) autoApprovedIds.push(card.id);
      return prisma.timeCard.update({
        where: { id: card.id },
        data: autoApprove
          ? {
              status: "APPROVED",
              submittedAt: now,
              submittedById: caller.id,
              approverId: caller.id,
              decidedAt: now,
              comment: isCorrection
                ? "Auto-approved (negative correction)"
                : "Auto-approved (submitted by project manager)",
            }
          : {
              status: "SUBMITTED",
              submittedAt: now,
              submittedById: caller.id,
              approverId: card.milestone.project.managerId,
              decidedAt: null,
              comment: null,
            },
      });
    })
  );

  // Auto-approved lines skip the approval queue, so freeze their historical cost rate now.
  if (autoApprovedIds.length > 0) await stampCostRatesForCards(autoApprovedIds);

  revalidatePath("/time");
  revalidatePath("/approvals");
  return {};
}

export async function recallTimeCardAction(timeCardId: string): Promise<void> {
  const user = await requireUser();

  const card = await prisma.timeCard.findFirst({ where: { id: timeCardId, userId: user.id } });
  if (!card) throw new Error("Time card not found.");
  if (card.status !== "SUBMITTED") throw new Error("Only a submitted (not yet decided) line can be recalled.");

  await prisma.timeCard.update({
    where: { id: timeCardId },
    data: { status: "DRAFT", submittedAt: null, submittedById: null, approverId: null },
  });

  revalidatePath("/time");
  revalidatePath("/approvals");
}

export async function deleteTimeCardsAction(cardIds: string[]): Promise<{ error?: string }> {
  const caller = await requireUser();
  if (cardIds.length === 0) return { error: "Select at least one draft line to delete." };

  // Deleting is owner-only, unlike entering/submitting — a manager can enter and auto-approve
  // time for someone else, but never erase what's already logged against that person's name.
  const foundCards = await prisma.timeCard.findMany({ where: { id: { in: cardIds }, userId: caller.id } });
  if (foundCards.length !== cardIds.length) return { error: "You can only delete your own time cards." };

  for (const card of foundCards) {
    // Blocks the whole batch rather than silently skipping — only draft lines can be deleted.
    if (card.status !== "DRAFT") {
      return { error: "Only draft lines can be deleted — submitted, approved, or rejected lines must stay." };
    }
  }

  await prisma.$transaction([
    prisma.timeEntry.deleteMany({ where: { timeCardId: { in: cardIds } } }),
    prisma.timeCard.deleteMany({ where: { id: { in: cardIds } } }),
  ]);

  revalidatePath("/time");
  revalidatePath("/approvals");
  return {};
}
