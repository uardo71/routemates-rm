"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { isOpenCategory } from "@/lib/ticket-config";
import {
  CR_STAGES, asCrStage, crRecordFromDraft, decideCrMove, isChangeRequestType, parseHours, type CrDraft,
} from "@/lib/change-request";
import { loadCrDraft, evidenceByStage } from "@/lib/change-request.server";
import { crValuesFromDraft } from "@/lib/change-request-fields";
import { loadTicketConfig, findType } from "@/lib/ticket-config.server";
import { applyValuesForFields } from "@/lib/ticket-fields";
import { extractFiles, validateFiles, saveTicketAttachments, cleanupSaved } from "@/lib/ticket-attachments";
import { notifyTicketParticipants, notifyTicketUser, userName } from "@/lib/ticket-notify";

// Change-request lifecycle actions: save the record, move between stages (gated by
// src/lib/change-request.ts), and file attachments on the ticket, optionally under a stage.

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

async function loadTicket(ticketId: string, companyId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: {
      id: true, clientId: true, requesterId: true, assigneeId: true, createdById: true, typeId: true,
      resolution: true, firstResponseAt: true,
      typeDef: { select: { key: true } },
      statusDef: { select: { key: true, name: true, category: true } },
      changeRequest: true,
    },
  });
}
type LoadedTicket = NonNullable<Awaited<ReturnType<typeof loadTicket>>>;
const isInvolved = (t: LoadedTicket, userId: string) => t.requesterId === userId || t.assigneeId === userId || t.createdById === userId;

async function access(ticketId: string) {
  const user = await requireUser();
  const t = await loadTicket(ticketId, user.companyId);
  if (!t) return { error: "Not found" as const };
  const canManage = await canManageClientTickets(user, t.clientId);
  const involved = isInvolved(t, user.id);
  if (!canManage && !involved) return { error: "Forbidden" as const };
  return { user, t, canManage, involved };
}

// ---------- the record ----------

const text = (max: number) => z.string().max(max);
const DraftSchema = z.object({
  assessment: text(8000), estimateHours: text(20), quoteReference: text(200),
  approvedByName: text(200), approvedOn: text(10), approvalReference: text(200),
  plannedGoLive: text(10), buildReference: text(2000),
  unitTestNotes: text(8000), unitTestedOn: text(10),
  uatSignedOffBy: text(200), uatSignedOffOn: text(10), uatNotes: text(8000),
  goLiveOn: text(10),
  nextStep: text(500), nextStepOwnerId: text(40), nextStepDue: text(10),
});

export async function saveChangeRequestAction(ticketId: string, draft: CrDraft): Promise<{ error?: string }> {
  const a = await access(ticketId);
  if ("error" in a) return { error: a.error };
  const { user, t } = a;
  if (!isChangeRequestType(t.typeDef.key)) return { error: "This ticket isn't a change request." };
  const parsed = DraftSchema.safeParse(draft);
  if (!parsed.success) return { error: "One of the change-request fields is too long." };
  const d = parsed.data;
  const hours = parseHours(d.estimateHours);
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 100000)) return { error: "The estimate must be a number of hours." };

  const ownerId = d.nextStepOwnerId || null;
  if (ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerId, companyId: user.companyId, active: true, role: { not: "CUSTOMER" } }, select: { id: true } });
    if (!owner) return { error: "Pick the next-step owner from the team." };
  }
  const s = (v: string) => v.trim() || null;
  // The record lives in stage-scoped custom fields now (see lib/change-request-fields.ts). Only the
  // next step stays on the ChangeRequest row; the old columns are left as they are, unused.
  const nextStepData = { nextStep: s(d.nextStep), nextStepOwnerId: ownerId, nextStepDue: utcDate(d.nextStepDue) };
  const cfg = await loadTicketConfig(user.companyId);
  const stageFields = findType(cfg, t.typeId)?.stageFields ?? [];
  const fieldByKey = new Map(stageFields.map((f) => [f.key, f]));
  const rawById: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(crValuesFromDraft(d, hours))) {
    const f = fieldByKey.get(fieldKey);
    if (f) rawById[f.id] = value;
  }
  await prisma.$transaction(async (tx) => {
    await tx.changeRequest.upsert({ where: { ticketId }, create: { ticketId, ...nextStepData }, update: nextStepData });
    await applyValuesForFields(tx, ticketId, stageFields, rawById);
  });

  if (ownerId && ownerId !== user.id && ownerId !== (t.changeRequest?.nextStepOwnerId ?? null)) {
    await notifyTicketUser({ ticketId, companyId: user.companyId, userId: ownerId, actorId: user.id, actorName: await userName(user.id), kind: "ASSIGN", summary: "made you the owner of the next step" });
  }
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

// ---------- stage moves ----------

export async function moveChangeRequestAction(
  ticketId: string, input: { to: string; note?: string; overrideReason?: string },
): Promise<{ error?: string }> {
  const a = await access(ticketId);
  if ("error" in a) return { error: a.error };
  const { user, t, canManage, involved } = a;
  if (!isChangeRequestType(t.typeDef.key)) return { error: "This ticket isn't a change request." };
  const from = asCrStage(t.statusDef.key);
  if (!from) return { error: `"${t.statusDef.name}" isn't one of the lifecycle stages, so the change request can't be moved from it.` };
  const to = asCrStage(input.to);
  if (!to) return { error: "Unknown stage." };

  const record = crRecordFromDraft(await loadCrDraft(ticketId, user.companyId, t.typeId), {
    assigneeId: t.assigneeId, resolution: t.resolution, evidence: await evidenceByStage(ticketId),
  });
  const note = input.note?.trim() || null;
  const overrideReason = input.overrideReason?.trim() || null;
  const decision = decideCrMove({ from, to, record, canManage, involved, note, overrideReason });
  if (!decision.ok) return { error: decision.error };

  const target = await prisma.ticketStatusDef.findFirst({ where: { typeId: t.typeId, key: to }, select: { id: true, category: true } });
  if (!target) return { error: `This ticket type has no "${CR_STAGES[to].label}" status — check the change-request type in ticket settings.` };

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { statusId: target.id };
  if (!t.firstResponseAt) data.firstResponseAt = now;
  const wasOpen = isOpenCategory(t.statusDef.category);
  const nowOpen = isOpenCategory(target.category);
  if (!nowOpen && wasOpen) { if (target.category === "DONE") data.resolvedAt = now; data.closedAt = now; }
  if (nowOpen && !wasOpen) { data.resolvedAt = null; data.closedAt = null; }

  const label = `${CR_STAGES[from].label} → ${CR_STAGES[to].label}`;
  const body = [label, note, decision.overridden ? `checks overridden: ${overrideReason}` : null].filter(Boolean).join(" — ");
  const kind = to === "closed" ? "RESOLVED" : decision.kind === "REOPEN" ? "REOPENED" : "STATUS";
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticketId }, data });
    await tx.changeRequest.upsert({ where: { ticketId }, create: { ticketId }, update: {} });
    await tx.changeRequestStageEvent.create({
      data: { ticketId, fromKey: from, toKey: to, move: decision.kind, note, overrideReason: decision.overridden ? overrideReason : null, byId: user.id },
    });
    await tx.ticketComment.create({ data: { ticketId, authorId: user.id, kind, body, internal: false } });
  });
  await notifyTicketParticipants({
    ticketId, companyId: user.companyId, actorId: user.id, actorName: await userName(user.id),
    kind: "STATUS", summary: `moved the change request to ${CR_STAGES[to].label}`,
  });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

// ---------- files on the ticket ----------

export async function uploadTicketFilesAction(ticketId: string, formData: FormData): Promise<{ error?: string }> {
  const a = await access(ticketId);
  if ("error" in a) return { error: a.error };
  const { user, t } = a;
  const files = extractFiles(formData);
  if (files.length === 0) return { error: "Choose at least one file." };
  const invalid = validateFiles(files);
  if (invalid) return { error: invalid };
  const stageKey = isChangeRequestType(t.typeDef.key) ? asCrStage(String(formData.get("stageKey") ?? "")) : null;

  const saved = await saveTicketAttachments(files);
  try {
    await prisma.ticketAttachment.createMany({
      data: saved.map((f) => ({
        ticketId, companyId: user.companyId, fileName: f.fileName, originalName: f.originalName,
        mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedById: user.id, stageKey,
      })),
    });
  } catch {
    await cleanupSaved(saved);
    return { error: "Could not save the files. Please try again." };
  }
  await notifyTicketParticipants({
    ticketId, companyId: user.companyId, actorId: user.id, actorName: await userName(user.id),
    kind: "COMMENT", summary: `attached ${saved.length === 1 ? `"${saved[0].originalName}"` : `${saved.length} files`}`,
  });
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

/** File an attachment (also one posted in the discussion) under a lifecycle stage, or none. */
export async function setAttachmentStageAction(attachmentId: string, stageKey: string | null): Promise<{ error?: string }> {
  const user = await requireUser();
  const att = await prisma.ticketAttachment.findFirst({
    where: { id: attachmentId, companyId: user.companyId },
    select: { ticketId: true, uploadedById: true, ticket: { select: { clientId: true, typeDef: { select: { key: true } } } } },
  });
  if (!att) return { error: "Not found" };
  if (!isChangeRequestType(att.ticket.typeDef.key)) return { error: "Only change-request files are filed under a stage." };
  if (att.uploadedById !== user.id && !(await canManageClientTickets(user, att.ticket.clientId))) return { error: "Forbidden" };
  const key = stageKey ? asCrStage(stageKey) : null;
  if (stageKey && !key) return { error: "Unknown stage." };
  await prisma.ticketAttachment.update({ where: { id: attachmentId }, data: { stageKey: key } });
  revalidatePath(`/tickets/${att.ticketId}`);
  return {};
}
