"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { TicketStatusCategory, TicketFieldKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { fieldNeedsOptions } from "@/lib/ticket-config";
import { slaDeadlines } from "@/lib/sla.server";

async function guard() {
  const user = await requireUser();
  if (!can(user, "tickets:manage")) return { user, ok: false as const };
  return { user, ok: true as const };
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";
}
function uniqueKey(base: string, existing: Set<string>): string {
  let k = base, i = 2;
  while (existing.has(k)) k = `${base}_${i++}`;
  return k;
}
const done = () => { revalidatePath("/tickets/settings"); revalidatePath("/tickets"); return {}; };

// ---------- types ----------

const TypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(40),
  color: z.string().trim().max(20),
  description: z.string().trim().max(300),
  customerCanCreate: z.boolean(),
  slaExempt: z.boolean().default(false),
});

/** A type's SLA flag changed: clear every ticket's deadlines, or re-apply them from each ticket's
 *  created date (client override, else company default) to the tickets still open. */
async function reapplyTypeSla(companyId: string, typeId: string, slaExempt: boolean): Promise<void> {
  if (slaExempt) {
    await prisma.ticket.updateMany({ where: { companyId, typeId }, data: { respondBy: null, resolveBy: null } });
    return;
  }
  const open = await prisma.ticket.findMany({
    where: { companyId, typeId, statusDef: { category: { in: ["OPEN", "IN_PROGRESS"] } } },
    select: { id: true, clientId: true, priority: true, createdAt: true },
  });
  for (const t of open) {
    await prisma.ticket.update({ where: { id: t.id }, data: await slaDeadlines(companyId, t.clientId, t.priority, false, t.createdAt) });
  }
}

export async function createTicketTypeAction(input: z.infer<typeof TypeSchema>): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const d = TypeSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  const existing = await prisma.ticketTypeDef.findMany({ where: { companyId: user.companyId }, select: { key: true, order: true } });
  const key = uniqueKey(slug(d.data.name), new Set(existing.map((e) => e.key)));
  const order = existing.reduce((m, e) => Math.max(m, e.order), -1) + 1;
  await prisma.ticketTypeDef.create({
    data: {
      companyId: user.companyId, key, name: d.data.name, icon: d.data.icon || "ticket", color: d.data.color || "sky",
      description: d.data.description || null, customerCanCreate: d.data.customerCanCreate,
      // slaApplicable is what the code reads; slaExempt is kept in step so the two never disagree.
      slaExempt: d.data.slaExempt, slaApplicable: !d.data.slaExempt, order,
      statuses: {
        create: [
          { companyId: user.companyId, key: "open", name: "Open", color: "violet", category: "OPEN", order: 0, isInitial: true },
          { companyId: user.companyId, key: "in_progress", name: "In progress", color: "sky", category: "IN_PROGRESS", order: 1 },
          { companyId: user.companyId, key: "resolved", name: "Resolved", color: "emerald", category: "DONE", order: 2 },
          { companyId: user.companyId, key: "closed", name: "Closed", color: "gray", category: "DONE", order: 3, customerCanSet: true },
        ],
      },
    },
  });
  return done();
}

export async function updateTicketTypeAction(id: string, input: z.infer<typeof TypeSchema> & { active?: boolean }): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const type = await prisma.ticketTypeDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, slaExempt: true } });
  if (!type) return { error: "Not found" };
  const d = TypeSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  await prisma.ticketTypeDef.update({
    where: { id },
    data: {
      name: d.data.name, icon: d.data.icon || "ticket", color: d.data.color || "sky",
      description: d.data.description || null, customerCanCreate: d.data.customerCanCreate,
      slaExempt: d.data.slaExempt, slaApplicable: !d.data.slaExempt,
      ...(typeof input.active === "boolean" ? { active: input.active } : {}),
    },
  });
  if (type.slaExempt !== d.data.slaExempt) await reapplyTypeSla(user.companyId, id, d.data.slaExempt);
  return done();
}

export async function setDefaultTypeAction(id: string): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const type = await prisma.ticketTypeDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!type) return { error: "Not found" };
  await prisma.$transaction([
    prisma.ticketTypeDef.updateMany({ where: { companyId: user.companyId }, data: { isDefault: false } }),
    prisma.ticketTypeDef.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return done();
}

export async function deleteTicketTypeAction(id: string): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const type = await prisma.ticketTypeDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!type) return { error: "Not found" };
  const inUse = await prisma.ticket.count({ where: { typeId: id } });
  if (inUse > 0) return { error: `This type is used by ${inUse} ticket(s). Deactivate it instead.` };
  await prisma.ticketTypeDef.delete({ where: { id } }); // cascades statuses + type fields
  return done();
}

export async function moveTicketTypeAction(id: string, dir: "up" | "down"): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const types = await prisma.ticketTypeDef.findMany({ where: { companyId: user.companyId }, orderBy: { order: "asc" }, select: { id: true } });
  const i = types.findIndex((t) => t.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= types.length) return {};
  await prisma.$transaction([
    prisma.ticketTypeDef.update({ where: { id: types[i].id }, data: { order: j } }),
    prisma.ticketTypeDef.update({ where: { id: types[j].id }, data: { order: i } }),
  ]);
  return done();
}

// ---------- statuses ----------

const StatusSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().max(20),
  category: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]),
  customerVisible: z.boolean(),
  customerCanSet: z.boolean(),
});

export async function createStatusAction(typeId: string, input: z.infer<typeof StatusSchema>): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const type = await prisma.ticketTypeDef.findFirst({ where: { id: typeId, companyId: user.companyId }, select: { id: true, statuses: { select: { key: true, order: true } } } });
  if (!type) return { error: "Not found" };
  const d = StatusSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  const key = uniqueKey(slug(d.data.name), new Set(type.statuses.map((s) => s.key)));
  const order = type.statuses.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  await prisma.ticketStatusDef.create({
    data: {
      companyId: user.companyId, typeId, key, name: d.data.name, color: d.data.color || "gray",
      category: d.data.category as TicketStatusCategory, order,
      customerVisible: d.data.customerVisible, customerCanSet: d.data.customerCanSet,
    },
  });
  return done();
}

export async function updateStatusAction(id: string, input: z.infer<typeof StatusSchema>): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const s = await prisma.ticketStatusDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!s) return { error: "Not found" };
  const d = StatusSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  await prisma.ticketStatusDef.update({
    where: { id },
    data: { name: d.data.name, color: d.data.color || "gray", category: d.data.category as TicketStatusCategory, customerVisible: d.data.customerVisible, customerCanSet: d.data.customerCanSet },
  });
  return done();
}

export async function setInitialStatusAction(id: string): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const s = await prisma.ticketStatusDef.findFirst({ where: { id, companyId: user.companyId }, select: { typeId: true } });
  if (!s) return { error: "Not found" };
  await prisma.$transaction([
    prisma.ticketStatusDef.updateMany({ where: { typeId: s.typeId }, data: { isInitial: false } }),
    prisma.ticketStatusDef.update({ where: { id }, data: { isInitial: true } }),
  ]);
  return done();
}

export async function deleteStatusAction(id: string): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const s = await prisma.ticketStatusDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, typeId: true, isInitial: true } });
  if (!s) return { error: "Not found" };
  const inUse = await prisma.ticket.count({ where: { statusId: id } });
  if (inUse > 0) return { error: `This status is used by ${inUse} ticket(s).` };
  const count = await prisma.ticketStatusDef.count({ where: { typeId: s.typeId } });
  if (count <= 1) return { error: "A type must keep at least one status." };
  if (s.isInitial) return { error: "Pick another starting status before deleting this one." };
  await prisma.ticketStatusDef.delete({ where: { id } });
  return done();
}

export async function moveStatusAction(id: string, dir: "up" | "down"): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const s = await prisma.ticketStatusDef.findFirst({ where: { id, companyId: user.companyId }, select: { typeId: true } });
  if (!s) return { error: "Not found" };
  const list = await prisma.ticketStatusDef.findMany({ where: { typeId: s.typeId }, orderBy: { order: "asc" }, select: { id: true } });
  const i = list.findIndex((x) => x.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return {};
  await prisma.$transaction([
    prisma.ticketStatusDef.update({ where: { id: list[i].id }, data: { order: j } }),
    prisma.ticketStatusDef.update({ where: { id: list[j].id }, data: { order: i } }),
  ]);
  return done();
}

// ---------- fields ----------

const FieldSchema = z.object({
  typeId: z.string().nullable(),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "MULTISELECT", "CHECKBOX", "USER"]),
  options: z.array(z.string().trim().min(1).max(60)).max(50),
  required: z.boolean(),
  customerVisible: z.boolean(),
  customerEditable: z.boolean(),
});

export async function createFieldAction(input: z.infer<typeof FieldSchema>): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const d = FieldSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  if (d.data.typeId) {
    const type = await prisma.ticketTypeDef.findFirst({ where: { id: d.data.typeId, companyId: user.companyId }, select: { id: true } });
    if (!type) return { error: "Unknown type" };
  }
  if (fieldNeedsOptions(d.data.kind as TicketFieldKind) && d.data.options.length === 0) return { error: "Add at least one option." };
  const siblings = await prisma.ticketFieldDef.findMany({ where: { companyId: user.companyId, typeId: d.data.typeId }, select: { key: true, order: true } });
  const key = uniqueKey(slug(d.data.name), new Set(siblings.map((s) => s.key)));
  const order = siblings.reduce((m, s) => Math.max(m, s.order), -1) + 1;
  await prisma.ticketFieldDef.create({
    data: {
      companyId: user.companyId, typeId: d.data.typeId, key, name: d.data.name, kind: d.data.kind as TicketFieldKind,
      options: fieldNeedsOptions(d.data.kind as TicketFieldKind) ? (d.data.options as Prisma.InputJsonValue) : undefined,
      required: d.data.required, customerVisible: d.data.customerVisible, customerEditable: d.data.customerEditable, order,
    },
  });
  return done();
}

export async function updateFieldAction(id: string, input: z.infer<typeof FieldSchema>): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const f = await prisma.ticketFieldDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, name: true, archivedAt: true } });
  if (!f) return { error: "Not found" };
  if (f.archivedAt) return { error: `"${f.name}" is archived — it can no longer be edited.` };
  const d = FieldSchema.safeParse(input);
  if (!d.success) return { error: d.error.issues[0]?.message ?? "Invalid input" };
  if (fieldNeedsOptions(d.data.kind as TicketFieldKind) && d.data.options.length === 0) return { error: "Add at least one option." };
  await prisma.ticketFieldDef.update({
    where: { id },
    data: {
      name: d.data.name, kind: d.data.kind as TicketFieldKind,
      options: fieldNeedsOptions(d.data.kind as TicketFieldKind) ? (d.data.options as Prisma.InputJsonValue) : Prisma.DbNull,
      required: d.data.required, customerVisible: d.data.customerVisible, customerEditable: d.data.customerEditable,
    },
  });
  return done();
}

/** "Deleting" a custom field archives it: the definition and every value tickets already carry stay
 *  in the database; the field leaves every input list and shows read-only as "archived field" where
 *  a ticket has a value. Nothing is hard-deleted. */
export async function deleteFieldAction(id: string): Promise<{ error?: string }> {
  const { user, ok } = await guard();
  if (!ok) return { error: "Forbidden" };
  const f = await prisma.ticketFieldDef.findFirst({ where: { id, companyId: user.companyId }, select: { id: true, archivedAt: true } });
  if (!f) return { error: "Not found" };
  if (f.archivedAt) return done();
  await prisma.ticketFieldDef.update({ where: { id }, data: { archivedAt: new Date(), archivedById: user.id } });
  return done();
}
