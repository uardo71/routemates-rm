"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePortalUser } from "@/lib/portal";
import { nextTicketNumber } from "@/lib/numbering";
import { slaDeadlines } from "@/lib/sla.server";
import { CR_MOVE_ONLY, isChangeRequestType } from "@/lib/change-request";
import { startChangeRequest } from "@/lib/change-request.server";
import { STAGE_MOVE_ONLY } from "@/lib/ticket-stages";
import { startTicketStage } from "@/lib/ticket-stages.server";
import { notifyTicketParticipants, userName } from "@/lib/ticket-notify";
import { isOpenCategory } from "@/lib/ticket-config";
import { loadTicketConfig, findType, initialStatus, initialStage } from "@/lib/ticket-config.server";
import { applyFieldValues, fieldRawFromForm } from "@/lib/ticket-fields";
import { extractFiles } from "@/lib/ticket-attachments";
import { postTicketComment, editCommentBody, softDeleteComment } from "@/lib/ticket-comments";
import { deleteReceiptFile } from "@/lib/receipt-storage";

/** A ticket the portal user is allowed to act on: same company AND their own client. */
async function portalTicket(ticketId: string, companyId: string, clientId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, companyId, clientId },
    select: { id: true, typeId: true, statusId: true, firstResponseAt: true, typeDef: { select: { key: true, lifecycleMode: true } }, statusDef: { select: { category: true, name: true } } },
  });
}

const CreateSchema = z.object({
  title: z.string().trim().min(1, "Please describe the issue").max(240),
  description: z.string().trim().max(8000).optional(),
  typeId: z.string().min(1, "Choose a type"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});

export async function createPortalTicketAction(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const parsed = CreateSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    typeId: formData.get("typeId"),
    priority: formData.get("priority") || "MEDIUM",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const cfg = await loadTicketConfig(u.companyId);
  const type = findType(cfg, d.typeId);
  if (!type || !type.customerCanCreate) return { error: "You can't raise that type of ticket." };
  const initial = initialStatus(type);
  if (!initial) return { error: "This type isn't available right now." };
  // A STAGE-mode type starts on its starting stage; it keeps a status too (Ticket.statusId is
  // required), taken from the archived list the type reverts to.
  const stage = initialStage(type);
  const rawFields = fieldRawFromForm(formData, cfg, d.typeId);

  const now = new Date();
  const sla = await slaDeadlines(u.companyId, u.clientId, d.priority, !type.slaApplicable, now);
  let id: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(u.companyId, tx);
      const ticket = await tx.ticket.create({
        data: {
          companyId: u.companyId, number, title: d.title, description: d.description || null,
          typeId: type.id, priority: d.priority, statusId: initial.id, stageId: stage?.id ?? null,
          requesterId: u.id, createdById: u.id, clientId: u.clientId,
          respondBy: sla.respondBy, resolveBy: sla.resolveBy,
          comments: { create: { authorId: u.id, kind: "CREATED", body: "raised the ticket", internal: false } },
        },
        select: { id: true },
      });
      await applyFieldValues(tx, ticket.id, type.id, rawFields, cfg, "creatable");
      if (isChangeRequestType(type.key)) await startChangeRequest(tx, ticket.id, initial.key, u.id);
      else if (stage) await startTicketStage(tx, ticket.id, stage.key, u.id);
      return ticket;
    });
    id = created.id;
  } catch {
    return { error: "Could not submit the ticket. Please try again." };
  }
  revalidatePath("/portal");
  redirect(`/portal/${id}`);
}

export async function addPortalCommentAction(ticketId: string, formData: FormData): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const t = await portalTicket(ticketId, u.companyId, u.clientId);
  if (!t) return { error: "Not found" };
  // Customers may only reply to comments they can actually see (never an internal staff note).
  const parentId = (formData.get("parentId") as string) || null;
  if (parentId) {
    const parent = await prisma.ticketComment.findFirst({ where: { id: parentId, ticketId }, select: { internal: true } });
    if (!parent || parent.internal) return { error: "That message can't be replied to." };
  }
  const res = await postTicketComment({
    ticketId, companyId: u.companyId, authorId: u.id,
    body: String(formData.get("body") ?? ""), parentId, internal: false,
    files: extractFiles(formData), setFirstResponse: false,
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/portal/${ticketId}`);
  return {};
}

async function ownPortalComment(commentId: string, u: { id: string; companyId: string; clientId: string }) {
  return prisma.ticketComment.findFirst({
    where: { id: commentId, authorId: u.id, internal: false, deletedAt: null, ticket: { companyId: u.companyId, clientId: u.clientId } },
    select: { ticketId: true },
  });
}

export async function editPortalCommentAction(commentId: string, body: string): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const c = await ownPortalComment(commentId, u);
  if (!c) return { error: "Not found" };
  if (!body.trim()) return { error: "Message can't be empty" };
  await editCommentBody(commentId, body);
  revalidatePath(`/portal/${c.ticketId}`);
  return {};
}

export async function deletePortalCommentAction(commentId: string): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const c = await ownPortalComment(commentId, u);
  if (!c) return { error: "Not found" };
  await softDeleteComment(commentId);
  revalidatePath(`/portal/${c.ticketId}`);
  return {};
}

export async function deletePortalAttachmentAction(attachmentId: string): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const a = await prisma.ticketAttachment.findFirst({
    where: { id: attachmentId, companyId: u.companyId, uploadedById: u.id, ticket: { clientId: u.clientId } },
    select: { fileName: true, ticketId: true },
  });
  if (!a) return { error: "Not found" };
  await prisma.ticketAttachment.delete({ where: { id: attachmentId } });
  await deleteReceiptFile(a.fileName, "tickets");
  revalidatePath(`/portal/${a.ticketId}`);
  return {};
}

export async function setPortalStatusAction(ticketId: string, statusId: string): Promise<{ error?: string }> {
  const u = await requirePortalUser();
  const t = await portalTicket(ticketId, u.companyId, u.clientId);
  if (!t) return { error: "Not found" };
  if (t.statusId === statusId) return {};
  if (isChangeRequestType(t.typeDef.key)) return { error: CR_MOVE_ONLY };
  if (t.typeDef.lifecycleMode === "STAGE") return { error: STAGE_MOVE_ONLY };
  const target = await prisma.ticketStatusDef.findFirst({
    where: { id: statusId, typeId: t.typeId, companyId: u.companyId, customerVisible: true, customerCanSet: true },
    select: { name: true, category: true },
  });
  if (!target) return { error: "You can't move the ticket to that status." };

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { statusId };
  const wasOpen = isOpenCategory(t.statusDef.category);
  const nowOpen = isOpenCategory(target.category);
  if (!nowOpen && wasOpen) { if (target.category === "DONE") data.resolvedAt = now; data.closedAt = now; }
  if (nowOpen && !wasOpen) { data.resolvedAt = null; data.closedAt = null; }
  await prisma.ticket.update({ where: { id: ticketId }, data });
  const kind = !nowOpen && wasOpen ? "RESOLVED" : nowOpen && !wasOpen ? "REOPENED" : "STATUS";
  await prisma.ticketComment.create({ data: { ticketId, authorId: u.id, kind, body: `${t.statusDef.name} → ${target.name}`, internal: false } });
  await notifyTicketParticipants({ ticketId, companyId: u.companyId, actorId: u.id, actorName: await userName(u.id), kind: "STATUS", summary: "changed the status" });
  revalidatePath(`/portal/${ticketId}`);
  revalidatePath("/portal");
  return {};
}
