"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectCutover, engagementScope } from "@/lib/permissions";
import { serializeCutover, serializeCutoverList, type CutoverRowData, type CutoverListData } from "./serialize";

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// ---------- plans (the containers: one per end customer / phase / wave) ----------

const PlanInput = z.object({
  name: z.string().trim().min(1, "Give the plan a name.").max(200),
  engagementId: z.string().nullable().optional(),
});

/** A plan is reachable by whoever can access the project's delivery tools AND, for people scoped to
 *  specific end customers, only when it belongs to one of theirs (or to the project overall). */
async function loadPlanForUser(planId: string) {
  const user = await requireUser();
  const plan = await prisma.cutoverPlan.findFirst({ where: { id: planId, companyId: user.companyId }, select: { id: true, projectId: true, engagementId: true } });
  if (!plan) return { error: "Plan not found." as const };
  if (!(await canAccessProjectCutover(user, plan.projectId))) return { error: "Forbidden" as const };
  const scope = await engagementScope(user, plan.projectId);
  if (scope !== "ALL" && plan.engagementId && !scope.includes(plan.engagementId)) return { error: "Forbidden" as const };
  return { user, plan };
}

async function resolveEngagement(projectId: string, engagementId: string | null | undefined, scope: "ALL" | string[]): Promise<string | null | "invalid"> {
  if (!engagementId) return null;
  const e = await prisma.engagement.findFirst({ where: { id: engagementId, projectId }, select: { id: true } });
  if (!e) return "invalid";
  if (scope !== "ALL" && !scope.includes(e.id)) return "invalid";
  return e.id;
}

export async function createCutoverPlanAction(input: { projectId: string; name: string; engagementId?: string | null }): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!(await canAccessProjectCutover(user, input.projectId))) return { error: "Forbidden" };
  const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };
  const scope = await engagementScope(user, input.projectId);
  const engagementId = await resolveEngagement(input.projectId, parsed.data.engagementId, scope);
  if (engagementId === "invalid") return { error: "Pick an end customer of this project." };
  const max = await prisma.cutoverPlan.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
  const created = await prisma.cutoverPlan.create({
    data: { companyId: user.companyId, projectId: input.projectId, engagementId, name: parsed.data.name, sortOrder: (max._max.sortOrder ?? 0) + 10 },
  });
  revalidatePath(`/delivery/${input.projectId}/cutover`);
  revalidatePath(`/delivery/${input.projectId}`);
  revalidatePath("/cutover");
  return { id: created.id };
}

export async function updateCutoverPlanAction(input: { id: string; name: string; engagementId?: string | null }): Promise<{ error?: string }> {
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await loadPlanForUser(input.id);
  if ("error" in ctx) return { error: ctx.error };
  const scope = await engagementScope(ctx.user, ctx.plan.projectId);
  const engagementId = await resolveEngagement(ctx.plan.projectId, parsed.data.engagementId, scope);
  if (engagementId === "invalid") return { error: "Pick an end customer of this project." };
  await prisma.cutoverPlan.update({ where: { id: input.id }, data: { name: parsed.data.name, engagementId } });
  revalidatePath(`/delivery/${ctx.plan.projectId}/cutover`);
  revalidatePath(`/delivery/${ctx.plan.projectId}/cutover/${input.id}`);
  revalidatePath(`/delivery/${ctx.plan.projectId}`);
  revalidatePath("/cutover");
  return {};
}

export async function deleteCutoverPlanAction(id: string): Promise<{ error?: string }> {
  const ctx = await loadPlanForUser(id);
  if ("error" in ctx) return { error: ctx.error };
  await prisma.cutoverPlan.delete({ where: { id } }); // tasks + lists cascade
  revalidatePath(`/delivery/${ctx.plan.projectId}/cutover`);
  revalidatePath(`/delivery/${ctx.plan.projectId}`);
  revalidatePath("/cutover");
  return {};
}

// ---------- the plan's content (explicit Save of the whole grid) ----------

const RowSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  macroActivity: z.string().trim().max(120),
  activity: z.string().trim().max(240),
  description: z.string().trim().max(4000),
  responsible: z.string().trim().max(160),
  prerequisite: z.string().trim().max(160),
  referenceList: z.string().trim().max(120),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  durationMinutes: z.number().int().min(0).max(1000000).nullable(),
  status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED", "SKIPPED"]),
});

const ListSchema = z.object({
  id: z.string(),
  name: z.string().trim().max(120),
  columns: z.array(z.string().max(120)).max(30),
  rows: z.array(z.array(z.string().max(4000)).max(30)).max(5000),
});

const PayloadSchema = z.object({
  tasks: z.array(RowSchema).max(500),
  lists: z.array(ListSchema).max(50),
});

/** Persist one plan's steps + reference lists in one shot (explicit Save). */
export async function saveCutoverPlanAction(
  planId: string,
  payload: z.infer<typeof PayloadSchema>,
): Promise<{ error?: string; rows?: CutoverRowData[]; lists?: CutoverListData[] }> {
  const ctx = await loadPlanForUser(planId);
  if ("error" in ctx) return { error: ctx.error };
  const { user, plan } = ctx;
  const projectId = plan.projectId;
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { tasks, lists } = parsed.data;

  // Reference lists: keep only named ones, and names must be unique within the plan.
  const named = lists.filter((l) => l.name.trim().length > 0);
  const seen = new Set<string>();
  for (const l of named) {
    const key = l.name.trim().toLowerCase();
    if (seen.has(key)) return { error: `Duplicate reference-list name: "${l.name}".` };
    seen.add(key);
  }

  const [existingTasks, existingLists] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { planId }, select: { id: true } }),
    prisma.cutoverList.findMany({ where: { planId }, select: { id: true } }),
  ]);
  const taskIds = new Set(existingTasks.map((e) => e.id));
  const listIds = new Set(existingLists.map((e) => e.id));
  const keepTaskIds = new Set(tasks.filter((r) => !r.id.startsWith("new:")).map((r) => r.id));
  const keepListIds = new Set(named.filter((l) => !l.id.startsWith("new:")).map((l) => l.id));
  const delTasks = [...taskIds].filter((id) => !keepTaskIds.has(id));
  const delLists = [...listIds].filter((id) => !keepListIds.has(id));

  await prisma.$transaction(async (tx) => {
    if (delTasks.length) await tx.cutoverTask.deleteMany({ where: { id: { in: delTasks }, planId } });
    if (delLists.length) await tx.cutoverList.deleteMany({ where: { id: { in: delLists }, planId } });

    const idMap = new Map<string, string>();
    let ti = 0;
    for (const r of tasks) {
      const rawParent = r.parentId ?? null;
      const parentId = rawParent ? idMap.get(rawParent) ?? rawParent : null;
      const data = {
        macroActivity: r.macroActivity || "General",
        activity: r.activity,
        description: r.description || null,
        responsible: r.responsible || null,
        prerequisite: r.prerequisite || null,
        referenceList: r.referenceList || null,
        startDate: utcDate(r.startDate),
        endDate: utcDate(r.endDate),
        durationMinutes: r.durationMinutes,
        status: r.status,
        parentId,
        sortOrder: ti,
      };
      if (r.id.startsWith("new:")) {
        const created = await tx.cutoverTask.create({ data: { companyId: user.companyId, projectId, planId, ...data } });
        idMap.set(r.id, created.id);
      } else if (taskIds.has(r.id)) {
        await tx.cutoverTask.update({ where: { id: r.id }, data });
      }
      ti++;
    }

    let li = 0;
    for (const l of named) {
      const data = { name: l.name.trim(), columns: l.columns, rows: l.rows, sortOrder: li };
      if (l.id.startsWith("new:")) await tx.cutoverList.create({ data: { companyId: user.companyId, projectId, planId, ...data } });
      else if (listIds.has(l.id)) await tx.cutoverList.update({ where: { id: l.id }, data });
      li++;
    }
  });

  const [freshTasks, freshLists] = await Promise.all([
    prisma.cutoverTask.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
    prisma.cutoverList.findMany({ where: { planId }, orderBy: { sortOrder: "asc" } }),
  ]);
  revalidatePath(`/delivery/${projectId}/cutover/${planId}`);
  revalidatePath(`/delivery/${projectId}/cutover`);
  revalidatePath(`/delivery/${projectId}`);
  return { rows: freshTasks.map(serializeCutover), lists: freshLists.map(serializeCutoverList) };
}
