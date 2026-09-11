import "server-only";
import { prisma } from "@/lib/prisma";
import { evaluateHygiene, type HygieneItem, type HygieneRows } from "@/lib/hygiene";

// Loads the rows the hygiene predicates read (src/lib/hygiene.ts). One loader for the Portfolio,
// My Day and the weekly hygiene email, so all three see the same worklist.

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Live (PLANNED / ACTIVE / ON_HOLD), non-internal projects in scope, shaped for the predicates. */
export async function loadHygieneRows(companyId: string, projectIds: string[] | "ALL"): Promise<HygieneRows> {
  if (projectIds !== "ALL" && projectIds.length === 0) return { projects: [], milestones: [] };
  const projects = await prisma.project.findMany({
    where: {
      companyId, isInternal: false, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] },
      ...(projectIds === "ALL" ? {} : { id: { in: projectIds } }),
    },
    select: {
      id: true, name: true, clientId: true, status: true, isInternal: true, managerId: true, endDate: true,
      poNumber: true, poWaived: true, budgetHours: true, sponsorContactId: true,
      client: { select: { name: true } },
      opportunity: { select: { stage: true } },
      statusReports: { orderBy: { reportDate: "desc" }, take: 1, select: { reportDate: true } },
      _count: { select: { raidItems: { where: { status: { not: "CLOSED" } } } } },
      milestones: { select: { id: true, name: true, endDate: true, status: true, writtenOffAt: true, timeEntryOpen: true, assignments: { select: { endDate: true } } } },
    },
  });
  const ids = projects.map((p) => p.id);
  const approved = ids.length
    ? await prisma.timeEntry.groupBy({
        by: ["milestoneId"],
        where: { timeCard: { status: "APPROVED" }, milestone: { projectId: { in: ids } } },
        _sum: { hours: true },
      })
    : [];
  const projectOfMilestone = new Map(projects.flatMap((p) => p.milestones.map((m) => [m.id, p.id] as const)));
  const approvedByProject = new Map<string, number>();
  for (const a of approved) {
    const pid = projectOfMilestone.get(a.milestoneId);
    if (pid) approvedByProject.set(pid, (approvedByProject.get(pid) ?? 0) + Number(a._sum.hours ?? 0));
  }

  return {
    projects: projects.map((p) => ({
      id: p.id, name: p.name, clientId: p.clientId, clientName: p.client.name, status: p.status, isInternal: p.isInternal,
      managerId: p.managerId, endDate: iso(p.endDate), poNumber: p.poNumber, poWaived: p.poWaived,
      budgetHours: p.budgetHours == null ? null : Number(p.budgetHours),
      approvedHours: Math.round((approvedByProject.get(p.id) ?? 0) * 100) / 100,
      sponsorContactId: p.sponsorContactId,
      lastStatusIso: iso(p.statusReports[0]?.reportDate),
      openIssueCount: p._count.raidItems,
      hasWonOpportunity: p.opportunity?.stage === "WON",
    })),
    milestones: projects.flatMap((p) => p.milestones.map((m) => ({
      id: m.id, name: m.name, projectId: p.id, endDate: iso(m.endDate), status: m.status,
      writtenOff: m.writtenOffAt != null, timeEntryOpen: m.timeEntryOpen,
      assignmentEndDates: m.assignments.map((a) => a.endDate.toISOString().slice(0, 10)),
    }))),
  };
}

export async function loadHygiene(companyId: string, projectIds: string[] | "ALL", todayIso: string): Promise<HygieneItem[]> {
  return evaluateHygiene(await loadHygieneRows(companyId, projectIds), todayIso);
}
