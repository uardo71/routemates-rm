import { format, differenceInCalendarDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { RAG_LABEL } from "@/lib/delivery";
import {
  DAY_HINT, PRIORITY_RANK, cadenceDays,
  type DayItem, type DayPriority, type DayStats, type WorkspaceRow, type UpcomingItem,
} from "@/lib/delivery-day";
import type { RagStatus } from "@prisma/client";
import { getActiveGuides } from "@/lib/guides-server";
import { DeliveryHomeClient } from "./delivery-home-client";

const OVERALL = "_overall";
const scopeKey = (engId: string | null) => engId ?? OVERALL;

export default async function DeliveryPage() {
  const user = await requirePermission("delivery:manage");
  // A PM sees the projects they manage; an admin sees all. Internal/overhead projects (vacations,
  // R&D, etc.) are never customer delivery — keep them out of the cockpit entirely.
  const base = { companyId: user.companyId, isInternal: false };
  const where = user.role === "ADMIN" ? base : { ...base, managerId: user.id };

  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { name: true } },
      engagements: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true } },
      statusReports: {
        orderBy: { reportDate: "desc" },
        select: { engagementId: true, reportDate: true, sentAt: true, overallRag: true, cadence: true, progressPercent: true, summary: true },
      },
      raidItems: {
        where: { status: { not: "CLOSED" }, type: { in: ["RISK", "ISSUE"] } },
        select: { id: true, engagementId: true, title: true, severity: true, dueDate: true },
      },
      planTasks: { select: { engagementId: true, name: true, dueDate: true, status: true, isMilestone: true, progress: true } },
      meetings: { select: { engagementId: true, actions: { select: { done: true, dueDate: true, description: true } } } },
      cutoverPlans: { select: { tasks: { select: { id: true, parentId: true, status: true } } } },
      uatScripts: { select: { status: true, _count: { select: { cases: true } } } },
    },
    orderBy: [{ name: "asc" }],
  });

  const today = new Date(new Date().toISOString().slice(0, 10)); // UTC midnight
  const soon = new Date(today); soon.setUTCDate(soon.getUTCDate() + 7);

  const dayItems: DayItem[] = [];
  const upcoming: UpcomingItem[] = [];
  const workspaces: WorkspaceRow[] = [];
  let openIssuesTotal = 0;

  for (const p of projects) {
    const active = p.status === "ACTIVE";
    const hasEng = p.engagements.length > 0;

    // Latest status report per scope.
    const latestByScope = new Map<string, (typeof p.statusReports)[number]>();
    for (const r of p.statusReports) {
      const k = scopeKey(r.engagementId);
      if (!latestByScope.has(k)) latestByScope.set(k, r); // first = latest (desc order)
    }
    // Group signals per scope.
    const raidByScope = new Map<string, typeof p.raidItems>();
    for (const r of p.raidItems) {
      const k = scopeKey(r.engagementId);
      (raidByScope.get(k) ?? raidByScope.set(k, []).get(k)!).push(r);
    }
    const planByScope = new Map<string, typeof p.planTasks>();
    for (const t of p.planTasks) {
      const k = scopeKey(t.engagementId);
      (planByScope.get(k) ?? planByScope.set(k, []).get(k)!).push(t);
    }
    const actionsByScope = new Map<string, { done: boolean; dueDate: Date | null; description: string }[]>();
    for (const m of p.meetings) {
      const k = scopeKey(m.engagementId);
      const arr = actionsByScope.get(k) ?? actionsByScope.set(k, []).get(k)!;
      for (const a of m.actions) arr.push(a);
    }

    // Which scopes become their own workspace row. No-engagement project → just Overall (the project).
    // Multi-engagement project → each engagement, plus Overall only if it carries project-level items.
    const scopes: { engagementId: string | null; name: string; isEngagement: boolean }[] = [];
    if (!hasEng) {
      scopes.push({ engagementId: null, name: p.name, isEngagement: false });
    } else {
      const overallHasItems =
        (latestByScope.has(OVERALL)) ||
        (raidByScope.get(OVERALL)?.length ?? 0) > 0 ||
        (planByScope.get(OVERALL)?.length ?? 0) > 0 ||
        (actionsByScope.get(OVERALL)?.length ?? 0) > 0;
      if (overallHasItems) scopes.push({ engagementId: null, name: "Overall", isEngagement: false });
      for (const e of p.engagements) scopes.push({ engagementId: e.id, name: e.name, isEngagement: true });
    }

    for (const s of scopes) {
      const k = scopeKey(s.engagementId);
      const last = latestByScope.get(k) ?? null;
      const raid = raidByScope.get(k) ?? [];
      const plan = planByScope.get(k) ?? [];
      const actions = actionsByScope.get(k) ?? [];
      // Only engagement rows and single (no-engagement) projects are "customer-facing" for status nudges.
      const customerFacing = s.isEngagement || !hasEng;

      const context = s.isEngagement ? `${p.client.name} · ${s.name}` : p.client.name;
      openIssuesTotal += raid.length;

      const lastStatusDays = last ? differenceInCalendarDays(today, new Date(last.reportDate)) : null;
      const cad = cadenceDays(last?.cadence);
      let statusDue = false;
      if (customerFacing && active) {
        if (lastStatusDays === null) statusDue = true; // never reported
        else if (cad !== null && lastStatusDays > cad) statusDue = true;
      }

      // A task is done if COMPLETED or at 100% (progress drives status).
      const planOpen = (t: (typeof plan)[number]) => t.status !== "COMPLETED" && t.progress < 100;
      const overduePlan = plan.filter((t) => !t.isMilestone && planOpen(t) && t.dueDate != null && new Date(t.dueDate) < today);
      const overdueIssues = raid.filter((r) => r.dueDate != null && new Date(r.dueDate) < today);
      const highOpenIssues = raid.filter((r) => (r.severity === "HIGH" || r.severity === "CRITICAL") && !(r.dueDate != null && new Date(r.dueDate) < today));
      const overdueActions = actions.filter((a) => !a.done && a.dueDate != null && new Date(a.dueDate) < today);

      // ----- day items (the path) -----
      const mk = (kind: DayItem["kind"], priority: DayPriority, title: string) => {
        const h = DAY_HINT[kind];
        dayItems.push({ id: `${p.id}:${k}:${kind}`, kind, priority, title, context, projectId: p.id, engagementId: s.engagementId, tab: h.tab, cta: h.cta, how: h.how });
      };
      if (statusDue) {
        if (lastStatusDays === null) mk("NO_STATUS", "WARN", `Send the first status update — ${s.name}`);
        else mk("STATUS_DUE", cad !== null && lastStatusDays > cad * 2 ? "CRIT" : "WARN", `Status update overdue — ${s.name}`);
      }
      if (overduePlan.length > 0) mk("PLAN_OVERDUE", "WARN", overduePlan.length === 1 ? `Plan task overdue: ${overduePlan[0].name}` : `${overduePlan.length} plan tasks overdue — ${s.name}`);
      if (overdueIssues.length > 0) {
        const crit = overdueIssues.some((r) => r.severity === "HIGH" || r.severity === "CRITICAL");
        mk("ISSUE_DUE", crit ? "CRIT" : "WARN", overdueIssues.length === 1 ? `Issue past due: ${overdueIssues[0].title}` : `${overdueIssues.length} issues past due — ${s.name}`);
      }
      if (highOpenIssues.length > 0) mk("ISSUE_OPEN", "INFO", highOpenIssues.length === 1 ? `High-severity issue open: ${highOpenIssues[0].title}` : `${highOpenIssues.length} high-severity issues open — ${s.name}`);
      if (overdueActions.length > 0) mk("ACTION_OVERDUE", "WARN", overdueActions.length === 1 ? `Action overdue: ${overdueActions[0].description}` : `${overdueActions.length} meeting actions overdue — ${s.name}`);

      // ----- upcoming this week -----
      for (const t of plan) {
        if (!planOpen(t) || t.dueDate == null) continue;
        const d = new Date(t.dueDate);
        if (d >= today && d <= soon) {
          const days = differenceInCalendarDays(d, today);
          upcoming.push({ id: `up:${p.id}:${k}:${t.name}:${t.dueDate}`, dateLabel: format(d, "EEE d MMM"), daysAway: days, title: t.name, context, tag: t.isMilestone ? "Milestone" : "Task", projectId: p.id, engagementId: s.engagementId, tab: "plan" });
        }
      }

      // ----- workspace row -----
      let rag: RagStatus = last?.overallRag ?? (customerFacing && active ? "AMBER" : "GREEN");
      if (overdueIssues.some((r) => r.severity === "HIGH" || r.severity === "CRITICAL")) rag = "RED";

      const nextT = plan
        .filter((t) => planOpen(t) && t.dueDate != null && new Date(t.dueDate) >= today)
        .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0] ?? null;
      const nextMilestone = nextT ? `${nextT.name} · ${format(new Date(nextT.dueDate!), "MMM d")}` : null;
      const statusLine = last?.summary?.trim()
        ? last.summary.trim()
        : lastStatusDays === null && customerFacing && active
          ? "No status update sent yet"
          : statusDue
            ? "Status update due"
            : RAG_LABEL[rag];

      workspaces.push({
        key: k === OVERALL ? `${p.id}:overall` : `${p.id}:${s.engagementId}`,
        projectId: p.id,
        engagementId: s.engagementId,
        name: s.isEngagement ? s.name : p.name,
        account: hasEng ? p.name : null,
        customerName: p.client.name,
        isEngagement: s.isEngagement,
        rag,
        ragLabel: RAG_LABEL[rag],
        lastStatusDays,
        lastStatusDraft: last ? !last.sentAt : false,
        statusDue,
        openIssues: raid.length,
        overdueTasks: overduePlan.length,
        progress: last?.progressPercent ?? null,
        statusLine,
        nextMilestone,
      });
    }

    // Project-level cutover readiness (once per project): after UAT is accepted, or as go-live nears,
    // flag that the cutover to production still needs finishing so the PM can push the consultant.
    const cutoverTasks = p.cutoverPlans.flatMap((x) => x.tasks);
    const cutoverLeaves = cutoverTasks.filter((t) => !cutoverTasks.some((c) => c.parentId === t.id));
    const cutoverComplete = cutoverLeaves.length > 0 && cutoverLeaves.every((t) => t.status === "DONE" || t.status === "SKIPPED");
    const goLive = p.endDate ? new Date(p.endDate.toISOString().slice(0, 10)) : null;
    const daysToGoLive = goLive ? differenceInCalendarDays(goLive, today) : null;
    const goLiveNear = daysToGoLive != null && daysToGoLive <= 14;

    // UAT test script must be prepared & sent before UAT (consultant owns it; PM governs).
    const uatWindow = p.uatStatus !== "NOT_STARTED" || (active && daysToGoLive != null && daysToGoLive >= 0 && daysToGoLive <= 30);
    const uatCases = p.uatScripts.reduce((s, x) => s + x._count.cases, 0);
    if (active && uatWindow && (p.uatScripts.length === 0 || p.uatScripts.some((x) => x.status !== "SENT"))) {
      const h = DAY_HINT.UAT_SCRIPT_DUE;
      dayItems.push({
        id: `${p.id}:uatscript`,
        kind: "UAT_SCRIPT_DUE",
        priority: p.uatStatus !== "NOT_STARTED" ? "CRIT" : "WARN",
        title: `UAT test script not sent — ${uatCases > 0 ? `${uatCases} cases` : "not started"}`,
        context: p.name,
        projectId: p.id,
        engagementId: null,
        tab: h.tab,
        cta: h.cta,
        how: h.how,
        href: `/delivery/${p.id}/uat`,
      });
    }

    if (!cutoverComplete && (p.uatAccepted || (active && goLiveNear))) {
      const h = DAY_HINT.CUTOVER_DUE;
      const progress = cutoverLeaves.length > 0
        ? `${cutoverLeaves.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length}/${cutoverLeaves.length} steps`
        : "not started";
      dayItems.push({
        id: `${p.id}:cutover`,
        kind: "CUTOVER_DUE",
        priority: daysToGoLive != null && daysToGoLive <= 3 ? "CRIT" : "WARN",
        title: `Cutover to production — ${progress}`,
        context: p.name,
        projectId: p.id,
        engagementId: null,
        tab: h.tab,
        cta: h.cta,
        how: h.how,
        href: `/delivery/${p.id}/cutover`,
      });
    }
  }

  // Sort the path: priority, then a stable kind order.
  const KIND_ORDER: DayItem["kind"][] = ["UAT_SCRIPT_DUE", "CUTOVER_DUE", "NO_STATUS", "STATUS_DUE", "ISSUE_DUE", "PLAN_OVERDUE", "ACTION_OVERDUE", "ISSUE_OPEN"];
  dayItems.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.context.localeCompare(b.context));
  upcoming.sort((a, b) => a.daysAway - b.daysAway);

  const stats: DayStats = {
    overdue: dayItems.filter((d) => d.priority === "CRIT").length,
    todo: dayItems.length,
    dueThisWeek: upcoming.length,
    openIssues: openIssuesTotal,
  };

  const [me, guides] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    getActiveGuides(user.companyId),
  ]);
  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const firstName = (me?.name ?? "there").split(" ")[0];
  const todayLabel = format(new Date(), "EEE · d MMM yyyy");

  return (
    <DeliveryHomeClient
      greeting={greeting}
      firstName={firstName}
      todayLabel={todayLabel}
      isAdmin={user.role === "ADMIN"}
      dayItems={dayItems}
      stats={stats}
      upcoming={upcoming.slice(0, 6)}
      workspaces={workspaces}
      guides={guides}
    />
  );
}
