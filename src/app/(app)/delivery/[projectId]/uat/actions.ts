"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAccessProjectDelivery } from "@/lib/permissions";
import { serializeArea, serializeCase, serializeIssue, type UatData } from "./serialize";

function utcDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

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

async function loadUat(projectId: string): Promise<UatData> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { uatScriptStatus: true, uatScriptSentAt: true } });
  const [areas, cases, issues] = await Promise.all([
    prisma.uatArea.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatTestCase.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatIssue.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    status: project?.uatScriptStatus ?? "DRAFT",
    sentAt: project?.uatScriptSentAt ? project.uatScriptSentAt.toISOString().slice(0, 10) : "",
    areas: areas.map(serializeArea),
    cases: cases.map(serializeCase),
    issues: issues.map(serializeIssue),
  };
}

export async function saveUatAction(projectId: string, payload: z.infer<typeof PayloadSchema>): Promise<{ error?: string; data?: UatData }> {
  const user = await requireUser();
  if (!(await canAccessProjectDelivery(user, projectId))) return { error: "Forbidden" };
  const parsed = PayloadSchema.safeParse(payload);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { status, sentAt, areas, cases, issues } = parsed.data;

  const [exAreas, exCases, exIssues] = await Promise.all([
    prisma.uatArea.findMany({ where: { projectId }, select: { id: true } }),
    prisma.uatTestCase.findMany({ where: { projectId }, select: { id: true } }),
    prisma.uatIssue.findMany({ where: { projectId }, select: { id: true } }),
  ]);
  const exAreaIds = new Set(exAreas.map((a) => a.id));
  const exCaseIds = new Set(exCases.map((c) => c.id));
  const exIssueIds = new Set(exIssues.map((i) => i.id));
  const keepAreas = new Set(areas.filter((a) => !a.id.startsWith("new:")).map((a) => a.id));
  const keepCases = new Set(cases.filter((c) => !c.id.startsWith("new:")).map((c) => c.id));
  const keepIssues = new Set(issues.filter((i) => !i.id.startsWith("new:")).map((i) => i.id));

  await prisma.$transaction(async (tx) => {
    const delCases = [...exCaseIds].filter((id) => !keepCases.has(id));
    if (delCases.length) await tx.uatTestCase.deleteMany({ where: { id: { in: delCases }, projectId } });
    const delAreas = [...exAreaIds].filter((id) => !keepAreas.has(id));
    if (delAreas.length) await tx.uatArea.deleteMany({ where: { id: { in: delAreas }, projectId } }); // cascades remaining cases
    const delIssues = [...exIssueIds].filter((id) => !keepIssues.has(id));
    if (delIssues.length) await tx.uatIssue.deleteMany({ where: { id: { in: delIssues }, projectId } });

    const areaMap = new Map<string, string>();
    let ai = 0;
    for (const a of areas) {
      const data = { name: a.name || "Functional area", overview: a.overview || null, dataRequirements: a.dataRequirements || null, sortOrder: ai };
      if (a.id.startsWith("new:")) {
        const created = await tx.uatArea.create({ data: { companyId: user.companyId, projectId, ...data } });
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
      if (c.id.startsWith("new:")) await tx.uatTestCase.create({ data: { companyId: user.companyId, projectId, areaId, ...data } });
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
      if (i.id.startsWith("new:")) await tx.uatIssue.create({ data: { companyId: user.companyId, projectId, ...data } });
      else if (exIssueIds.has(i.id)) await tx.uatIssue.update({ where: { id: i.id }, data });
      ii++;
    }

    await tx.project.update({ where: { id: projectId }, data: { uatScriptStatus: status, uatScriptSentAt: utcDate(sentAt) } });
  });

  revalidatePath(`/delivery/${projectId}/uat`);
  return { data: await loadUat(projectId) };
}
