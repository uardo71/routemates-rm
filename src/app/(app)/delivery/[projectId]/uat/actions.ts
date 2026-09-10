"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery, engagementScope } from "@/lib/permissions";
import { type UatData } from "./serialize";
import { loadUatScriptData } from "./load";

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// ---------- scripts (the containers: one per end customer / test phase) ----------

const ScriptInput = z.object({
  name: z.string().trim().min(1, "Give the script a name.").max(200),
  engagementId: z.string().nullable().optional(),
});

async function loadScriptForUser(scriptId: string) {
  const user = await requireUser();
  const script = await prisma.uatScript.findFirst({ where: { id: scriptId, companyId: user.companyId }, select: { id: true, projectId: true, engagementId: true } });
  if (!script) return { error: "Script not found." as const };
  if (!(await canAccessProjectDelivery(user, script.projectId))) return { error: "Forbidden" as const };
  const scope = await engagementScope(user, script.projectId);
  if (scope !== "ALL" && script.engagementId && !scope.includes(script.engagementId)) return { error: "Forbidden" as const };
  return { user, script };
}

async function resolveEngagement(projectId: string, engagementId: string | null | undefined, scope: "ALL" | string[]): Promise<string | null | "invalid"> {
  if (!engagementId) return null;
  const e = await prisma.engagement.findFirst({ where: { id: engagementId, projectId }, select: { id: true } });
  if (!e) return "invalid";
  if (scope !== "ALL" && !scope.includes(e.id)) return "invalid";
  return e.id;
}

export async function createUatScriptAction(input: { projectId: string; name: string; engagementId?: string | null }): Promise<{ error?: string; id?: string }> {
  const user = await requireUser();
  const parsed = ScriptInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  if (!(await canAccessProjectDelivery(user, input.projectId))) return { error: "Forbidden" };
  const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId: user.companyId }, select: { id: true } });
  if (!project) return { error: "Project not found." };
  const scope = await engagementScope(user, input.projectId);
  const engagementId = await resolveEngagement(input.projectId, parsed.data.engagementId, scope);
  if (engagementId === "invalid") return { error: "Pick an end customer of this project." };
  const max = await prisma.uatScript.aggregate({ where: { projectId: input.projectId }, _max: { sortOrder: true } });
  const created = await prisma.uatScript.create({
    data: { companyId: user.companyId, projectId: input.projectId, engagementId, name: parsed.data.name, sortOrder: (max._max.sortOrder ?? 0) + 10 },
  });
  revalidatePath(`/delivery/${input.projectId}/uat`);
  revalidatePath(`/delivery/${input.projectId}`);
  revalidatePath("/uat");
  return { id: created.id };
}

export async function updateUatScriptAction(input: { id: string; name: string; engagementId?: string | null }): Promise<{ error?: string }> {
  const parsed = ScriptInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const ctx = await loadScriptForUser(input.id);
  if ("error" in ctx) return { error: ctx.error };
  const scope = await engagementScope(ctx.user, ctx.script.projectId);
  const engagementId = await resolveEngagement(ctx.script.projectId, parsed.data.engagementId, scope);
  if (engagementId === "invalid") return { error: "Pick an end customer of this project." };
  await prisma.uatScript.update({ where: { id: input.id }, data: { name: parsed.data.name, engagementId } });
  revalidatePath(`/delivery/${ctx.script.projectId}/uat`);
  revalidatePath(`/delivery/${ctx.script.projectId}/uat/${input.id}`);
  revalidatePath(`/delivery/${ctx.script.projectId}`);
  revalidatePath("/uat");
  return {};
}

export async function deleteUatScriptAction(id: string): Promise<{ error?: string }> {
  const ctx = await loadScriptForUser(id);
  if ("error" in ctx) return { error: ctx.error };
  await prisma.uatScript.delete({ where: { id } }); // areas, cases, issues cascade
  revalidatePath(`/delivery/${ctx.script.projectId}/uat`);
  revalidatePath(`/delivery/${ctx.script.projectId}`);
  revalidatePath("/uat");
  return {};
}

// ---------- the script's content (explicit Save) ----------

const AreaSchema = z.object({
  id: z.string(),
  name: z.string().trim().max(200),
  overview: z.string().trim().max(4000),
  dataRequirements: z.string().trim().max(4000),
});
const CaseSchema = z.object({
  id: z.string(),
  areaId: z.string(),
  description: z.string().trim().max(4000),
  prerequisites: z.string().trim().max(4000),
  expectedResults: z.string().trim().max(4000),
  runBy: z.string().trim().max(160),
  dateRun: z.string().nullable(),
  result: z.enum(["NOT_RUN", "OK", "KO", "REDO"]),
  reasonForFailure: z.string().trim().max(4000),
  docNo: z.string().trim().max(160),
  comments: z.string().trim().max(4000),
});
const IssueSchema = z.object({
  id: z.string(),
  areaRef: z.string().trim().max(200),
  testRef: z.string().trim().max(60),
  type: z.string().trim().max(60),
  description: z.string().trim().max(4000),
  correctiveAction: z.string().trim().max(4000),
  assigned: z.string().trim().max(160),
  status: z.enum(["OPEN", "CLOSED"]),
  dateRaised: z.string().nullable(),
  dateClosed: z.string().nullable(),
});
const PayloadSchema = z.object({
  status: z.enum(["DRAFT", "READY", "SENT"]),
  sentAt: z.string().nullable(),
  areas: z.array(AreaSchema).max(200),
  cases: z.array(CaseSchema).max(3000),
  issues: z.array(IssueSchema).max(2000),
});

export async function saveUatAction(scriptId: string, payload: z.infer<typeof PayloadSchema>): Promise<{ error?: string; data?: UatData }> {
  const ctx = await loadScriptForUser(scriptId);
  if ("error" in ctx) return { error: ctx.error };
  const { user, script } = ctx;
  const projectId = script.projectId;
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { status, sentAt, areas, cases, issues } = parsed.data;

  const [exAreas, exCases, exIssues] = await Promise.all([
    prisma.uatArea.findMany({ where: { scriptId }, select: { id: true } }),
    prisma.uatTestCase.findMany({ where: { scriptId }, select: { id: true } }),
    prisma.uatIssue.findMany({ where: { scriptId }, select: { id: true } }),
  ]);
  const exAreaIds = new Set(exAreas.map((a) => a.id));
  const exCaseIds = new Set(exCases.map((c) => c.id));
  const exIssueIds = new Set(exIssues.map((i) => i.id));
  const keepAreas = new Set(areas.filter((a) => !a.id.startsWith("new:")).map((a) => a.id));
  const keepCases = new Set(cases.filter((c) => !c.id.startsWith("new:")).map((c) => c.id));
  const keepIssues = new Set(issues.filter((i) => !i.id.startsWith("new:")).map((i) => i.id));

  await prisma.$transaction(async (tx) => {
    const delCases = [...exCaseIds].filter((id) => !keepCases.has(id));
    if (delCases.length) await tx.uatTestCase.deleteMany({ where: { id: { in: delCases }, scriptId } });
    const delAreas = [...exAreaIds].filter((id) => !keepAreas.has(id));
    if (delAreas.length) await tx.uatArea.deleteMany({ where: { id: { in: delAreas }, scriptId } }); // cascades remaining cases
    const delIssues = [...exIssueIds].filter((id) => !keepIssues.has(id));
    if (delIssues.length) await tx.uatIssue.deleteMany({ where: { id: { in: delIssues }, scriptId } });

    const areaMap = new Map<string, string>();
    let ai = 0;
    for (const a of areas) {
      const data = { name: a.name || "Functional area", overview: a.overview || null, dataRequirements: a.dataRequirements || null, sortOrder: ai };
      if (a.id.startsWith("new:")) {
        const created = await tx.uatArea.create({ data: { companyId: user.companyId, projectId, scriptId, ...data } });
        areaMap.set(a.id, created.id);
      } else if (exAreaIds.has(a.id)) {
        await tx.uatArea.update({ where: { id: a.id }, data });
      }
      ai++;
    }

    let ci = 0;
    for (const c of cases) {
      const areaId = areaMap.get(c.areaId) ?? c.areaId;
      const data = {
        description: c.description || null, prerequisites: c.prerequisites || null, expectedResults: c.expectedResults || null,
        runBy: c.runBy || null, dateRun: utcDate(c.dateRun), result: c.result,
        reasonForFailure: c.reasonForFailure || null, docNo: c.docNo || null, comments: c.comments || null, sortOrder: ci,
      };
      if (c.id.startsWith("new:")) await tx.uatTestCase.create({ data: { companyId: user.companyId, projectId, scriptId, areaId, ...data } });
      else if (exCaseIds.has(c.id)) await tx.uatTestCase.update({ where: { id: c.id }, data: { ...data, areaId } });
      ci++;
    }

    let ii = 0;
    for (const i of issues) {
      const data = {
        areaRef: i.areaRef || null, testRef: i.testRef || null, type: i.type || null, description: i.description || null,
        correctiveAction: i.correctiveAction || null, assigned: i.assigned || null, status: i.status,
        dateRaised: utcDate(i.dateRaised), dateClosed: utcDate(i.dateClosed), sortOrder: ii,
      };
      if (i.id.startsWith("new:")) await tx.uatIssue.create({ data: { companyId: user.companyId, projectId, scriptId, ...data } });
      else if (exIssueIds.has(i.id)) await tx.uatIssue.update({ where: { id: i.id }, data });
      ii++;
    }

    await tx.uatScript.update({ where: { id: scriptId }, data: { status, sentAt: utcDate(sentAt) } });
  });

  revalidatePath(`/delivery/${projectId}/uat/${scriptId}`);
  revalidatePath(`/delivery/${projectId}/uat`);
  revalidatePath(`/delivery/${projectId}`);
  revalidatePath("/uat");
  return { data: await loadUatScriptData(scriptId) };
}
