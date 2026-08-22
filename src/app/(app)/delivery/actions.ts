"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject } from "@/lib/permissions";
import { MAX_RECEIPT_SIZE_BYTES, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

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

export async function createEngagementAction(input: { projectId: string; name: string }): Promise<{ error?: string; id?: string }> {
  const name = z.string().trim().min(1, "Enter a name.").max(200).safeParse(input.name);
  if (!name.success) return { error: name.error.issues[0]?.message ?? "Enter a name." };
  const ctx = await assertManage(input.projectId);
  if (ctx.error) return { error: ctx.error };
  const max = await prisma.engagement.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
  const created = await prisma.engagement.create({ data: { companyId: ctx.companyId!, projectId: input.projectId, name: name.data, sortOrder: (max._max.sortOrder ?? 0) + 10 } });
  revalidatePath(`/delivery/${input.projectId}`);
  return { id: created.id };
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

// ---------- status reports ----------

const RAG = z.enum(["GREEN", "AMBER", "RED"]);
const ActionSchema = z.object({
  description: z.string().trim().min(1).max(500),
  owner: z.string().max(200).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  critical: z.boolean().optional(),
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
  nextSteps: z.string().max(4000).optional().nullable(),
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
    nextSteps: d.nextSteps?.trim() || null,
    correctiveActions: d.correctiveActions?.trim() || null,
    decisionsNeeded: d.decisionsNeeded?.trim() || null,
    milestoneNotes: d.milestoneNotes?.trim() || null,
  };
}

function actionCreate(d: StatusReportInput) {
  return (d.actions ?? []).map((a, i) => ({
    description: a.description.trim(), owner: a.owner?.trim() || null, dueDate: toUtc(a.dueDate), critical: a.critical ?? false, sortOrder: i * 10,
  }));
}

export async function createStatusReportAction(input: StatusReportInput): Promise<{ error?: string; id?: string }> {
  const parsed = ReportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };

  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  const created = await prisma.statusReport.create({
    data: {
      companyId: ctx.companyId!, projectId: parsed.data.projectId, authorId: ctx.userId!, engagementId,
      ...reportData(parsed.data), actions: { create: actionCreate(parsed.data) },
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
  await prisma.$transaction([
    prisma.statusReportAction.deleteMany({ where: { reportId: parsed.data.id } }),
    prisma.statusReport.update({ where: { id: parsed.data.id }, data: { ...reportData(parsed.data), engagementId, actions: { create: actionCreate(parsed.data) } } }),
  ]);
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

// ---------- checklist ----------

export async function toggleChecklistItemAction(id: string, done: boolean): Promise<{ error?: string }> {
  const item = await prisma.projectChecklistItem.findUnique({ where: { id }, select: { projectId: true } });
  if (!item) return { error: "Item not found." };
  const ctx = await assertManage(item.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.projectChecklistItem.update({
    where: { id },
    data: { done, completedAt: done ? new Date() : null, completedById: done ? ctx.userId! : null },
  });
  revalidatePath(`/delivery/${item.projectId}`);
  revalidatePath("/delivery");
  return {};
}

const AddItemSchema = z.object({
  projectId: z.string().min(1),
  phase: z.string().min(1).max(50),
  title: z.string().trim().min(1, "Title is required.").max(300),
  dueDate: z.string().optional().nullable(),
});
export async function addChecklistItemAction(input: z.infer<typeof AddItemSchema>): Promise<{ error?: string }> {
  const parsed = AddItemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const max = await prisma.projectChecklistItem.aggregate({ where: { projectId: parsed.data.projectId }, _max: { sortOrder: true } });
  await prisma.projectChecklistItem.create({
    data: { projectId: parsed.data.projectId, phase: parsed.data.phase, title: parsed.data.title, dueDate: toUtc(parsed.data.dueDate), sortOrder: (max._max.sortOrder ?? 0) + 10 },
  });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

export async function updateChecklistItemAction(input: { id: string; title?: string; dueDate?: string | null }): Promise<{ error?: string }> {
  const item = await prisma.projectChecklistItem.findUnique({ where: { id: input.id }, select: { projectId: true } });
  if (!item) return { error: "Item not found." };
  const ctx = await assertManage(item.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.projectChecklistItem.update({
    where: { id: input.id },
    data: { ...(input.title != null ? { title: input.title.trim() } : {}), ...(input.dueDate !== undefined ? { dueDate: toUtc(input.dueDate) } : {}) },
  });
  revalidatePath(`/delivery/${item.projectId}`);
  return {};
}

export async function deleteChecklistItemAction(id: string): Promise<{ error?: string }> {
  const item = await prisma.projectChecklistItem.findUnique({ where: { id }, select: { projectId: true } });
  if (!item) return { error: "Item not found." };
  const ctx = await assertManage(item.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.projectChecklistItem.delete({ where: { id } });
  revalidatePath(`/delivery/${item.projectId}`);
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
  dueDate: z.string().optional().nullable(),
  response: z.string().max(4000).optional().nullable(),
});
export type RaidInput = z.infer<typeof RaidSchema>;

function raidData(d: RaidInput) {
  return {
    type: d.type,
    title: d.title,
    description: d.description?.trim() || null,
    severity: d.severity ?? null,
    status: d.status,
    owner: d.owner?.trim() || null,
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
  await prisma.raidItem.create({ data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, createdById: ctx.userId!, engagementId, ...raidData(parsed.data) } });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

const RaidUpdateSchema = RaidSchema.extend({ id: z.string().min(1) });
export async function updateRaidItemAction(input: z.infer<typeof RaidUpdateSchema>): Promise<{ error?: string }> {
  const parsed = RaidUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.raidItem.findUnique({ where: { id: parsed.data.id }, select: { projectId: true } });
  if (!existing) return { error: "Item not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(existing.projectId, parsed.data.engagementId);
  await prisma.raidItem.update({ where: { id: parsed.data.id }, data: { ...raidData(parsed.data), engagementId } });
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
  description: z.string().trim().min(1).max(500),
  owner: z.string().max(200).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  done: z.boolean().optional(),
});
const MinutesSchema = z.object({
  projectId: z.string().min(1),
  engagementId: z.string().optional().nullable(),
  date: z.string().regex(dateOnly, "Pick a date."),
  title: z.string().trim().min(1, "Title is required.").max(300),
  attendees: z.string().max(2000).optional().nullable(),
  notes: z.string().max(8000).optional().nullable(),
  actions: z.array(MinutesActionSchema).optional(),
});
export type MinutesInput = z.infer<typeof MinutesSchema>;

function minutesData(d: MinutesInput) {
  return { date: toUtc(d.date)!, title: d.title.trim(), attendees: d.attendees?.trim() || null, notes: d.notes?.trim() || null };
}
function minutesActionCreate(d: MinutesInput) {
  return (d.actions ?? []).map((a, i) => ({ description: a.description.trim(), owner: a.owner?.trim() || null, dueDate: toUtc(a.dueDate), done: a.done ?? false, sortOrder: i * 10 }));
}

export async function createMeetingAction(input: MinutesInput): Promise<{ error?: string; id?: string }> {
  const parsed = MinutesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  const created = await prisma.meetingMinutes.create({
    data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, createdById: ctx.userId!, engagementId, ...minutesData(parsed.data), actions: { create: minutesActionCreate(parsed.data) } },
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
  await prisma.$transaction([
    prisma.meetingActionItem.deleteMany({ where: { minutesId: parsed.data.id } }),
    prisma.meetingMinutes.update({ where: { id: parsed.data.id }, data: { ...minutesData(parsed.data), engagementId: await resolveEngagement(existing.projectId, parsed.data.engagementId), actions: { create: minutesActionCreate(parsed.data) } } }),
  ]);
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

const DELIVERY_DOC_KINDS = ["PROJECT_PLAN", "STATUS_UPDATE", "MEETING_MINUTES", "KICKOFF", "SCOPE", "UAT_ACCEPTANCE", "OTHER"] as const;
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
  await prisma.document.create({ data: { companyId: ctx.companyId!, kind: kind as DeliveryDocKind, projectId, engagementId, uploadedById: ctx.userId!, ...saved } });
  revalidatePath(`/delivery/${projectId}`);
  return {};
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
  startDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  progress: z.coerce.number().int().min(0).max(100).optional().nullable(),
  status: PLAN_STATUS,
  isMilestone: z.boolean().optional(),
});
export type PlanTaskInput = z.infer<typeof PlanSchema>;

function planData(d: PlanTaskInput) {
  return {
    phase: d.phase?.trim() || null,
    name: d.name.trim(),
    owner: d.owner?.trim() || null,
    startDate: toUtc(d.startDate),
    dueDate: toUtc(d.dueDate),
    progress: d.progress ?? 0,
    status: d.status,
    isMilestone: d.isMilestone ?? false,
  };
}

export async function createPlanTaskAction(input: PlanTaskInput): Promise<{ error?: string }> {
  const parsed = PlanSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const ctx = await assertManage(parsed.data.projectId);
  if (ctx.error) return { error: ctx.error };
  const max = await prisma.planTask.aggregate({ where: { projectId: parsed.data.projectId }, _max: { sortOrder: true } });
  const engagementId = await resolveEngagement(parsed.data.projectId, parsed.data.engagementId);
  await prisma.planTask.create({ data: { companyId: ctx.companyId!, projectId: parsed.data.projectId, engagementId, sortOrder: (max._max.sortOrder ?? 0) + 10, ...planData(parsed.data) } });
  revalidatePath(`/delivery/${parsed.data.projectId}`);
  return {};
}

const PlanUpdateSchema = PlanSchema.extend({ id: z.string().min(1) });
export async function updatePlanTaskAction(input: z.infer<typeof PlanUpdateSchema>): Promise<{ error?: string }> {
  const parsed = PlanUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.planTask.findUnique({ where: { id: parsed.data.id }, select: { projectId: true } });
  if (!existing) return { error: "Task not found." };
  const ctx = await assertManage(existing.projectId);
  if (ctx.error) return { error: ctx.error };
  await prisma.planTask.update({ where: { id: parsed.data.id }, data: { ...planData(parsed.data), engagementId: await resolveEngagement(existing.projectId, parsed.data.engagementId) } });
  revalidatePath(`/delivery/${existing.projectId}`);
  return {};
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
const DEFAULT_PLAN: { phase: string; name: string; milestone?: boolean; start: number; dur: number }[] = [
  { phase: "Mobilize", name: "Final scoping & SoW signature", milestone: true, start: 0, dur: 0 },
  { phase: "Mobilize", name: "Project kickoff", start: 3, dur: 2 },
  { phase: "Analysis & Design", name: "Analysis workshop", start: 5, dur: 5 },
  { phase: "Analysis & Design", name: "Solution Design Document", start: 10, dur: 14 },
  { phase: "Analysis & Design", name: "Solution Design acceptance", milestone: true, start: 25, dur: 0 },
  { phase: "Build", name: "Setup DEV environment", start: 25, dur: 5 },
  { phase: "Build", name: "Configure the solution", start: 30, dur: 15 },
  { phase: "Build", name: "Custom adjustments", start: 40, dur: 15 },
  { phase: "Build", name: "Integration test", start: 55, dur: 10 },
  { phase: "Validate", name: "User training", start: 60, dur: 5 },
  { phase: "Validate", name: "User Acceptance Test (UAT)", start: 65, dur: 10 },
  { phase: "Validate", name: "Quality ready", milestone: true, start: 75, dur: 0 },
  { phase: "Deploy & Golive", name: "Deployment to Production", start: 75, dur: 5 },
  { phase: "Deploy & Golive", name: "Go-live", milestone: true, start: 80, dur: 0 },
  { phase: "Deploy & Golive", name: "Golive support / Hypercare", start: 80, dur: 15 },
  { phase: "Deploy & Golive", name: "Project closure", milestone: true, start: 95, dur: 0 },
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
