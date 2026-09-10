import "server-only";
import { prisma } from "@/lib/prisma";
import { serializeArea, serializeCase, serializeIssue, type UatData } from "./serialize";

// Not in actions.ts on purpose: a "use server" export is callable from any client, and this loader
// carries no permission check of its own — the page and the save action gate access before calling it.
export async function loadUatScriptData(scriptId: string): Promise<UatData> {
  const script = await prisma.uatScript.findUnique({ where: { id: scriptId }, select: { status: true, sentAt: true } });
  const [areas, cases, issues] = await Promise.all([
    prisma.uatArea.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatTestCase.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
    prisma.uatIssue.findMany({ where: { scriptId }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    status: script?.status ?? "DRAFT",
    sentAt: script?.sentAt ? script.sentAt.toISOString().slice(0, 10) : "",
    areas: areas.map(serializeArea),
    cases: cases.map(serializeCase),
    issues: issues.map(serializeIssue),
  };
}

