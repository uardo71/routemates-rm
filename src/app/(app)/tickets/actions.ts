"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma, TicketPriority } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { nextTicketNumber } from "@/lib/numbering";
import { TICKET_PRIORITY_LABEL, WORKFLOW_REJECTION, INTERNAL_NOTE_REFUSED } from "@/lib/ticket";
import { slaDeadlines } from "@/lib/sla.server";
import { isOpenCategory } from "@/lib/ticket-config";
import { loadTicketConfig, findType, initialStatus, initialStage } from "@/lib/ticket-config.server";
import { applyFieldValues, applyValuesForFields, fieldRawFromForm } from "@/lib/ticket-fields";
import { extractFiles } from "@/lib/ticket-attachments";
import { postTicketComment, editCommentBody, softDeleteComment } from "@/lib/ticket-comments";
import { notifyTicketParticipants, notifyTicketUser, userName } from "@/lib/ticket-notify";
import { deleteReceiptFile } from "@/lib/receipt-storage";
import { CR_MOVE_ONLY, isChangeRequestType } from "@/lib/change-request";
import { startChangeRequest } from "@/lib/change-request.server";
import { STAGE_MOVE_ONLY } from "@/lib/ticket-stages";
import { startTicketStage } from "@/lib/ticket-stages.server";

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

async function ticketForAction(ticketId: string, companyId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: {
      id: true, requesterId: true, assigneeId: true, createdById: true, priority: true, clientId: true,
      typeId: true, statusId: true, stageId: true, firstResponseAt: true, createdAt: true,
      typeDef: { select: { key: true, slaApplicable: true, lifecycleMode: true } },
      statusDef: { select: { name: true, category: true } },
    },
  });
}
type ActionTicket = NonNullable<Awaited<ReturnType<typeof ticketForAction>>>;
function involved(t: ActionTicket, userId: string) {
  return t.requesterId === userId || t.assigneeId === userId || t.createdById === userId;
}

async function logActivity(ticketId: string, authorId: string, kind: Prisma.TicketCommentCreateInput["kind"], body: string) {
  await prisma.ticketComment.create({ data: { ticketId, authorId, kind, body, internal: false } });
}

// ---------- create ----------

const CreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(240),
  description: z.string().trim().max(8000).optional(),
  typeId: z.string().min(1, "Type is required"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  clientId: z.string().optional(),
  projectId: z.string().optional(),
  assigneeId: z.string().optional(),
  requesterId: z.string().optional(),
  category: z.string().trim().max(120).optional(),
  systemRef: z.string().trim().max(120).optional(),
  moduleRef: z.string().trim().max(120).optional(),
  dueDate: z.string().optional(),
});

export async function createTicketAction(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = CreateSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    typeId: formData.get("typeId"),
    priority: formData.get("priority"),
    clientId: formData.get("clientId") || undefined,
    projectId: formData.get("projectId") || undefined,
    assigneeId: formData.get("assigneeId") || undefined,
    requesterId: formData.get("requesterId") || undefined,
    category: formData.get("category") ?? "",
    systemRef: formData.get("systemRef") ?? "",
    moduleRef: formData.get("moduleRef") ?? "",
    dueDate: formData.get("dueDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  // Triage rights (set requester/assignee) come from being on that client's team, not the role alone.
  const manage = await canManageClientTickets(user, d.clientId ?? null);

  const cfg = await loadTicketConfig(user.companyId);
  const type = findType(cfg, d.typeId);
  if (!type) return { error: "Unknown ticket type" };
  const initial = initialStatus(type);
  if (!initial) return { error: "This type has no statuses configured" };
  // A STAGE-mode type's lifecycle is its stages; it still carries a status (the archived list's
  // initial one) because Ticket.statusId is required, and that is what keeps the type reversible.
  const stage = initialStage(type);
  const rawFields = fieldRawFromForm(formData, cfg, d.typeId);

  const now = new Date();
  const sla = await slaDeadlines(user.companyId, d.clientId || null, d.priority, !type.slaApplicable, now);
  let id: string;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextTicketNumber(user.companyId, tx);
      const ticket = await tx.ticket.create({
        data: {
          companyId: user.companyId, number, title: d.title, description: d.description || null,
          typeId: type.id, priority: d.priority, statusId: initial.id, stageId: stage?.id ?? null,
          requesterId: manage && d.requesterId ? d.requesterId : user.id,
          assigneeId: manage ? d.assigneeId || null : null,
          createdById: user.id,
          clientId: d.clientId || null, projectId: d.projectId || null,
          category: d.category || null, systemRef: d.systemRef || null, moduleRef: d.moduleRef || null,
          dueDate: utcDate(d.dueDate),
          respondBy: sla.respondBy, resolveBy: sla.resolveBy,
          comments: { create: { authorId: user.id, kind: "CREATED", body: "raised the ticket" } },
        },
        select: { id: true },
      });
      await applyFieldValues(tx, ticket.id, type.id, rawFields, cfg);
      if (isChangeRequestType(type.key)) await startChangeRequest(tx, ticket.id, initial.key, user.id);
      else if (stage) await startTicketStage(tx, ticket.id, stage.key, user.id);
      return ticket;
    });
    id = created.id;
  } catch {
    return { error: "Could not create the ticket." };
  }
  if (manage && d.assigneeId) {
    await notifyTicketUser({ ticketId: id, companyId: user.companyId, userId: d.assigneeId, actorId: user.id, actorName: await userName(user.id), kind: "ASSIGN", summary: "assigned this ticket to you" });
  }
  // The restriction stays (requester/assignee are set only by whoever can triage this client's
  // tickets); what changes is that a value the person entered and we didn't keep is now said out
  // loud on the ticket they land on (lib/ticket.ts#createDropNotices), not silently ignored.
  const dropped: string[] = [];
  if (!manage && d.requesterId && d.requesterId !== user.id) dropped.push("requester");
  if (!manage && d.assigneeId) dropped.push("assignee");
  revalidatePath("/tickets");
  redirect(dropped.length > 0 ? `/tickets/${id}?dropped=${dropped.join(",")}&why=${d.clientId ? "team" : "noclient"}` : `/tickets/${id}`);
}

// ---------- status / assignee / priority ----------

export async function setTicketStatusAction(ticketId: string, statusId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!involved(t, user.id) && !(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  if (t.statusId === statusId) return {};
  if (isChangeRequestType(t.typeDef.key)) return { error: CR_MOVE_ONLY };
  if (t.typeDef.lifecycleMode === "STAGE") return { error: STAGE_MOVE_ONLY };
  const target = await prisma.ticketStatusDef.findFirst({
    where: { id: statusId, typeId: t.typeId, companyId: user.companyId },
    select: { name: true, category: true },
  });
  if (!target) return { error: "That status is not valid for this ticket's type" };

  const now = new Date();
  const data: Prisma.TicketUpdateInput = { statusDef: { connect: { id: statusId } } };
  if (!t.firstResponseAt) data.firstResponseAt = now;
  const wasOpen = isOpenCategory(t.statusDef.category);
  const nowOpen = isOpenCategory(target.category);
  if (!nowOpen && wasOpen) {
    if (target.category === "DONE") data.resolvedAt = now;
    data.closedAt = now;
  }
  if (nowOpen && !wasOpen) { data.resolvedAt = null; data.closedAt = null; }
  await prisma.ticket.update({ where: { id: ticketId }, data });
  const kind = !nowOpen && wasOpen ? "RESOLVED" : nowOpen && !wasOpen ? "REOPENED" : "STATUS";
  await logActivity(ticketId, user.id, kind, `${t.statusDef.name} → ${target.name}`);
  await notifyTicketParticipants({ ticketId, companyId: user.companyId, actorId: user.id, actorName: await userName(user.id), kind: "STATUS", summary: "changed the status" });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

export async function setTicketAssigneeAction(ticketId: string, assigneeId: string | null): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  const value = assigneeId || null;
  if ((t.assigneeId ?? null) === value) return {};
  const name = value ? (await prisma.user.findUnique({ where: { id: value }, select: { name: true } }))?.name ?? "someone" : null;
  await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId: value } });
  await logActivity(ticketId, user.id, "ASSIGN", name ? `assigned to ${name}` : "unassigned");
  if (value) await notifyTicketUser({ ticketId, companyId: user.companyId, userId: value, actorId: user.id, actorName: await userName(user.id), kind: "ASSIGN", summary: "assigned this ticket to you" });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

export async function setTicketPriorityAction(ticketId: string, priority: TicketPriority): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  if (t.priority === priority) return {};
  const sla = await slaDeadlines(user.companyId, t.clientId, priority, !t.typeDef.slaApplicable, t.createdAt);
  await prisma.ticket.update({ where: { id: ticketId }, data: { priority, ...sla } });
  await logActivity(ticketId, user.id, "PRIORITY", `${TICKET_PRIORITY_LABEL[t.priority]} → ${TICKET_PRIORITY_LABEL[priority]}`);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

// ---------- details + custom fields ----------

const DetailsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(8000),
  typeId: z.string().min(1),
  clientId: z.string().nullable(),
  projectId: z.string().nullable(),
  category: z.string().trim().max(120),
  systemRef: z.string().trim().max(120),
  moduleRef: z.string().trim().max(120),
  dueDate: z.string().nullable(),
  resolution: z.string().trim().max(8000),
  fields: z.record(z.string(), z.unknown()).optional(),
});
export async function updateTicketDetailsAction(ticketId: string, patch: z.infer<typeof DetailsSchema>): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  const parsed = DetailsSchema.safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const cfg = await loadTicketConfig(user.companyId);
  const newType = findType(cfg, d.typeId);
  if (!newType) return { error: "Unknown ticket type" };

  const typeChanged = d.typeId !== t.typeId;
  const data: Prisma.TicketUncheckedUpdateInput = {
    title: d.title, description: d.description || null,
    typeId: d.typeId,
    clientId: d.clientId || null, projectId: d.projectId || null,
    category: d.category || null, systemRef: d.systemRef || null, moduleRef: d.moduleRef || null,
    dueDate: utcDate(d.dueDate), resolution: d.resolution || null,
  };
  let initKey: string | null = null;
  let newStage: { id: string; key: string } | null = null;
  if (typeChanged) {
    const init = initialStatus(newType);
    if (!init) return { error: "Target type has no statuses" };
    data.statusId = init.id;
    initKey = init.key;
    // Onto the new type's starting stage, or off stages entirely for a STATUS-mode type.
    newStage = initialStage(newType);
    data.stageId = newStage?.id ?? null;
  }
  // A different client or type re-applies the SLA from the created date — or clears it for a type
  // without SLA (change requests).
  const newClientId = d.clientId || null;
  if (typeChanged || newClientId !== (t.clientId ?? null)) {
    Object.assign(data, await slaDeadlines(user.companyId, newClientId, t.priority, !newType.slaApplicable, t.createdAt));
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data });
      if (d.fields) {
        await applyFieldValues(tx, ticketId, d.typeId, d.fields, cfg);
        // A STAGE-mode type's stage-scoped fields ride the same draft and the same Save. Only ids
        // the client actually sent are written, so this can never touch a field it wasn't given.
        const staged = findType(cfg, d.typeId)?.stageFields ?? [];
        if (staged.length > 0) await applyValuesForFields(tx, ticketId, staged, d.fields);
      }
      if (typeChanged) {
        await tx.ticketComment.create({ data: { ticketId, authorId: user.id, kind: "STATUS", body: `type changed to ${newType.name}`, internal: false } });
        if (isChangeRequestType(newType.key) && initKey) await startChangeRequest(tx, ticketId, initKey, user.id);
        else if (newStage) await startTicketStage(tx, ticketId, newStage.key, user.id);
      }
    });
  } catch {
    return { error: "Could not update the ticket." };
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

// ---------- staged workflow save (explicit, not autosave) ----------

export async function applyWorkflowAction(
  ticketId: string,
  patch: { statusId?: string; assigneeId?: string | null; priority?: TicketPriority },
): Promise<{ error?: string; rejected?: string[] }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  const manage = await canManageClientTickets(user, t.clientId);
  if (!manage && !involved(t, user.id)) return { error: "Forbidden" };

  // Status — allowed for involved users; assignee/priority are manage-only. A change request's
  // status is its lifecycle stage and only moves through moveChangeRequestAction.
  if (patch.statusId && patch.statusId !== t.statusId) {
    if (isChangeRequestType(t.typeDef.key)) return { error: CR_MOVE_ONLY };
    if (t.typeDef.lifecycleMode === "STAGE") return { error: STAGE_MOVE_ONLY };
    const target = await prisma.ticketStatusDef.findFirst({ where: { id: patch.statusId, typeId: t.typeId, companyId: user.companyId }, select: { name: true, category: true } });
    if (!target) return { error: "That status is not valid for this ticket's type" };
    const now = new Date();
    const data: Prisma.TicketUncheckedUpdateInput = { statusId: patch.statusId };
    if (!t.firstResponseAt) data.firstResponseAt = now;
    const wasOpen = isOpenCategory(t.statusDef.category);
    const nowOpen = isOpenCategory(target.category);
    if (!nowOpen && wasOpen) { if (target.category === "DONE") data.resolvedAt = now; data.closedAt = now; }
    if (nowOpen && !wasOpen) { data.resolvedAt = null; data.closedAt = null; }
    await prisma.ticket.update({ where: { id: ticketId }, data });
    const kind = !nowOpen && wasOpen ? "RESOLVED" : nowOpen && !wasOpen ? "REOPENED" : "STATUS";
    await logActivity(ticketId, user.id, kind, `${t.statusDef.name} → ${target.name}`);
    await notifyTicketParticipants({ ticketId, companyId: user.companyId, actorId: user.id, actorName: await userName(user.id), kind: "STATUS", summary: "changed the status" });
  }

  // Same order and same restriction as before; a refused change is now reported back (named, with
  // the reason) instead of being dropped without a word.
  const rejected: string[] = [];
  if (patch.assigneeId !== undefined && (patch.assigneeId || null) !== (t.assigneeId ?? null)) {
    if (!manage) rejected.push(WORKFLOW_REJECTION.assignee);
    else {
      const value = patch.assigneeId || null;
      const name = value ? (await prisma.user.findUnique({ where: { id: value }, select: { name: true } }))?.name ?? "someone" : null;
      await prisma.ticket.update({ where: { id: ticketId }, data: { assigneeId: value } });
      await logActivity(ticketId, user.id, "ASSIGN", name ? `assigned to ${name}` : "unassigned");
      if (value) await notifyTicketUser({ ticketId, companyId: user.companyId, userId: value, actorId: user.id, actorName: await userName(user.id), kind: "ASSIGN", summary: "assigned this ticket to you" });
    }
  }

  if (patch.priority && patch.priority !== t.priority) {
    if (!manage) rejected.push(WORKFLOW_REJECTION.priority);
    else {
      const sla = await slaDeadlines(user.companyId, t.clientId, patch.priority, !t.typeDef.slaApplicable, t.createdAt);
      await prisma.ticket.update({ where: { id: ticketId }, data: { priority: patch.priority, ...sla } });
      await logActivity(ticketId, user.id, "PRIORITY", `${TICKET_PRIORITY_LABEL[t.priority]} → ${TICKET_PRIORITY_LABEL[patch.priority]}`);
    }
  }

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return rejected.length > 0 ? { rejected } : {};
}

// ---------- comments (with attachments + threaded replies) / worklog ----------

export async function addCommentAction(ticketId: string, formData: FormData): Promise<{ error?: string; notice?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  const manage = await canManageClientTickets(user, t.clientId);
  if (!manage && !involved(t, user.id)) return { error: "Forbidden" };

  const files = extractFiles(formData);
  const wantsInternal = formData.get("internal") === "1";
  const res = await postTicketComment({
    ticketId, companyId: user.companyId, authorId: user.id,
    body: String(formData.get("body") ?? ""),
    parentId: (formData.get("parentId") as string) || null,
    internal: manage && wantsInternal,
    files, setFirstResponse: true,
  });
  if (res.error) return { error: res.error };
  revalidatePath(`/tickets/${ticketId}`);
  // Still posted — but as a regular comment, and the person is told so instead of believing it's internal.
  return wantsInternal && !manage ? { notice: INTERNAL_NOTE_REFUSED } : {};
}

export async function updateTicketDescriptionAction(ticketId: string, description: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  if (description.length > 8000) return { error: "Description is too long." };
  await prisma.ticket.update({ where: { id: ticketId }, data: { description: description.trim() || null } });
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

async function commentForAction(commentId: string, companyId: string) {
  return prisma.ticketComment.findFirst({ where: { id: commentId, ticket: { companyId } }, select: { authorId: true, ticketId: true, deletedAt: true, ticket: { select: { clientId: true } } } });
}

export async function editCommentAction(commentId: string, body: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const c = await commentForAction(commentId, user.companyId);
  if (!c || c.deletedAt) return { error: "Not found" };
  if (c.authorId !== user.id && !(await canManageClientTickets(user, c.ticket.clientId))) return { error: "You can only edit your own messages" };
  if (!body.trim()) return { error: "Message can't be empty" };
  await editCommentBody(commentId, body);
  revalidatePath(`/tickets/${c.ticketId}`);
  return {};
}

export async function deleteCommentAction(commentId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const c = await commentForAction(commentId, user.companyId);
  if (!c || c.deletedAt) return { error: "Not found" };
  if (c.authorId !== user.id && !(await canManageClientTickets(user, c.ticket.clientId))) return { error: "You can only delete your own messages" };
  await softDeleteComment(commentId);
  revalidatePath(`/tickets/${c.ticketId}`);
  return {};
}

export async function deleteTicketAttachmentAction(attachmentId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const a = await prisma.ticketAttachment.findFirst({ where: { id: attachmentId, companyId: user.companyId }, select: { fileName: true, uploadedById: true, ticketId: true, ticket: { select: { clientId: true } } } });
  if (!a) return { error: "Not found" };
  if (a.uploadedById !== user.id && !(await canManageClientTickets(user, a.ticket.clientId))) return { error: "Forbidden" };
  await prisma.ticketAttachment.delete({ where: { id: attachmentId } });
  await deleteReceiptFile(a.fileName, "tickets");
  revalidatePath(`/tickets/${a.ticketId}`);
  return {};
}

export async function addWorklogAction(ticketId: string, minutes: number, workedOn: string | null, note: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const t = await ticketForAction(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  if (!involved(t, user.id) && !(await canManageClientTickets(user, t.clientId))) return { error: "Forbidden" };
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 100000) return { error: "Enter a valid duration" };
  await prisma.ticketWorklog.create({ data: { ticketId, userId: user.id, minutes: Math.round(minutes), workedOn: utcDate(workedOn), note: note.trim() || null } });
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

export async function deleteWorklogAction(worklogId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const w = await prisma.ticketWorklog.findFirst({ where: { id: worklogId, ticket: { companyId: user.companyId } }, select: { userId: true, ticketId: true, ticket: { select: { clientId: true } } } });
  if (!w) return { error: "Not found" };
  if (w.userId !== user.id && !(await canManageClientTickets(user, w.ticket.clientId))) return { error: "Forbidden" };
  await prisma.ticketWorklog.delete({ where: { id: worklogId } });
  revalidatePath(`/tickets/${w.ticketId}`);
  return {};
}
