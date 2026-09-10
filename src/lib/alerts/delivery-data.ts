import "server-only";
import { prisma } from "@/lib/prisma";
import type { AlertData } from "./rules";

// Loads what the delivery alert rules need, shaped as plain values so the predicates stay pure and
// identical to My Day's (both call src/lib/delivery-signals.ts).

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const OVERALL = "_overall";

export async function loadDeliveryAlertData(companyId: string, baseUrl: string): Promise<AlertData["delivery"]> {
  const projects = await prisma.project.findMany({
    where: { companyId, isInternal: false },
    select: {
      id: true, name: true, managerId: true, status: true, startDate: true, endDate: true, createdAt: true, uatStatus: true, uatAccepted: true, trackOverallStatus: true,
      engagements: { select: { id: true, name: true, status: true } },
      statusReports: { orderBy: { reportDate: "desc" }, select: { engagementId: true, reportDate: true, cadence: true } },
      planTasks: { select: { id: true, name: true, engagementId: true, ownerUserId: true, status: true, progress: true, isMilestone: true, dueDate: true } },
      raidItems: { where: { status: { not: "CLOSED" } }, select: { id: true, title: true, engagementId: true, ownerUserId: true, status: true, severity: true, dueDate: true } },
      uatScripts: { select: { status: true } },
      cutoverPlans: { select: { tasks: { select: { id: true, parentId: true, status: true } } } },
    },
  });

  const workspaces: AlertData["delivery"]["workspaces"] = [];
  const planTasks: AlertData["delivery"]["planTasks"] = [];
  const raidItems: AlertData["delivery"]["raidItems"] = [];
  const projectRows: AlertData["delivery"]["projects"] = [];

  for (const p of projects) {
    const active = p.status === "ACTIVE";
    const done = p.status === "COMPLETED" || p.status === "CANCELLED";
    const hasEng = p.engagements.length > 0;
    const sinceIso = iso(p.startDate) ?? iso(p.createdAt);
    const latestByScope = new Map<string, { reportDate: Date; cadence: string | null }>();
    for (const r of p.statusReports) { const k = r.engagementId ?? OVERALL; if (!latestByScope.has(k)) latestByScope.set(k, r); }

    const scopes: { engagementId: string | null; name: string; isEngagement: boolean; done: boolean }[] = hasEng
      ? [
          ...(p.trackOverallStatus || latestByScope.has(OVERALL) ? [{ engagementId: null, name: "Overall", isEngagement: false, done }] : []),
          ...p.engagements.map((e) => ({ engagementId: e.id, name: e.name, isEngagement: true, done: done || e.status === "COMPLETED" })),
        ]
      : [{ engagementId: null, name: p.name, isEngagement: false, done }];

    for (const s of scopes) {
      const last = latestByScope.get(s.engagementId ?? OVERALL) ?? null;
      workspaces.push({
        key: `${p.id}:${s.engagementId ?? "overall"}`,
        projectId: p.id, projectName: p.name, engagementId: s.engagementId, engagementName: s.isEngagement ? s.name : null,
        managerId: p.managerId, active, done: s.done,
        customerFacing: s.isEngagement || !hasEng || p.trackOverallStatus,
        lastReportDateIso: last ? iso(last.reportDate) : null, cadence: last?.cadence ?? null, sinceIso,
      });
    }
    const engName = (id: string | null) => (id ? p.engagements.find((e) => e.id === id)?.name ?? null : null);
    const engDone = (id: string | null) => done || (id ? p.engagements.find((e) => e.id === id)?.status === "COMPLETED" : false);
    for (const t of p.planTasks) {
      if (engDone(t.engagementId)) continue;
      planTasks.push({ id: t.id, name: t.name, projectId: p.id, projectName: p.name, engagementId: t.engagementId, engagementName: engName(t.engagementId), managerId: p.managerId, ownerUserId: t.ownerUserId, status: t.status, progress: t.progress, isMilestone: t.isMilestone, dueDate: iso(t.dueDate) });
    }
    for (const r of p.raidItems) {
      if (engDone(r.engagementId)) continue;
      raidItems.push({ id: r.id, title: r.title, projectId: p.id, projectName: p.name, engagementId: r.engagementId, engagementName: engName(r.engagementId), managerId: p.managerId, ownerUserId: r.ownerUserId, status: r.status, severity: r.severity, dueDate: iso(r.dueDate) });
    }
    const allTasks = p.cutoverPlans.flatMap((c) => c.tasks);
    const leaves = allTasks.filter((t) => !allTasks.some((c) => c.parentId === t.id)).map((t) => ({ status: t.status }));
    projectRows.push({ id: p.id, name: p.name, managerId: p.managerId, active, done, uatStatus: p.uatStatus, uatAccepted: p.uatAccepted, endDateIso: iso(p.endDate), scripts: p.uatScripts.map((s) => ({ status: s.status })), cutoverLeaves: leaves });
  }
  return { baseUrl, workspaces, planTasks, raidItems, projects: projectRows };
}
