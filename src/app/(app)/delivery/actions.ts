"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject, STAFF_ONLY } from "@/lib/permissions";

/** Owner ids the client sent, kept only when they are active staff of this company. A link to a
 *  person is never trusted from the payload alone. */
async function validOwners(companyId: string, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Set();
  const rows = await prisma.user.findMany({ where: { id: { in: wanted }, companyId, active: true, ...STAFF_ONLY }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
const ownerLink = (id: string | null | undefined, valid: Set<string>) => (id && valid.has(id) ? id : null);
import { MAX_RECEIPT_SIZE_BYTES, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";
import { dateFromFileName, titleFromFileName } from "@/lib/doc-naming";
import { approvedHoursForPeriod, type PeriodHours } from "@/lib/realization-data";
import { recordAudit } from "@/lib/audit";
import { completionChange } from "@/lib/actions-register";
import { wouldCreateCycle, cascadeShift, finishDelta, type DateShift } from "@/lib/plan-schedule";

// The delivery library accepts the everyday deliverable formats (PDF, images, Office, email), matched
// by extension so a browser mis-reporting the MIME (common for .msg/.pptx) doesn't block a valid file.
const ALLOWED_DOC_EXT = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".gif",
  ".xlsx", ".xls", ".csv", ".docx", ".doc", ".pptx", ".ppt", ".txt", ".msg", ".eml", ".zip",
]);

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (v: string | null | undefined): Date | null =>
  v && dateOnly.test(v) ? new Date(`${v}T00:00:00.000Z`) : null;

async function assertManage(projectId: string): Promise<{ error?: string; companyId?: string; userId?: string }> {
  const user = await requirePermission("delivery:manage");
  if (!(await canManageProject(user, projectId))) return { error: "You do not have permission to manage this project." };
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };
  return { companyId: user.companyId, userId: user.id };
}

// An engagement scopes a governance item to an end-customer stream within the project (null = the
// project overall). Validates it belongs to the project before using it.
async function resolveEngagement(projectId: string, engagementId: string | null | undefined): Promise<string | null> {
  if (!engagementId) return null;
  const e = await prisma.engagement.findFirst({ where: { id: engagementId, projectId }, select: { id: true } });
  return e?.id ?? null;
}

// ---------- engagements (end-customer streams — cockpit only, never a Project) ----------

/** Only active staff of the company can be assigned to an engagement; anything else is dropped. */
async function validStaffIds(companyId: string, userIds: string[] | undefined): Promise<string[]> {
  const ids = [...new Set((userIds ?? []).filter((x) => typeof x === "string" && x.length > 0))].slice(0, 100);
  if (ids.length === 0) return [];
  const rows = await prisma.user.findMany({ where: { id: { in: ids }, companyId, active: true, ...STAFF_ONLY }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function createEngagementAction(input: { projectId: string; name: string; memberIds?: string[] }): Promise<{ error?: string; id?: string }> {
  const name = z.string().trim().min(1, "Enter a name.").max(200).safeParse(input.name);
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Enter a name." };
  const ctx = await assertManage(input.projectId);
  if (ctx.error) return { error: ctx.error };
  const members = await validStaffIds(ctx.companyId!, input.memberIds);
  const max = await prisma.engagement.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
  const created = await prisma.engagement.create({
    data: {
      companyId: ctx.companyId!, projectId: input.projectId, name: name.data, sortOrder: (max._max.sortOrder ?? 0) + 10,
      members: { create: members.map((userId) => ({ userId })) },
    },
  });
  revalidatePath(`/delivery/${input.projectId}`);
  return { id: created.id };
}

/** Replaces the people assigned to an end customer. Membership grants them delivery access to the
 *  project's cockpit tools (cutover plans, UAT scripts) and scopes what they see to this customer. */
export async function setEngagementMembersAction(input: { engagementId: string; userIds: string[] }): Promise<{ error?: string }> {
  const eng = await prisma.engagement.findUnique({ where: { id: input.engagementId }, select: { projectId: true, companyId: true } });
  if (!eng) return { error: "Engagement not found." };
  const ctx = await assertManage(eng.projectId);
  if (ctx.error) return { error: ctx.error };
  const members = await validStaffIds(eng.companyId, input.userIds);
  await prisma.$transaction(async (tx) => {
    await tx.engagementMember.deleteMany({ where: { engagementId: input.engagementId, userId: { notIn: members } } });
    for (const userId of members) {
      await tx.engagementMember.upsert({
        where: { engagementId_userId: { engagementId: input.engagementId, userId } },
        create: { engagementId: input.engagementId, userId },
        update: {},
      });
    }
  });
  revalidatePath(`/delivery/${eng.projectId}`);
  return {};
}

/** Programme-level tracking: chase status updates for the "Overall" scope of a multi-engagement
 *  project too. Off by default — most programmes report per end customer only. */
export async function setProjectOverallTrackingAction(projectId: string, on: boolean): Promise<{ error?: string }> {
  const ctx = await assertManage(projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.project.update({ where: { id: projectId }, data: { trackOverallStatus: on } });
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/delivery");
  revalidatePath("/portfolio");
  return {};
}

/** Marks an end customer completed (or reopens it). The umbrella project's own status is untouched —
 *  that is the point: BEKO can be done while the Tungsten portfolio keeps running. */
export async function setEngagementStatusAction(input: { id: string; status: "ACTIVE" | "COMPLETED" }): Promise<{ error?: string }> {
  const eng = await prisma.engagement.findUnique({ where: { id: input.id }, select: { projectId: true } });
  if (!eng) return { error: "Engagement not found." };
  const ctx = await assertManage(eng.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.engagement.update({ where: { id: input.id }, data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null } });
  revalidatePath(`/delivery/${eng.projectId}`);
  revalidatePath("/delivery");
  revalidatePath("/portfolio");
  return {};
}

export async function updateEngagementAction(input: { id: string; name: string }): Promise<{ error?: string }> {
  const name = z.string().trim().min(1, "Enter a name.").max(200).safeParse(input.name);
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Enter a name." };
  const eng = await prisma.engagement.findUnique({ where: { id: input.id }, select: { projectId: true } });
  if (!eng) return { error: "Engagement not found." };
  const ctx = await assertManage(eng.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.engagement.update({ where: { id: input.id }, data: { name: name.data } });
  revalidatePath(`/delivery/${eng.projectId}`);
  return {};
}

// Deleting an engagement doesn't delete its governance items — they fall back to project-level
// (engagementId set to null by the FK), so nothing is lost.
export async function deleteEngagementAction(id: string): Promise<{ error?: string }> {
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { projectId: true } });
  if (!eng) return { error: "Engagement not found." };
  const ctx = await assertManage(eng.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.engagement.delete({ where: { id } });
  revalidatePath(`/delivery/${eng.projectId}`);
  return {};
}

// Move an engagement up/down in the switcher by swapping sortOrder with its adjacent sibling.
export async function reorderEngagementAction(id: string, direction: "up" | "down"): Promise<{ error?: string }> {
  const eng = await prisma.engagement.findUnique({ where: { id }, select: { projectId: true, sortOrder: true } });
  if (!eng) return { error: "Engagement not found." };
  const ctx = await assertManage(eng.projectId);
  if (ctx.error) return { error: ctx.error };
  const siblings = await prisma.engagement.findMany({
    where: { projectId: eng.projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, sortOrder: true },
  });
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return {}; // already at the edge — no-op
  const a = siblings[idx];
  const b = siblings[swapIdx];
  await prisma.$transaction([
    prisma.engagement.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
    prisma.engagement.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
  ]);
  revalidatePath(`/delivery/${eng.projectId}`);
  return {};
}

// ---------- status reports ----------

const RAG = z.enum(["GREEN", "AMBER", "RED"]);
const ActionSchema = z.object({
  /** Existing action being edited - its completion, age and carry link are kept. */
  id: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(500),
  owner: z.string().max(200).optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  critical: z.boolean().optional(),
  done: z.boolean().optional(),
  /** Set on a new update's carried rows: the action (in an earlier update) this one continues. */
  carriedFromId: z.string().optional().nullable(),
});
const ReportSchema = z.object({
  projectId: z.string().min(1),
  engagementId: z.string().optional().nullable(),
  reportDate: z.string().regex(dateOnly, "Pick the report date."),
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
  cadence: z.enum(["WEEKLY", "MONTHLY", "ADHOC"]).optional().nullable(),
  overallRag: RAG, // Severity/Timing
  scheduleRag: RAG,
  budgetRag: RAG,
  scopeRag: RAG,
  progressPercent: z.coerce.number().int().min(0).max(100).optional().nullable(),
  summary: z.string().max(4000).optional().nullable(), // current status
  accomplishments: z.string().max(4000).optional().nullable(),
  correctiveActions: z.string().max(4000).optional().nullable(),
  decisionsNeeded: z.string().max(4000).optional().nullable(),
  milestoneNotes: z.string().max(4000).optional().nullable(),
  actions: z.array(ActionSchema).optional(),
});
export type StatusReportInput = z.infer<typeof ReportSchema>;

function reportData(d: StatusReportInput) {
  return {
    reportDate: toUtc(d.reportDate)!,
    periodStart: toUtc(d.periodStart),
    periodEnd: toUtc(d.periodEnd),
    cadence: d.cadence ?? null,
    overallRag: d.overallRag,
    scheduleRag: d.scheduleRag,
    budgetRag: d.budgetRag,
    scopeRag: d.scopeRag,
    progressPercent: d.progressPercent ?? null,
    summary: d.summary?.trim() || null,
    accomplishments: d.accomplishments?.trim() || null,
    correctiveActions: d.correctiveActions?.trim() || null,
    decisionsNeeded: d.decisionsNeeded?.trim() || null,
    milestoneNotes: d.milestoneNotes?.trim() || null,
  };
}

function actionBase(a: z.infer<typeof ActionSchema>, i: number, valid: Set<string>) {
  return { description: a.description.trim(), owner: a.owner?.trim() || null, ownerUserId: ownerLink(a.ownerUserId, valid), dueDate: toUtc(a.dueDate), critical: a.critical ?? false, sortOrder: i * 10 };
}
/** done / doneAt / doneById for a completion change; nothing when the state doesn't change. */
function doneFields(change: "complete" | "reopen" | "none", userId: string) {
  if (change === "complete") return { done: true, doneAt: new Date(), doneById: userId };
  if (change === "reopen") return { done: false, doneAt: null, doneById: null };
  return {};
}
const actionOwnerIds = (d: StatusReportInput) => (d.actions ?? []).map((a) => a.ownerUserId);

/** The editor's read-only "This period" panel: approved hours in the period split by person, and
 *  the running total against budget. Hours only (no rates), gated like the rest of the cockpit. */
export async function periodHoursAction(input: { projectId: string; periodStart: string; periodEnd: string }): Promise<{ error?: string; data?: PeriodHours }> {
  const ctx = await assertManage(input.projectId);
  if (ctx.error) return { error: ctx.error };
  const from = toUtc(input.periodStart);
  const to = toUtc(input.periodEnd);
  if (!from || !to || to < from) return { error: "Pick a valid period." };
  return { data: await approvedHoursForPeriod(ctx.companyId!, input.projectId, from, to) };
}

export async function createStatusReportAction(input: StatusReportInput): Promise<{ error?: string; id?: string }> {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };

  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  const valid = await validOwners(ctx.companyId!, actionOwnerIds(parsed.data));
  const incoming = parsed.data.actions ?? [];
  // Carried rows continue an action of an earlier update: they keep its age and, if it was already
  // done, its completion - and the register then shows only this newest copy.
  const originIds = incoming.map((a) => a.carriedFromId).filter((x): x is string => !!x);
  const origins = new Map((originIds.length ? await prisma.statusReportAction.findMany({ where: { id: { in: originIds }, report: { projectId: parsed.data.projectId } }, select: { id: true, done: true, doneAt: true, doneById: true, createdAt: true } }) : []).map((o) => [o.id, o]));
  const created = await prisma.statusReport.create({
    data: {
      companyId: ctx.companyId!, projectId: parsed.data.projectId, authorId: ctx.userId!, engagementId,
      ...reportData(parsed.data),
      actions: {
        create: incoming.map((a, i) => {
          const o = a.carriedFromId ? origins.get(a.carriedFromId) : undefined;
          const completion = o && o.done && a.done !== false ? { done: true, doneAt: o.doneAt, doneById: o.doneById } : doneFields(completionChange(false, a.done), ctx.userId!);
          return { ...actionBase(a, i, valid), ...completion, ...(o ? { carriedFromId: o.id, createdAt: o.createdAt } : {}) };
        }),
      },
    },
  });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  revalidatePath("/delivery");
  return { id: created.id };
}

const ReportUpdateSchema = ReportSchema.extend({ id: z.string().min(1) });
export async function updateStatusReportAction(input: z.infer<typeof ReportUpdateSchema>): Promise<{ error?: string }> {
  const parsed = ReportUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.statusReport.findUnique({ where: { id: parsed.data.id }, select: { projectId: true } });
  if (!existing) return { error: "Report not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(existing.projectId, parsed.data.engagementId);
  const valid = await validOwners(ctx.companyId!, actionOwnerIds(parsed.data));
  // Edit IN PLACE: actions keep their id, so completion, age and carry links survive an edit.
  const prev = new Map((await prisma.statusReportAction.findMany({ where: { reportId: parsed.data.id }, select: { id: true, done: true } })).map((p) => [p.id, p]));
  const incoming = parsed.data.actions ?? [];
  const keepIds = incoming.map((a) => a.id).filter((x): x is string => !!x && prev.has(x));
  await prisma.$transaction(async (tx) => {
    await tx.statusReportAction.deleteMany({ where: { reportId: parsed.data.id, id: { notIn: keepIds } } });
    await tx.statusReport.update({ where: { id: parsed.data.id }, data: { ...reportData(parsed.data), engagementId } });
    for (let i = 0; i < incoming.length; i++) {
      const a = incoming[i];
      const p = a.id ? prev.get(a.id) : undefined;
      if (p) await tx.statusReportAction.update({ where: { id: p.id }, data: { ...actionBase(a, i, valid), ...doneFields(completionChange(p.done, a.done), ctx.userId!) } });
      else await tx.statusReportAction.create({ data: { reportId: parsed.data.id, ...actionBase(a, i, valid), ...doneFields(completionChange(false, a.done), ctx.userId!) } });
    }
  });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

export async function markStatusReportSentAction(id: string, sentDate?: string | null): Promise<{ error?: string }> {
  const existing = await prisma.statusReport.findUnique({ where: { id }, select: { projectId: true, sentAt: true } });
  if (!existing) return { error: "Report not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.statusReport.update({ where: { id }, data: { sentAt: toUtc(sentDate) ?? existing.sentAt ?? new Date() } });
  revalidatePath(`/delivery/${existing.projectId}`);
  revalidatePath("/delivery");
  return {};
}

export async function deleteStatusReportAction(id: string): Promise<{ error?: string }> {
  const existing = await prisma.statusReport.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) return { error: "Report not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.statusReport.delete({ where: { id } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

// ---------- RAID ----------

const RaidSchema = z.object({
  projectId: z.string().min(1),
  engagementId: z.string().optional().nullable(),
  type: z.enum(["RISK", "ASSUMPTION", "ISSUE", "DEPENDENCY", "DECISION"]),
  title: z.string().trim().min(1, "Title is required.").max(300),
  description: z.string().max(4000).optional().nullable(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional().nullable(),
  status: z.enum(["OPEN", "IN_PROGRESS", "CLOSED"]),
  owner: z.string().max(200).optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  response: z.string().max(4000).optional().nullable(),
});
export type RaidInput = z.infer<typeof RaidSchema>;

/** Closing an issue records when and by whom; reopening clears it. */
function raidCompletion(prevStatus: string | null, nextStatus: string, userId: string) {
  const ch = completionChange(prevStatus === "CLOSED", nextStatus === "CLOSED");
  return ch === "complete" ? { completedAt: new Date(), completedById: userId } : ch === "reopen" ? { completedAt: null, completedById: null } : {};
}

function raidData(d: RaidInput, valid: Set<string>) {
  return {
    type: d.type,
    title: d.title,
    description: d.description?.trim() || null,
    severity: d.severity ?? null,
    status: d.status,
    owner: d.owner?.trim() || null,
    ownerUserId: ownerLink(d.ownerUserId, valid),
    dueDate: toUtc(d.dueDate),
    response: d.response?.trim() || null,
  };
}

export async function createRaidItemAction(input: RaidInput): Promise<{ error?: string }> {
  const parsed = RaidSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  await prisma.raidItem.create({ data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, createdById: ctx.userId!, engagementId, ...raidData(parsed.data, await validOwners(ctx.companyId!, [parsed.data.ownerUserId])), ...raidCompletion(null, parsed.data.status, ctx.userId!) } });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

const RaidUpdateSchema = RaidSchema.extend({ id: z.string().min(1) });
export async function updateRaidItemAction(input: z.infer<typeof RaidUpdateSchema>): Promise<{ error?: string }> {
  const parsed = RaidUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.raidItem.findUnique({ where: { id: parsed.data.id }, select: { projectId: true, status: true } });
  if (!existing) return { error: "Item not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(existing.projectId, parsed.data.engagementId);
  await prisma.raidItem.update({ where: { id: parsed.data.id }, data: { ...raidData(parsed.data, await validOwners(ctx.companyId!, [parsed.data.ownerUserId])), engagementId, ...raidCompletion(existing.status, parsed.data.status, ctx.userId!) } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

export async function deleteRaidItemAction(id: string): Promise<{ error?: string }> {
  const existing = await prisma.raidItem.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) return { error: "Item not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.raidItem.delete({ where: { id } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

// ---------- meeting minutes ----------

const MinutesActionSchema = z.object({
  /** Existing action being edited - its completion and age are kept. */
  id: z.string().optional().nullable(),
  description: z.string().trim().min(1).max(500),
  owner: z.string().max(200).optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  done: z.boolean().optional(),
});
const MinutesParticipantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().max(200).optional().nullable(),
  role: z.string().max(200).optional().nullable(),
  group: z.string().max(200).optional().nullable(),
});
const MinutesSchema = z.object({
  projectId: z.string().min(1),
  engagementId: z.string().optional().nullable(),
  date: z.string().regex(dateOnly, "Pick a date."),
  title: z.string().trim().min(1, "Title is required.").max(300),
  attendees: z.string().max(2000).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  timeFrom: z.string().max(20).optional().nullable(),
  timeTo: z.string().max(20).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  minuteTaker: z.string().max(200).optional().nullable(),
  agendaTopic: z.string().max(1000).optional().nullable(),
  agendaWho: z.string().max(200).optional().nullable(),
  agendaDuration: z.string().max(50).optional().nullable(),
  participants: z.array(MinutesParticipantSchema).optional(),
  actions: z.array(MinutesActionSchema).optional(),
});
export type MinutesInput = z.infer<typeof MinutesSchema>;

function minutesData(d: MinutesInput) {
  return {
    date: toUtc(d.date)!, title: d.title.trim(),
    attendees: d.attendees?.trim() || null, notes: d.notes?.trim() || null,
    timeFrom: d.timeFrom?.trim() || null, timeTo: d.timeTo?.trim() || null,
    location: d.location?.trim() || null, minuteTaker: d.minuteTaker?.trim() || null,
    agendaTopic: d.agendaTopic?.trim() || null, agendaWho: d.agendaWho?.trim() || null, agendaDuration: d.agendaDuration?.trim() || null,
  };
}
function minutesActionBase(a: z.infer<typeof MinutesActionSchema>, i: number, valid: Set<string>) {
  return { description: a.description.trim(), owner: a.owner?.trim() || null, ownerUserId: ownerLink(a.ownerUserId, valid), dueDate: toUtc(a.dueDate), sortOrder: i * 10 };
}
function minutesActionCreate(d: MinutesInput, valid: Set<string>, userId: string) {
  return (d.actions ?? []).map((a, i) => ({ ...minutesActionBase(a, i, valid), ...doneFields(completionChange(false, a.done), userId) }));
}
const minutesOwnerIds = (d: MinutesInput) => (d.actions ?? []).map((a) => a.ownerUserId);
function participantsCreate(d: MinutesInput) {
  return (d.participants ?? []).filter((p) => p.name.trim()).map((p, i) => ({ name: p.name.trim(), company: p.company?.trim() || null, role: p.role?.trim() || null, group: p.group?.trim() || null, sortOrder: i * 10 }));
}

export async function createMeetingAction(input: MinutesInput): Promise<{ error?: string; id?: string }> {
  const parsed = MinutesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  const created = await prisma.meetingMinutes.create({
    data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, createdById: ctx.userId!, engagementId, ...minutesData(parsed.data), actions: { create: minutesActionCreate(parsed.data, await validOwners(ctx.companyId!, minutesOwnerIds(parsed.data)), ctx.userId!) }, participants: { create: participantsCreate(parsed.data) } },
  });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return { id: created.id };
}

const MinutesUpdateSchema = MinutesSchema.extend({ id: z.string().min(1) });
export async function updateMeetingAction(input: z.infer<typeof MinutesUpdateSchema>): Promise<{ error?: string }> {
  const parsed = MinutesUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.meetingMinutes.findUnique({ where: { id: parsed.data.id }, select: { projectId: true } });
  if (!existing) return { error: "Minutes not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  const engId = await resolveEngagement(existing.projectId, parsed.data.engagementId);
  const valid = await validOwners(ctx.companyId!, minutesOwnerIds(parsed.data));
  // Edit IN PLACE: actions keep their id, so a done action keeps when and by whom it was done.
  const prev = new Map((await prisma.meetingActionItem.findMany({ where: { minutesId: parsed.data.id }, select: { id: true, done: true } })).map((p) => [p.id, p]));
  const incoming = parsed.data.actions ?? [];
  const keepIds = incoming.map((a) => a.id).filter((x): x is string => !!x && prev.has(x));
  await prisma.$transaction(async (tx) => {
    await tx.meetingActionItem.deleteMany({ where: { minutesId: parsed.data.id, id: { notIn: keepIds } } });
    await tx.meetingParticipant.deleteMany({ where: { minutesId: parsed.data.id } });
    await tx.meetingMinutes.update({ where: { id: parsed.data.id }, data: { ...minutesData(parsed.data), engagementId: engId, participants: { create: participantsCreate(parsed.data) } } });
    for (let i = 0; i < incoming.length; i++) {
      const a = incoming[i];
      const p = a.id ? prev.get(a.id) : undefined;
      if (p) await tx.meetingActionItem.update({ where: { id: p.id }, data: { ...minutesActionBase(a, i, valid), ...doneFields(completionChange(p.done, a.done), ctx.userId!) } });
      else await tx.meetingActionItem.create({ data: { minutesId: parsed.data.id, ...minutesActionBase(a, i, valid), ...doneFields(completionChange(false, a.done), ctx.userId!) } });
    }
  });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

export async function deleteMeetingAction(id: string): Promise<{ error?: string }> {
  const existing = await prisma.meetingMinutes.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) return { error: "Minutes not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.meetingMinutes.delete({ where: { id } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

// ---------- document library ----------

const DELIVERY_DOC_KINDS = ["PROJECT_PLAN", "STATUS_UPDATE", "MEETING_MINUTES", "CUTOVER_PLAN", "KICKOFF", "SCOPE", "UAT_ACCEPTANCE", "OTHER"] as const;
type DeliveryDocKind = (typeof DELIVERY_DOC_KINDS)[number];

export async function uploadDeliveryDocumentAction(projectId: string, formData: FormData): Promise<{ error?: string }> {
  const ctx = await assertManage(projectId);
  if (ctx.error) return { error: ctx.error };
  const kind = String(formData.get("kind") ?? "");
  if (!DELIVERY_DOC_KINDS.includes(kind as DeliveryDocKind)) return { error: "Invalid document type." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_DOC_EXT.has(ext)) return { error: "Unsupported file type — use a PDF, image, Office file, or email." };
  const engagementId = await resolveEngagement(projectId, (formData.get("engagementId") as string) || null);
  const saved = await saveReceiptFile(file, "documents");
  const companyId = ctx.companyId!;
  const userId = ctx.userId!;
  const docDate = dateFromFileName(file.name) ?? new Date(new Date().toISOString().slice(0, 10));
  const title = titleFromFileName(file.name);

  // A minutes or status-update file made in another template still counts: create the matching
  // entry so it shows in its tab (and drives the overview), linked to the file. Same transaction.
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({ data: { companyId, kind: kind as DeliveryDocKind, projectId, engagementId, uploadedById: userId, ...saved } });
    if (kind === "MEETING_MINUTES") {
      const m = await tx.meetingMinutes.create({
        data: { companyId, projectId, engagementId, createdById: userId, date: docDate, title, notes: `Minutes attached as a document: ${file.name}` },
      });
      await tx.document.update({ where: { id: doc.id }, data: { minutesId: m.id } });
    } else if (kind === "STATUS_UPDATE") {
      // Start from the latest report in the same scope so the overview keeps its health/progress
      // until the PM edits the new entry.
      const prev = await tx.statusReport.findFirst({ where: { projectId, engagementId }, orderBy: { reportDate: "desc" } });
      const r = await tx.statusReport.create({
        data: {
          companyId, projectId, engagementId, authorId: userId, reportDate: docDate,
          cadence: prev?.cadence ?? "ADHOC",
          overallRag: prev?.overallRag ?? "GREEN", scheduleRag: prev?.scheduleRag ?? "GREEN", budgetRag: prev?.budgetRag ?? "GREEN", scopeRag: prev?.scopeRag ?? "GREEN",
          progressPercent: prev?.progressPercent ?? null,
          summary: `Status update attached as a document: ${file.name}`,
        },
      });
      await tx.document.update({ where: { id: doc.id }, data: { statusReportId: r.id } });
    }
  });
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/delivery");
  return {};
}

/** Removes every plan task in scope (an end customer, or the project overall) — the "delete the
 *  plan" button. Tasks only; status reports, minutes and documents are untouched. */
export async function clearPlanAction(projectId: string, engagementIdInput?: string | null): Promise<{ error?: string; deleted?: number }> {
  const ctx = await assertManage(projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(projectId, engagementIdInput);
  const res = await prisma.planTask.deleteMany({ where: { projectId, engagementId } });
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/delivery");
  return { deleted: res.count };
}

export async function deleteDeliveryDocumentAction(documentId: string): Promise<{ error?: string }> {
  const doc = await prisma.document.findFirst({ where: { id: documentId, projectId: { not: null } }, select: { id: true, projectId: true, fileName: true } });
  if (!doc || !doc.projectId) return { error: "Document not found." };
  const ctx = await assertManage(doc.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath(`/delivery/${doc.projectId}`);
  return {};
}

// ---------- project plan ----------

const PLAN_STATUS = z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]);
const PlanSchema = z.object({
  projectId: z.string().min(1),
  engagementId: z.string().optional().nullable(),
  phase: z.string().max(80).optional().nullable(),
  name: z.string().trim().min(1, "Name is required.").max(300),
  owner: z.string().max(200).optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  progress: z.coerce.number().int().min(0).max(100).optional().nullable(),
  status: PLAN_STATUS,
  isMilestone: z.boolean().optional(),
  estimatedHours: z.coerce.number().min(0, "Estimated hours can't be negative.").max(100000).optional().nullable(),
  milestoneId: z.string().optional().nullable(),
  taskId: z.string().optional().nullable(),
  dependsOnId: z.string().optional().nullable(),
});
export type PlanTaskInput = z.infer<typeof PlanSchema>;

const planIsDone = (s: { status: string; progress?: number | null }) => s.status === "COMPLETED" || (s.progress ?? 0) >= 100;
/** Reaching 100% / COMPLETED records when and by whom; dropping back clears it. */
function planCompletion(prev: { status: string; progress: number } | null, next: PlanTaskInput, userId: string) {
  const ch = completionChange(prev ? planIsDone(prev) : false, planIsDone(next));
  return ch === "complete" ? { completedAt: new Date(), completedById: userId } : ch === "reopen" ? { completedAt: null, completedById: null } : {};
}

function planData(d: PlanTaskInput, valid: Set<string>) {
  return {
    phase: d.phase?.trim() || null,
    name: d.name.trim(),
    owner: d.owner?.trim() || null,
    ownerUserId: ownerLink(d.ownerUserId, valid),
    startDate: toUtc(d.startDate),
    dueDate: toUtc(d.dueDate),
    progress: d.progress ?? 0,
    status: d.status,
    isMilestone: d.isMilestone ?? false,
    estimatedHours: d.estimatedHours != null && d.estimatedHours > 0 ? d.estimatedHours : null,
  };
}

/** The milestone / task / predecessor links a plan row may carry, each checked against the project:
 *  the milestone must be this project's, the task must be on that milestone, and the predecessor must
 *  be on this plan without closing a loop. Never trusted from the payload alone. */
async function resolvePlanLinks(projectId: string, selfId: string | null, d: PlanTaskInput): Promise<{ error?: string; links?: { milestoneId: string | null; taskId: string | null; dependsOnId: string | null } }> {
  let milestoneId: string | null = null;
  let taskId: string | null = null;
  let dependsOnId: string | null = null;
  if (d.milestoneId) {
    const m = await prisma.milestone.findFirst({ where: { id: d.milestoneId, projectId }, select: { id: true } });
    if (!m) return { error: "That milestone isn't on this project." };
    milestoneId = m.id;
    if (d.taskId) {
      const t = await prisma.task.findFirst({ where: { id: d.taskId, milestoneId: m.id }, select: { id: true } });
      if (!t) return { error: "That task isn't on the selected milestone." };
      taskId = t.id;
    }
  }
  if (d.dependsOnId) {
    const all = await prisma.planTask.findMany({ where: { projectId }, select: { id: true, dependsOnId: true } });
    if (!all.some((t) => t.id === d.dependsOnId)) return { error: "The task it depends on isn't on this plan." };
    if (wouldCreateCycle(all, selfId ?? "__new__", d.dependsOnId)) return { error: "That dependency would create a loop — a task can't (even indirectly) wait for itself." };
    dependsOnId = d.dependsOnId;
  }
  return { links: { milestoneId, taskId, dependsOnId } };
}

export async function createPlanTaskAction(input: PlanTaskInput): Promise<{ error?: string }> {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const linked = await resolvePlanLinks(parsed.data.projectId, null, parsed.data);
  if (linked.error) return { error: linked.error };
  const max = await prisma.planTask.aggregate({ where: { projectId: parsed.data.projectId }, _max: { sortOrder: true } });
  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  await prisma.planTask.create({ data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, engagementId, sortOrder: (max._max.sortOrder ?? 0) + 10, ...planData(parsed.data, await validOwners(ctx.companyId!, [parsed.data.ownerUserId])), ...linked.links!, ...planCompletion(null, parsed.data, ctx.userId!) } });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const PlanUpdateSchema = PlanSchema.extend({ id: z.string().min(1) });
/** Saves a plan row. When its due date moves, every task downstream of it (finish-to-start) moves by
 *  the same number of days in the same transaction; the shifted rows come back so the grid can show
 *  them and offer an undo. The baseline is never touched here. */
export async function updatePlanTaskAction(input: z.infer<typeof PlanUpdateSchema>): Promise<{ error?: string; shifted?: DateShift[]; delta?: number }> {
  const parsed = PlanUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.planTask.findUnique({ where: { id: parsed.data.id }, select: { projectId: true, dueDate: true, status: true, progress: true } });
  if (!existing) return { error: "Task not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  const linked = await resolvePlanLinks(existing.projectId, parsed.data.id, parsed.data);
  if (linked.error) return { error: linked.error };
  const data = {
    ...planData(parsed.data, await validOwners(ctx.companyId!, [parsed.data.ownerUserId])),
    ...linked.links!,
    engagementId: await resolveEngagement(existing.projectId, parsed.data.engagementId),
    ...planCompletion(existing, parsed.data, ctx.userId!),
  };
  const delta = finishDelta(isoDate(existing.dueDate), isoDate(data.dueDate));
  let shifted: DateShift[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.planTask.update({ where: { id: parsed.data.id }, data });
    if (delta === 0) return;
    const all = await tx.planTask.findMany({ where: { projectId: existing.projectId }, select: { id: true, dependsOnId: true, startDate: true, dueDate: true } });
    shifted = cascadeShift(all.map((t) => ({ id: t.id, dependsOnId: t.dependsOnId, startDate: isoDate(t.startDate), dueDate: isoDate(t.dueDate) })), parsed.data.id, delta);
    for (const s of shifted) await tx.planTask.update({ where: { id: s.id }, data: { startDate: toUtc(s.startDate), dueDate: toUtc(s.dueDate) } });
  });
  revalidatePath(`/delivery/${existing.projectId}`);
  return { shifted, delta };
}

const PlanDatesSchema = z.object({
  projectId: z.string().min(1),
  rows: z.array(z.object({ id: z.string().min(1), startDate: z.string().nullable(), dueDate: z.string().nullable() })).min(1).max(500),
});
/** Puts plan rows back to exact dates — the undo of a cascaded move. No cascade of its own. */
export async function setPlanDatesAction(input: z.infer<typeof PlanDatesSchema>): Promise<{ error?: string }> {
  const parsed = PlanDatesSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const ids = [...new Set(parsed.data.rows.map((r) => r.id))];
  const found = await prisma.planTask.count({ where: { id: { in: ids }, projectId: parsed.data.projectId } });
  if (found !== ids.length) return { error: "Some of those tasks are no longer on this plan." };
  await prisma.$transaction(parsed.data.rows.map((r) => prisma.planTask.update({ where: { id: r.id }, data: { startDate: toUtc(r.startDate), dueDate: toUtc(r.dueDate) } })));
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

/** Freezes the current dates as the baseline for every dated task in scope that has none yet. A
 *  baseline, once written, is never changed — not by this action, not by a drag, not by an edit — so
 *  a second click only baselines tasks added since. Audited on the project. */
export async function setPlanBaselineAction(projectId: string, engagementIdInput?: string | null): Promise<{ error?: string; count?: number }> {
  const user = await requirePermission("delivery:manage");
  const ctx = await assertManage(projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(projectId, engagementIdInput);
  const scope = { projectId, engagementId };
  const [pending, already, project, eng] = await Promise.all([
    prisma.planTask.findMany({ where: { ...scope, baselineStart: null, baselineEnd: null, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] }, select: { id: true, startDate: true, dueDate: true } }),
    prisma.planTask.count({ where: { ...scope, OR: [{ baselineStart: { not: null } }, { baselineEnd: { not: null } }] } }),
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
    engagementId ? prisma.engagement.findUnique({ where: { id: engagementId }, select: { name: true } }) : null,
  ]);
  if (pending.length === 0) return { error: "Nothing to baseline — every dated task already has one." };
  await prisma.$transaction(async (tx) => {
    for (const t of pending) {
      await tx.planTask.update({ where: { id: t.id }, data: { baselineStart: t.startDate ?? t.dueDate, baselineEnd: t.dueDate ?? t.startDate } });
    }
    await recordAudit(tx, {
      entityType: "Project", entityId: projectId, action: "update", actor: user,
      before: { baselinedTasks: already }, after: { baselinedTasks: already + pending.length },
      label: `${project?.name ?? "Project"} plan${eng ? ` · ${eng.name}` : ""}`,
      note: already === 0 ? `Plan baselined (${pending.length} tasks)` : `Baselined ${pending.length} task${pending.length === 1 ? "" : "s"} added since the first baseline`,
    });
  });
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/portfolio");
  return { count: pending.length };
}

export async function deletePlanTaskAction(id: string): Promise<{ error?: string }> {
  const existing = await prisma.planTask.findUnique({ where: { id }, select: { projectId: true } });
  if (!existing) return { error: "Task not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.planTask.delete({ where: { id } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
}

// A standard SAP delivery plan, inserted when a project has no plan yet — gives the junior PM a
// ready baseline to adjust and share.
// Standard SAP delivery plan with a baseline schedule (day offsets from the project start), so the
// seeded plan renders as a real Gantt out of the box. `dur` 0 = a milestone/gate.
// Standard delivery baseline aligned to the Tungsten Drive / KDM phases used across the PS SOPs:
// Initiation → Design → Build → Validate → Realize, with a cross-cutting Governance stream
// (status reporting, steering, PS→TS transition and closure/CSAT). Adjust after seeding.
const DEFAULT_PLAN: { phase: string; name: string; milestone?: boolean; start: number; dur: number }[] = [
  // Initiation (Mobilize)
  { phase: "Initiation", name: "SoW signed & PO received", milestone: true, start: 0, dur: 0 },
  { phase: "Initiation", name: "Project kickoff", start: 2, dur: 2 },
  { phase: "Initiation", name: "Project governance plan", start: 2, dur: 5 },
  { phase: "Initiation", name: "Environments & access setup", start: 4, dur: 6 },
  // Design
  { phase: "Design", name: "Discovery workshops", start: 5, dur: 8 },
  { phase: "Design", name: "Solution Design Document (SDD)", start: 12, dur: 12 },
  { phase: "Design", name: "Design sign-off", milestone: true, start: 26, dur: 0 },
  // Build
  { phase: "Build", name: "Solution configuration", start: 26, dur: 18 },
  { phase: "Build", name: "Custom development", start: 34, dur: 16 },
  { phase: "Build", name: "Unit & string testing", start: 46, dur: 8 },
  { phase: "Build", name: "System integration test (SIT)", start: 52, dur: 10 },
  // Validate
  { phase: "Validate", name: "UAT preparation & test scripts", start: 60, dur: 6 },
  { phase: "Validate", name: "Key-user training", start: 62, dur: 5 },
  { phase: "Validate", name: "User Acceptance Test (UAT)", start: 66, dur: 12 },
  { phase: "Validate", name: "UAT sign-off / Quality ready", milestone: true, start: 78, dur: 0 },
  // Realize (Deploy & Go-live)
  { phase: "Realize", name: "Cutover plan & readiness", start: 74, dur: 8 },
  { phase: "Realize", name: "Deploy to production", start: 82, dur: 4 },
  { phase: "Realize", name: "Go-live", milestone: true, start: 86, dur: 0 },
  { phase: "Realize", name: "Hypercare", start: 86, dur: 15 },
  // Governance (runs across the project)
  { phase: "Governance", name: "Weekly status reporting", start: 2, dur: 99 },
  { phase: "Governance", name: "Steering committee (bi-weekly)", start: 5, dur: 96 },
  { phase: "Governance", name: "PS → TS transition", milestone: true, start: 101, dur: 0 },
  { phase: "Governance", name: "Project closure & CSAT", milestone: true, start: 103, dur: 0 },
];

export async function seedDefaultPlanAction(projectId: string, engagementIdInput?: string | null): Promise<{ error?: string }> {
  const ctx = await assertManage(projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(projectId, engagementIdInput);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { startDate: true } });
  const count = await prisma.planTask.count({ where: { projectId, engagementId } });
  if (count > 0) return { error: "This already has a plan." };
  const base = project?.startDate ?? new Date(new Date().toISOString().slice(0, 10));
  const addDays = (n: number) => new Date(base.getTime() + n * 86_400_000);
  await prisma.planTask.createMany({
    data: DEFAULT_PLAN.map((t, i) => ({
      companyId: ctx.companyId!, projectId, engagementId, phase: t.phase, name: t.name, isMilestone: t.milestone ?? false,
      status: "NOT_STARTED" as const, progress: 0, sortOrder: (i + 1) * 10,
      startDate: addDays(t.start), dueDate: addDays(t.start + t.dur),
    })),
  });
  revalidatePath(`/delivery/${projectId}`);
  return {};
}

export async function movePlanTaskAction(id: string, direction: "up" | "down"): Promise<{ error?: string }> {
  const task = await prisma.planTask.findUnique({ where: { id }, select: { id: true, projectId: true, phase: true, engagementId: true, sortOrder: true } });
  if (!task) return { error: "Task not found." };
  const ctx = await assertManage(task.projectId);
  if (ctx.error) return { error: ctx.error };
  // Reorder within the same phase + engagement (keeps grouping stable).
  const siblings = await prisma.planTask.findMany({ where: { projectId: task.projectId, phase: task.phase, engagementId: task.engagementId }, orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return {}; // at the boundary — no-op
  const a = siblings[idx], b = siblings[swapIdx];
  await prisma.$transaction([
    prisma.planTask.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } }),
    prisma.planTask.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } }),
  ]);
  revalidatePath(`/delivery/${task.projectId}`);
  return {};
}
