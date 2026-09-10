import "server-only";
import { prisma } from "@/lib/prisma";
import { can, canManageProject, type SessionUser } from "@/lib/permissions";
import { enrichAll, type ActionSource, type EnrichedAction, type RegisterAction } from "@/lib/actions-register";

// Server half of the actions register: loads open actions from the four sources into one shape,
// and closes an action "at source" so the originating screen agrees.

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Which projects the register may show: delivery managers see what they manage (admins all);
 *  everyone else sees only actions assigned to them, across every project. */
export async function actionScope(user: SessionUser): Promise<{ projectIds: string[] | "ALL"; mineOnly: boolean }> {
  if (!can(user, "delivery:manage")) return { projectIds: "ALL", mineOnly: true };
  if (user.role === "ADMIN") return { projectIds: "ALL", mineOnly: false };
  const managed = await prisma.project.findMany({ where: { companyId: user.companyId, managerId: user.id }, select: { id: true } });
  return { projectIds: managed.map((p) => p.id), mineOnly: false };
}

export async function loadOpenActions(user: SessionUser, opts: { projectIds?: string[] | "ALL"; mineOnly?: boolean; todayIso: string }): Promise<EnrichedAction[]> {
  const scope = opts.projectIds ?? "ALL";
  const projectWhere = { companyId: user.companyId, isInternal: false, ...(scope === "ALL" ? {} : { id: { in: scope } }) };
  const owner = opts.mineOnly ? { ownerUserId: user.id } : {};
  const projectSel = { select: { id: true, name: true, engagements: { select: { id: true, name: true } } } };

  const [plan, raid, status, meeting] = await Promise.all([
    prisma.planTask.findMany({
      where: { project: projectWhere, isMilestone: false, status: { not: "COMPLETED" }, progress: { lt: 100 }, ...owner },
      select: { id: true, name: true, projectId: true, engagementId: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, progress: true, status: true, project: projectSel },
    }),
    prisma.raidItem.findMany({
      where: { project: projectWhere, status: { not: "CLOSED" }, ...owner },
      select: { id: true, title: true, type: true, severity: true, projectId: true, engagementId: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, status: true, project: projectSel },
    }),
    prisma.statusReportAction.findMany({
      where: { done: false, report: { project: projectWhere }, ...owner },
      select: { id: true, description: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, critical: true, report: { select: { projectId: true, engagementId: true, reportDate: true, project: projectSel } } },
    }),
    prisma.meetingActionItem.findMany({
      where: { done: false, minutes: { project: projectWhere }, ...owner },
      select: { id: true, description: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, minutes: { select: { projectId: true, engagementId: true, title: true, project: projectSel } } },
    }),
  ]);

  const engName = (p: { engagements: { id: string; name: string }[] }, id: string | null) => (id ? p.engagements.find((e) => e.id === id)?.name ?? null : null);
  const rows: RegisterAction[] = [
    ...plan.map((t) => ({
      id: t.id, source: "PLAN" as ActionSource, title: t.name, projectId: t.projectId, projectName: t.project.name,
      engagementId: t.engagementId, engagementName: engName(t.project, t.engagementId),
      owner: t.owner, ownerUserId: t.ownerUserId, dueDate: iso(t.dueDate), createdAt: t.createdAt.toISOString(),
      status: t.status === "BLOCKED" ? "Blocked" : `${t.progress}%`, critical: t.status === "BLOCKED",
    })),
    ...raid.map((r) => ({
      id: r.id, source: "RAID" as ActionSource, title: r.title, projectId: r.projectId, projectName: r.project.name,
      engagementId: r.engagementId, engagementName: engName(r.project, r.engagementId),
      owner: r.owner, ownerUserId: r.ownerUserId, dueDate: iso(r.dueDate), createdAt: r.createdAt.toISOString(),
      status: r.status === "IN_PROGRESS" ? "In progress" : "Open", critical: r.severity === "HIGH" || r.severity === "CRITICAL",
    })),
    ...status.map((a) => ({
      id: a.id, source: "STATUS" as ActionSource, title: a.description, projectId: a.report.projectId, projectName: a.report.project.name,
      engagementId: a.report.engagementId, engagementName: engName(a.report.project, a.report.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(),
      status: `Status ${iso(a.report.reportDate)}`, critical: a.critical,
    })),
    ...meeting.map((a) => ({
      id: a.id, source: "MEETING" as ActionSource, title: a.description, projectId: a.minutes.projectId, projectName: a.minutes.project.name,
      engagementId: a.minutes.engagementId, engagementName: engName(a.minutes.project, a.minutes.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(),
      status: a.minutes.title, critical: false,
    })),
  ];
  return enrichAll(rows, opts.todayIso);
}

/** Closes one action where it lives. The caller may be the owner, or someone who manages the project. */
export async function completeActionAtSource(user: SessionUser, source: ActionSource, id: string): Promise<{ error?: string }> {
  const now = new Date();
  const allowed = async (projectId: string, ownerUserId: string | null) => ownerUserId === user.id || (can(user, "delivery:manage") && (await canManageProject(user, projectId)));
  const company = { companyId: user.companyId };
  switch (source) {
    case "PLAN": {
      const t = await prisma.planTask.findFirst({ where: { id, project: company }, select: { projectId: true, ownerUserId: true } });
      if (!t) return { error: "Action not found." };
      if (!(await allowed(t.projectId, t.ownerUserId))) return { error: "You can't close this action." };
      await prisma.planTask.update({ where: { id }, data: { progress: 100, status: "COMPLETED" } });
      return {};
    }
    case "RAID": {
      const r = await prisma.raidItem.findFirst({ where: { id, project: company }, select: { projectId: true, ownerUserId: true } });
      if (!r) return { error: "Action not found." };
      if (!(await allowed(r.projectId, r.ownerUserId))) return { error: "You can't close this action." };
      await prisma.raidItem.update({ where: { id }, data: { status: "CLOSED" } });
      return {};
    }
    case "STATUS": {
      const a = await prisma.statusReportAction.findFirst({ where: { id, report: { project: company } }, select: { ownerUserId: true, report: { select: { projectId: true } } } });
      if (!a) return { error: "Action not found." };
      if (!(await allowed(a.report.projectId, a.ownerUserId))) return { error: "You can't close this action." };
      await prisma.statusReportAction.update({ where: { id }, data: { done: true, doneAt: now } });
      return {};
    }
    case "MEETING": {
      const a = await prisma.meetingActionItem.findFirst({ where: { id, minutes: { project: company } }, select: { ownerUserId: true, minutes: { select: { projectId: true } } } });
      if (!a) return { error: "Action not found." };
      if (!(await allowed(a.minutes.projectId, a.ownerUserId))) return { error: "You can't close this action." };
      await prisma.meetingActionItem.update({ where: { id }, data: { done: true, doneAt: now } });
      return {};
    }
  }
}

/** How many open actions are assigned to this user — the My Day header figure. */
export async function countMyOpenActions(user: SessionUser): Promise<number> {
  const owner = { ownerUserId: user.id };
  const [a, b, c, d] = await Promise.all([
    prisma.planTask.count({ where: { ...owner, isMilestone: false, status: { not: "COMPLETED" }, progress: { lt: 100 } } }),
    prisma.raidItem.count({ where: { ...owner, status: { not: "CLOSED" } } }),
    prisma.statusReportAction.count({ where: { ...owner, done: false } }),
    prisma.meetingActionItem.count({ where: { ...owner, done: false } }),
  ]);
  return a + b + c + d;
}
