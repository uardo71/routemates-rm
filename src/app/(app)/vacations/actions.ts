"use server";

import { revalidatePath } from "next/cache";
import { parseISO, format } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { countWorkingDays } from "@/lib/vacation-calc";
import { provisionLeave, recordLeaveReturn } from "@/lib/vacation";
import { recordAudit } from "@/lib/audit";

const LEAVE_TYPES = ["VACATION", "SICK", "PATERNITY", "MATERNITY"] as const;

const RequestSchema = z.object({
  type: z.enum(LEAVE_TYPES),
  userId: z.string().min(1).optional(), // admin proxy target; defaults to the caller
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().max(500).optional(),
  // Required only when the caller is Admin — an admin-filed request auto-approves immediately,
  // so the internal project has to be chosen up front rather than at a later decision step.
  projectId: z.string().min(1).optional(),
});
export type RequestVacationInput = z.infer<typeof RequestSchema>;

export async function requestVacationAction(input: RequestVacationInput): Promise<{ error?: string }> {
  const caller = await requireUser();
  const parsed = RequestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const data = parsed.data;

  const isAdmin = can(caller, "vacations:manage");
  const targetUserId = isAdmin && data.userId ? data.userId : caller.id;

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId: caller.companyId } });
  if (!targetUser) return { error: "Invalid user." };

  // parseISO, not the native Date constructor — the constructor treats date-only strings as
  // UTC, which drifts off local midnight on non-UTC servers and breaks alignment with the
  // rest of the app's parseDateParam-based week/date lookups (Planner, Time Entry).
  const startDate = parseISO(data.startDate);
  const endDate = parseISO(data.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return { error: "Invalid date." };
  if (endDate < startDate) return { error: "End date must be on or after the start date." };

  // countWorkingDays returns -1 (not a real negative count) for an absurdly large range —
  // reject explicitly rather than letting it fall through to the generic "<= 0" message below.
  const workingDays = countWorkingDays(startDate, endDate);
  if (workingDays < 0) return { error: "That date range is too large — please pick a shorter period." };
  if (workingDays === 0) return { error: "That range has no working days — nothing to request." };

  let project = null;
  if (isAdmin) {
    if (!data.projectId) return { error: "Pick an internal project to track these days under." };
    project = await prisma.project.findFirst({ where: { id: data.projectId, companyId: caller.companyId, isInternal: true } });
    if (!project) return { error: "Invalid internal project." };
  }

  const request = await prisma.leaveRequest.create({
    data: {
      userId: targetUserId,
      type: data.type,
      startDate,
      endDate,
      workingDays,
      reason: data.reason,
      requestedById: caller.id,
      status: "PENDING",
    },
  });

  if (isAdmin && project) {
    await provisionLeave(request.id, project.id, caller.id, (tx, before, after) =>
      recordAudit(tx, { entityType: "LeaveRequest", entityId: request.id, action: "update", actor: caller, before, after, fields: ["status", "decidedById"], label: `${request.type.toLowerCase()} ${request.startDate.toISOString().slice(0, 10)}`, note: "admin direct insert" }),
    );
  }

  revalidatePath("/vacations");
  revalidatePath("/planning");
  revalidatePath("/time");
  return {};
}

const DecideSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  projectId: z.string().min(1).optional(),
  comment: z.string().max(500).optional(),
});
export type DecideVacationInput = z.infer<typeof DecideSchema>;

export async function decideVacationAction(input: DecideVacationInput): Promise<{ error?: string }> {
  const caller = await requirePermission("vacations:manage");
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const data = parsed.data;

  const request = await prisma.leaveRequest.findFirst({
    where: { id: data.requestId, user: { companyId: caller.companyId } },
    include: { user: { select: { name: true } } },
  });
  if (!request) return { error: "Request not found." };
  if (request.status !== "PENDING") return { error: "This request has already been decided." };
  const leaveLabel = `${request.user.name} · ${request.type.toLowerCase()} ${request.startDate.toISOString().slice(0, 10)}`;

  if (data.decision === "REJECT") {
    await prisma.$transaction(async (tx) => {
      const after = await tx.leaveRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", decidedById: caller.id, decidedAt: new Date(), comment: data.comment },
      });
      await recordAudit(tx, { entityType: "LeaveRequest", entityId: request.id, action: "update", actor: caller, before: request, after, fields: ["status", "decidedById", "comment"], label: leaveLabel });
    });
    revalidatePath("/vacations");
    return {};
  }

  if (!data.projectId) return { error: "Pick an internal project to track these days under." };
  const project = await prisma.project.findFirst({ where: { id: data.projectId, companyId: caller.companyId, isInternal: true } });
  if (!project) return { error: "Invalid internal project." };

  await provisionLeave(request.id, project.id, caller.id, (tx, before, after) =>
    recordAudit(tx, { entityType: "LeaveRequest", entityId: request.id, action: "update", actor: caller, before, after, fields: ["status", "decidedById"], label: leaveLabel, note: data.comment ?? null }),
  );
  if (data.comment) {
    await prisma.leaveRequest.update({ where: { id: request.id }, data: { comment: data.comment } });
  }
  revalidatePath("/vacations");
  revalidatePath("/planning");
  revalidatePath("/time");
  revalidatePath("/admin/scheduled-vs-actuals");
  return {};
}

export async function cancelVacationAction(requestId: string): Promise<{ error?: string }> {
  const caller = await requireUser();
  const request = await prisma.leaveRequest.findFirst({ where: { id: requestId, user: { companyId: caller.companyId } } });
  if (!request) return { error: "Request not found." };
  const isOwner = request.userId === caller.id || request.requestedById === caller.id;
  const isAdmin = can(caller, "vacations:manage");
  if (!isOwner && !isAdmin) return { error: "You cannot cancel this request." };
  // Cancelling after approval would need to unwind the auto-created assignment/plan/time
  // cards — not supported yet, so only pending (not-yet-provisioned) requests can be pulled back.
  if (request.status !== "PENDING") return { error: "Only pending requests can be cancelled." };

  await prisma.leaveRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
  revalidatePath("/vacations");
  return {};
}

const RecordReturnSchema = z.object({
  leaveRequestId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});
export type RecordLeaveReturnInput = z.infer<typeof RecordReturnSchema>;

/** Admin records someone coming back to work for part (or all of the rest) of an already-
 *  approved leave — un-provisions those specific days from Planning/Time Entry and, for
 *  VACATION, gives the days back to their balance. Handles both a permanent early return (one
 *  return period from the comeback date to the original end) and an intermittent one (a short
 *  return period with the leave continuing after) — same primitive either way, and a request can
 *  have several of these recorded over time. */
export async function recordLeaveReturnAction(input: RecordLeaveReturnInput): Promise<{ error?: string }> {
  const caller = await requirePermission("vacations:manage");
  const parsed = RecordReturnSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const data = parsed.data;

  const request = await prisma.leaveRequest.findFirst({
    where: { id: data.leaveRequestId, user: { companyId: caller.companyId } },
    include: { returns: true },
  });
  if (!request) return { error: "Request not found." };
  if (request.status !== "APPROVED") return { error: "Only approved leave can have a return recorded." };
  if (!request.assignmentId) return { error: "This leave hasn't been provisioned yet." };

  const startDate = parseISO(data.startDate);
  const endDate = parseISO(data.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return { error: "Invalid date." };
  if (endDate < startDate) return { error: "End date must be on or after the start date." };
  if (startDate < request.startDate || endDate > request.endDate) {
    return {
      error: `Return dates must fall within the original leave period (${format(request.startDate, "MMM d")} – ${format(request.endDate, "MMM d, yyyy")}).`,
    };
  }
  const overlaps = request.returns.some((r) => startDate <= r.endDate && endDate >= r.startDate);
  if (overlaps) return { error: "This range overlaps a return already recorded for this leave." };

  const workingDays = countWorkingDays(startDate, endDate);
  if (workingDays < 0) return { error: "That date range is too large — please pick a shorter period." };
  if (workingDays === 0) return { error: "That range has no working days — nothing to record." };

  try {
    await recordLeaveReturn(request.id, startDate, endDate, caller.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to record the return." };
  }

  revalidatePath("/vacations");
  revalidatePath("/planning");
  revalidatePath("/time");
  revalidatePath("/admin/scheduled-vs-actuals");
  return {};
}
