import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, canManageProject, type SessionUser } from "@/lib/permissions";
import { enrichAll, completionChange, type ActionSource, type EnrichedAction, type RegisterAction } from "@/lib/actions-register";

// Server half of the actions register: loads actions (open, completed or both) from the four sources
// into one shape, and completes or reopens them "at source" so the originating screen agrees.

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Which projects the register may show: delivery managers see what they manage (admins all);
 *  everyone else sees only actions assigned to them, across every project. The same rule applies to
 *  the completed list. */
export async function actionScope(user: SessionUser): Promise<{ projectIds: string[] | "ALL"; mineOnly: boolean }> {
  if (!can(user, "delivery:manage")) return { projectIds: "ALL", mineOnly: true };
  if (user.role === "ADMIN") return { projectIds: "ALL", mineOnly: false };
  const managed = await prisma.project.findMany({ where: { companyId: user.companyId, managerId: user.id }, select: { id: true } });
  return { projectIds: managed.map((p) => p.id), mineOnly: false };
}

export type ActionLoad = "open" | "completed" | "all";

export async function loadActions(user: SessionUser, opts: { projectIds?: string[] | "ALL"; mineOnly?: boolean; todayIso: string; include?: ActionLoad }): Promise<EnrichedAction[]> {
  const include = opts.include ?? "open";
  const wantOpen = include !== "completed";
  const wantDone = include !== "open";
  const scope = opts.projectIds ?? "ALL";
  const projectWhere = { companyId: user.companyId, isInternal: false, ...(scope === "ALL" ? {} : { id: { in: scope } }) };
  const owner = opts.mineOnly ? { ownerUserId: user.id } : {};
  const projectSel = { select: { id: true, name: true, engagements: { select: { id: true, name: true } } } };

  const planState: Prisma.PlanTaskWhereInput = wantOpen && wantDone ? {} : wantOpen
    ? { status: { not: "COMPLETED" }, progress: { lt: 100 } }
    : { OR: [{ status: "COMPLETED" }, { progress: { gte: 100 } }] };
  const raidState: Prisma.RaidItemWhereInput = wantOpen && wantDone ? {} : wantOpen ? { status: { not: "CLOSED" } } : { status: "CLOSED" };
  const doneState = wantOpen && wantDone ? {} : { done: !wantOpen };

  const [plan, raid, status, meeting] = await Promise.all([
    prisma.planTask.findMany({
      where: { project: projectWhere, isMilestone: false, ...planState, ...owner },
      select: { id: true, name: true, projectId: true, engagementId: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, updatedAt: true, progress: true, status: true, completedAt: true, completedById: true, project: projectSel },
    }),
    prisma.raidItem.findMany({
      where: { project: projectWhere, ...raidState, ...owner },
      select: { id: true, title: true, type: true, severity: true, projectId: true, engagementId: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, updatedAt: true, status: true, completedAt: true, completedById: true, project: projectSel },
    }),
    // Only the newest copy of a carried status action: its older copies are history in older reports.
    prisma.statusReportAction.findMany({
      where: { report: { project: projectWhere }, carriedTo: { none: {} }, ...doneState, ...owner },
      select: { id: true, description: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, critical: true, done: true, doneAt: true, doneById: true, report: { select: { projectId: true, engagementId: true, reportDate: true, project: projectSel } } },
    }),
    prisma.meetingActionItem.findMany({
      where: { minutes: { project: projectWhere }, ...doneState, ...owner },
      select: { id: true, description: true, owner: true, ownerUserId: true, dueDate: true, createdAt: true, done: true, doneAt: true, doneById: true, minutes: { select: { projectId: true, engagementId: true, title: true, project: projectSel } } },
    }),
  ]);

  // Who completed what — names resolved once. A deleted person simply shows no name.
  const byIds = [...new Set([...plan.map((t) => t.completedById), ...raid.map((r) => r.completedById), ...status.map((a) => a.doneById), ...meeting.map((a) => a.doneById)].filter((x): x is string => !!x))];
  const names = new Map(byIds.length ? (await prisma.user.findMany({ where: { id: { in: byIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]) : []);
  const who = (id: string | null) => (id ? names.get(id) ?? null : null);

  const engName = (p: { engagements: { id: string; name: string }[] }, id: string | null) => (id ? p.engagements.find((e) => e.id === id)?.name ?? null : null);
  const rows: RegisterAction[] = [
    ...plan.map((t) => {
      const done = t.status === "COMPLETED" || t.progress >= 100;
      return {
        id: t.id, source: "PLAN" as ActionSource, title: t.name, projectId: t.projectId, projectName: t.project.name,
        engagementId: t.engagementId, engagementName: engName(t.project, t.engagementId),
        owner: t.owner, ownerUserId: t.ownerUserId, dueDate: iso(t.dueDate), createdAt: t.createdAt.toISOString(),
        status: done ? "Completed" : t.status === "BLOCKED" ? "Blocked" : `${t.progress}%`, critical: !done && t.status === "BLOCKED",
        done, completedAt: done ? (t.completedAt ?? t.updatedAt).toISOString() : null, completedBy: done ? who(t.completedById) : null,
      };
    }),
    ...raid.map((r) => {
      const done = r.status === "CLOSED";
      return {
        id: r.id, source: "RAID" as ActionSource, title: r.title, projectId: r.projectId, projectName: r.project.name,
        engagementId: r.engagementId, engagementName: engName(r.project, r.engagementId),
        owner: r.owner, ownerUserId: r.ownerUserId, dueDate: iso(r.dueDate), createdAt: r.createdAt.toISOString(),
        status: done ? "Closed" : r.status === "IN_PROGRESS" ? "In progress" : "Open", critical: r.severity === "HIGH" || r.severity === "CRITICAL",
        done, completedAt: done ? (r.completedAt ?? r.updatedAt).toISOString() : null, completedBy: done ? who(r.completedById) : null,
      };
    }),
    ...status.map((a) => ({
      id: a.id, source: "STATUS" as ActionSource, title: a.description, projectId: a.report.projectId, projectName: a.report.project.name,
      engagementId: a.report.engagementId, engagementName: engName(a.report.project, a.report.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(),
      status: `Status ${iso(a.report.reportDate)}`, critical: a.critical,
      done: a.done, completedAt: a.done ? (a.doneAt ?? a.createdAt).toISOString() : null, completedBy: a.done ? who(a.doneById) : null,
    })),
    ...meeting.map((a) => ({
      id: a.id, source: "MEETING" as ActionSource, title: a.description, projectId: a.minutes.projectId, projectName: a.minutes.project.name,
      engagementId: a.minutes.engagementId, engagementName: engName(a.minutes.project, a.minutes.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(),
      status: a.minutes.title, critical: false,
      done: a.done, completedAt: a.done ? (a.doneAt ?? a.createdAt).toISOString() : null, completedBy: a.done ? who(a.doneById) : null,
    })),
  ];
  return enrichAll(rows, opts.todayIso);
}

/** Open actions only — kept for callers that never show completed work. */
export const loadOpenActions = (user: SessionUser, opts: { projectIds?: string[] | "ALL"; mineOnly?: boolean; todayIso: string }) => loadActions(user, { ...opts, include: "open" });

export type ActionChange = { source: ActionSource; id: string; done: boolean };

/** Applies the register's saved ticks at source, all or nothing. Each change needs the owner or
 *  someone who manages the project; one refusal and nothing is written.
 *  Completing: issue → Closed, meeting/status action → done, plan task → 100%.
 *  Reopening: issue → Open, meeting/status action → not done, plan task → 0% (set its real progress
 *  in the plan). Who and when is recorded either way. */
export async function setActionsDone(user: SessionUser, changes: ActionChange[]): Promise<{ error?: string; saved: number }> {
  const company = { companyId: user.companyId };
  const mayManage = can(user, "delivery:manage");
  const manages = new Map<string, boolean>();
  const allowed = async (projectId: string, ownerUserId: string | null) => {
    if (ownerUserId === user.id) return true;
    if (!mayManage) return false;
    if (!manages.has(projectId)) manages.set(projectId, await canManageProject(user, projectId));
    return manages.get(projectId)!;
  };
  const now = new Date();
  const ops: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [];
  let denied = 0;
  let missing = 0;

  for (const c of changes) {
    if (c.source === "PLAN") {
      const t = await prisma.planTask.findFirst({ where: { id: c.id, project: company }, select: { projectId: true, ownerUserId: true, status: true, progress: true } });
      if (!t) { missing++; continue; }
      if (!(await allowed(t.projectId, t.ownerUserId))) { denied++; continue; }
      const ch = completionChange(t.status === "COMPLETED" || t.progress >= 100, c.done);
      if (ch === "complete") ops.push((tx) => tx.planTask.update({ where: { id: c.id }, data: { progress: 100, status: "COMPLETED", completedAt: now, completedById: user.id } }));
      if (ch === "reopen") ops.push((tx) => tx.planTask.update({ where: { id: c.id }, data: { progress: 0, status: "NOT_STARTED", completedAt: null, completedById: null } }));
    } else if (c.source === "RAID") {
      const r = await prisma.raidItem.findFirst({ where: { id: c.id, project: company }, select: { projectId: true, ownerUserId: true, status: true } });
      if (!r) { missing++; continue; }
      if (!(await allowed(r.projectId, r.ownerUserId))) { denied++; continue; }
      const ch = completionChange(r.status === "CLOSED", c.done);
      if (ch === "complete") ops.push((tx) => tx.raidItem.update({ where: { id: c.id }, data: { status: "CLOSED", completedAt: now, completedById: user.id } }));
      if (ch === "reopen") ops.push((tx) => tx.raidItem.update({ where: { id: c.id }, data: { status: "OPEN", completedAt: null, completedById: null } }));
    } else if (c.source === "STATUS") {
      const a = await prisma.statusReportAction.findFirst({ where: { id: c.id, report: { project: company } }, select: { ownerUserId: true, done: true, report: { select: { projectId: true } } } });
      if (!a) { missing++; continue; }
      if (!(await allowed(a.report.projectId, a.ownerUserId))) { denied++; continue; }
      const ch = completionChange(a.done, c.done);
      if (ch === "complete") ops.push((tx) => tx.statusReportAction.update({ where: { id: c.id }, data: { done: true, doneAt: now, doneById: user.id } }));
      if (ch === "reopen") ops.push((tx) => tx.statusReportAction.update({ where: { id: c.id }, data: { done: false, doneAt: null, doneById: null } }));
    } else {
      const a = await prisma.meetingActionItem.findFirst({ where: { id: c.id, minutes: { project: company } }, select: { ownerUserId: true, done: true, minutes: { select: { projectId: true } } } });
      if (!a) { missing++; continue; }
      if (!(await allowed(a.minutes.projectId, a.ownerUserId))) { denied++; continue; }
      const ch = completionChange(a.done, c.done);
      if (ch === "complete") ops.push((tx) => tx.meetingActionItem.update({ where: { id: c.id }, data: { done: true, doneAt: now, doneById: user.id } }));
      if (ch === "reopen") ops.push((tx) => tx.meetingActionItem.update({ where: { id: c.id }, data: { done: false, doneAt: null, doneById: null } }));
    }
  }

  if (missing > 0) return { error: `${missing} of these actions no longer exist — refresh the page and try again.`, saved: 0 };
  if (denied > 0) return { error: `You can't change ${denied} of these actions: only the owner or the project manager can. Nothing was saved.`, saved: 0 };
  if (ops.length > 0) await prisma.$transaction(async (tx) => { for (const op of ops) await op(tx); });
  return { saved: ops.length };
}

/** How many open actions are assigned to this user — the My Day header figure. */
export async function countMyOpenActions(user: SessionUser): Promise<number> {
  const owner = { ownerUserId: user.id };
  const [a, b, c, d] = await Promise.all([
    prisma.planTask.count({ where: { ...owner, isMilestone: false, status: { not: "COMPLETED" }, progress: { lt: 100 } } }),
    prisma.raidItem.count({ where: { ...owner, status: { not: "CLOSED" } } }),
    prisma.statusReportAction.count({ where: { ...owner, done: false, carriedTo: { none: {} } } }),
    prisma.meetingActionItem.count({ where: { ...owner, done: false } }),
  ]);
  return a + b + c + d;
}
