import Link from "next/link";
import { notFound } from "next/navigation";
import { format, differenceInCalendarDays } from "date-fns";
import { TriangleAlertIcon, CalendarIcon, MessageSquareIcon, DiamondIcon, RocketIcon, ClipboardCheckIcon, CheckCircle2Icon, ListChecksIcon } from "lucide-react";
import { enrichAll, ACTION_SOURCE_LABEL, type RegisterAction } from "@/lib/actions-register";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { canManageProject, STAFF_ONLY } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { RAG_DOT, RAG_LABEL, RAG_PILL, worstRag, phaseProgress } from "@/lib/delivery";
import { cadenceDays } from "@/lib/delivery-day";
import type { RagStatus } from "@prisma/client";
import { StatusReportsClient, type ReportRow } from "./status-reports-client";
import { RaidClient, type RaidRow } from "./raid-client";
import { MinutesClient, type MinutesRow } from "./minutes-client";
import { DocumentsLibraryClient, type LibraryDoc } from "./documents-client";
import { PlanClient, type PlanRow } from "./plan-client";
import { EngagementBar } from "./engagement-bar";
import { CockpitShell, type CockpitTab } from "./cockpit-shell";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const COCKPIT_TABS = ["overview", "status", "plan", "raid", "minutes", "documents"];

export default async function DeliveryProjectPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ eng?: string; tab?: string; from?: string }> }) {
  const { projectId } = await params;
  const { eng, tab, from } = await searchParams;
  // "overview" is the legacy value from when the portfolio was a tab inside the cockpit.
  const fromPortfolio = from === "portfolio" || from === "overview";
  const backHref = fromPortfolio ? "/portfolio" : "/delivery";
  const activeTab = COCKPIT_TABS.includes(tab ?? "") ? (tab as string) : "overview";
  const user = await requirePermission("delivery:manage");
  if (!(await canManageProject(user, projectId))) notFound();

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
    include: {
      client: { select: { name: true } },
      manager: { select: { name: true } },
      engagements: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true, members: { select: { user: { select: { id: true, name: true } } } } } },
      statusReports: { orderBy: { reportDate: "desc" }, include: { author: { select: { name: true } }, actions: { orderBy: { sortOrder: "asc" } }, documents: { select: { id: true, fileName: true, originalName: true } } } },
      raidItems: { orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { createdBy: { select: { name: true } } } },
      meetings: { orderBy: { date: "desc" }, include: { createdBy: { select: { name: true } }, actions: { orderBy: { sortOrder: "asc" } }, participants: { orderBy: { sortOrder: "asc" } }, documents: { select: { id: true, fileName: true, originalName: true } } } },
      documents: { orderBy: { uploadedAt: "desc" }, include: { uploadedBy: { select: { name: true } } } },
      planTasks: { orderBy: { sortOrder: "asc" } },
      cutoverPlans: { select: { id: true, engagementId: true, tasks: { select: { id: true, parentId: true, status: true } } } },
      uatScripts: { select: { id: true, engagementId: true, status: true, _count: { select: { cases: true } } } },
    },
  });
  if (!project) notFound();
  const staff = await prisma.user.findMany({
    where: { companyId: user.companyId, active: true, ...STAFF_ONLY },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Selected engagement (null = "Overall", i.e. project-level governance).
  const selectedEng = project.engagements.some((e) => e.id === eng) ? (eng as string) : null;
  const inEng = <T extends { engagementId: string | null }>(x: T) => (x.engagementId ?? null) === selectedEng;

  const reports: ReportRow[] = project.statusReports.filter(inEng).map((r) => ({
    id: r.id, reportDate: iso(r.reportDate)!, periodStart: iso(r.periodStart), periodEnd: iso(r.periodEnd),
    cadence: r.cadence, overallRag: r.overallRag, scheduleRag: r.scheduleRag, budgetRag: r.budgetRag, scopeRag: r.scopeRag, progressPercent: r.progressPercent,
    summary: r.summary, accomplishments: r.accomplishments, correctiveActions: r.correctiveActions, decisionsNeeded: r.decisionsNeeded, milestoneNotes: r.milestoneNotes,
    actions: r.actions.map((a) => ({ id: a.id, description: a.description, owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), critical: a.critical, done: a.done, doneAt: a.doneAt ? a.doneAt.toISOString() : null })),
    sentAt: iso(r.sentAt), authorName: r.author.name,
    documents: r.documents.map((d) => ({ id: d.id, fileName: d.fileName, originalName: d.originalName })),
  }));

  const raid: RaidRow[] = project.raidItems.filter(inEng).map((r) => ({
    id: r.id, type: r.type, title: r.title, description: r.description, severity: r.severity, status: r.status,
    owner: r.owner, ownerUserId: r.ownerUserId, dueDate: iso(r.dueDate), response: r.response,
  }));

  const minutes: MinutesRow[] = project.meetings.filter(inEng).map((m) => ({
    id: m.id, date: iso(m.date)!, title: m.title, attendees: m.attendees, notes: m.notes, createdByName: m.createdBy.name,
    timeFrom: m.timeFrom, timeTo: m.timeTo, location: m.location, minuteTaker: m.minuteTaker,
    agendaTopic: m.agendaTopic, agendaWho: m.agendaWho, agendaDuration: m.agendaDuration,
    participants: m.participants.map((p) => ({ name: p.name, company: p.company, role: p.role, group: p.group })),
    actions: m.actions.map((a) => ({ description: a.description, owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), done: a.done })),
    documents: m.documents.map((d) => ({ id: d.id, fileName: d.fileName, originalName: d.originalName })),
  }));
  const docs: LibraryDoc[] = project.documents.filter(inEng).map((d) => ({
    id: d.id, kind: d.kind, fileName: d.fileName, originalName: d.originalName, uploadedAt: iso(d.uploadedAt)!, uploadedByName: d.uploadedBy.name,
  }));
  const plan: PlanRow[] = project.planTasks.filter(inEng).map((t) => ({
    id: t.id, phase: t.phase, name: t.name, owner: t.owner, ownerUserId: t.ownerUserId, startDate: iso(t.startDate), dueDate: iso(t.dueDate), progress: t.progress, status: t.status, isMilestone: t.isMilestone,
  }));

  const openRaidList = raid.filter((r) => r.status !== "CLOSED");

  // Every open action in scope, worst-overdue first — the Overview's "Actions" card.
  const engNameOf = (id: string | null) => (id ? project.engagements.find((e) => e.id === id)?.name ?? null : null);
  const scopeActions: RegisterAction[] = [
    ...project.raidItems.filter(inEng).filter((r) => r.status !== "CLOSED").map((r) => ({
      id: r.id, source: "RAID" as const, title: r.title, projectId: project.id, projectName: project.name, engagementId: r.engagementId, engagementName: engNameOf(r.engagementId),
      owner: r.owner, ownerUserId: r.ownerUserId, dueDate: iso(r.dueDate), createdAt: r.createdAt.toISOString(), status: r.status === "IN_PROGRESS" ? "In progress" : "Open", critical: r.severity === "HIGH" || r.severity === "CRITICAL",
    })),
    ...project.meetings.filter(inEng).flatMap((m) => m.actions.filter((a) => !a.done).map((a) => ({
      id: a.id, source: "MEETING" as const, title: a.description, projectId: project.id, projectName: project.name, engagementId: m.engagementId, engagementName: engNameOf(m.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(), status: m.title, critical: false,
    }))),
    ...project.statusReports.filter(inEng).flatMap((r) => r.actions.filter((a) => !a.done).map((a) => ({
      id: a.id, source: "STATUS" as const, title: a.description, projectId: project.id, projectName: project.name, engagementId: r.engagementId, engagementName: engNameOf(r.engagementId),
      owner: a.owner, ownerUserId: a.ownerUserId, dueDate: iso(a.dueDate), createdAt: a.createdAt.toISOString(), status: `Status ${iso(r.reportDate)}`, critical: a.critical,
    }))),
    ...project.planTasks.filter(inEng).filter((t) => !t.isMilestone && t.status !== "COMPLETED" && t.progress < 100).map((t) => ({
      id: t.id, source: "PLAN" as const, title: t.name, projectId: project.id, projectName: project.name, engagementId: t.engagementId, engagementName: engNameOf(t.engagementId),
      owner: t.owner, ownerUserId: t.ownerUserId, dueDate: iso(t.dueDate), createdAt: t.createdAt.toISOString(), status: t.status === "BLOCKED" ? "Blocked" : `${t.progress}%`, critical: t.status === "BLOCKED",
    })),
  ];
  const openActions = enrichAll(scopeActions, new Date().toISOString().slice(0, 10));
  const overdueActionsCount = openActions.filter((a) => a.isOverdue).length;
  const planDone = plan.filter((t) => t.status === "COMPLETED").length;
  const engName = project.engagements.find((e) => e.id === selectedEng)?.name ?? null;

  // ---- workspace health + "needs attention" (same lightweight checks as My Day, scoped here) ----
  const todayIso = new Date().toISOString().slice(0, 10);
  const activeProj = project.status === "ACTIVE";
  const projectDone = project.status === "COMPLETED" || project.status === "CANCELLED";
  const selectedEngRow = project.engagements.find((e) => e.id === selectedEng) ?? null;
  // A closed project is done everywhere; an end customer can be done on its own while the
  // umbrella project stays open. Done ⇒ no health colour, no nudges, no banners.
  const done = projectDone || selectedEngRow?.status === "COMPLETED";
  const doneLabel = project.status === "CANCELLED" ? "Cancelled" : "Completed";
  // The "Overall" scope of a programme is only chased when the PM opted in (trackOverallStatus).
  const customerFacing = selectedEng !== null || project.engagements.length === 0 || project.trackOverallStatus;
  const latest = reports[0] ?? null;
  const tracking: "TRACKED" | "ADHOC" | "OFF" = !customerFacing ? "OFF" : latest?.cadence === "ADHOC" ? "ADHOC" : "TRACKED";

  // A task is "done" if marked COMPLETED or at 100% (progress drives status).
  const planDoneT = (t: (typeof plan)[number]) => t.status === "COMPLETED" || t.progress >= 100;
  const overdueIssues = openRaidList.filter((r) => r.dueDate != null && r.dueDate < todayIso);
  const overduePlan = plan.filter((t) => !t.isMilestone && !planDoneT(t) && t.dueDate != null && t.dueDate < todayIso);
  const upcomingPlan = plan
    .filter((t) => !planDoneT(t) && t.dueDate != null && t.dueDate >= todayIso)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, 5);
  const overdueActions = minutes.flatMap((m) => m.actions).filter((a) => !a.done && a.dueDate != null && a.dueDate < todayIso);

  const lastDays = latest ? differenceInCalendarDays(new Date(todayIso), new Date(latest.reportDate)) : null;
  const cad = cadenceDays(latest?.cadence);
  const statusDue = !done && customerFacing && activeProj && (lastDays === null || (cad !== null && lastDays > cad));

  // Health = the worst of the report's dimensions when they differ from the overall (a green overall
  // with a red budget is not green).
  let rag: RagStatus = latest ? worstRag(latest.overallRag, latest.scheduleRag, latest.budgetRag, latest.scopeRag) : activeProj && customerFacing ? "AMBER" : "GREEN";
  if (overdueIssues.some((r) => r.severity === "HIGH" || r.severity === "CRITICAL")) rag = "RED";

  const attention: string[] = [];
  if (done) { /* nothing to chase on a finished workspace */ }
  else if (statusDue) attention.push(lastDays === null ? "No status update yet" : "Status update due");
  if (!done && overduePlan.length) attention.push(`${overduePlan.length} plan task${overduePlan.length === 1 ? "" : "s"} overdue`);
  if (!done && overdueIssues.length) attention.push(`${overdueIssues.length} issue${overdueIssues.length === 1 ? "" : "s"} past due`);
  if (!done && overdueActions.length) attention.push(`${overdueActions.length} action${overdueActions.length === 1 ? "" : "s"} overdue`);

  // ---- Cutover readiness: once UAT is accepted (or go-live is near), the cutover to production must
  // be completed. Surface it here so PM/Admin can push the consultant who owns the go-live. ----
  // Plans and scripts are per end customer: "Overall" sees every one, an end customer sees its own.
  const scopedPlans = project.cutoverPlans.filter((p) => selectedEng === null || p.engagementId === selectedEng);
  const scopedScripts = project.uatScripts.filter((s) => selectedEng === null || s.engagementId === selectedEng);
  const engQs = selectedEng ? `?eng=${selectedEng}` : "";
  const cutover = scopedPlans.flatMap((p) => p.tasks);
  const cutoverLeaves = cutover.filter((t) => !cutover.some((c) => c.parentId === t.id));
  const cutoverDoneCount = cutoverLeaves.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
  const cutoverComplete = cutoverLeaves.length > 0 && cutoverDoneCount === cutoverLeaves.length;
  const goLiveIso = iso(project.endDate);
  const daysToGoLive = goLiveIso ? differenceInCalendarDays(new Date(goLiveIso), new Date(todayIso)) : null;
  const goLiveNear = daysToGoLive != null && daysToGoLive <= 14;
  // Trigger after UAT acceptance, or when go-live is within two weeks — and the cutover isn't finished.
  const cutoverDue = !done && !cutoverComplete && (project.uatAccepted || (activeProj && goLiveNear));
  const cutoverUrgent = cutoverDue && daysToGoLive != null && daysToGoLive <= 3;
  const cutoverReason = project.uatAccepted
    ? "UAT is accepted — the project is ready for go-live."
    : daysToGoLive != null && daysToGoLive >= 0
      ? `Go-live is ${daysToGoLive === 0 ? "today" : `in ${daysToGoLive} day${daysToGoLive === 1 ? "" : "s"}`}.`
      : "Go-live date has passed.";
  const cutoverProgress =
    cutoverLeaves.length > 0 ? `${cutoverDoneCount}/${cutoverLeaves.length} cutover steps done` : "No cutover plan created yet";

  // ---- UAT test-script readiness: the consultant must prepare & send the test script before UAT.
  // Surface it so the PM can check it actually reached "Sent". ----
  const uatWindow = project.uatStatus !== "NOT_STARTED" || (activeProj && daysToGoLive != null && daysToGoLive >= 0 && daysToGoLive <= 30);
  const uatScriptDue = !done && activeProj && uatWindow && (scopedScripts.length === 0 || scopedScripts.some((s) => s.status !== "SENT"));
  const uatScriptReason = project.uatStatus !== "NOT_STARTED"
    ? "UAT is under way, but the test script isn't marked sent to the customer."
    : "UAT is coming up — the customer test script must be prepared and sent first.";
  const uatCaseCount = scopedScripts.reduce((s, x) => s + x._count.cases, 0);
  const uatCaseInfo = scopedScripts.length === 0 ? "no test script yet" : `${scopedScripts.length} script${scopedScripts.length === 1 ? "" : "s"}, ${uatCaseCount} test case${uatCaseCount === 1 ? "" : "s"}`;

  const tHref = (t: string) => {
    const p = new URLSearchParams();
    if (selectedEng) p.set("eng", selectedEng);
    p.set("tab", t);
    if (fromPortfolio) p.set("from", "portfolio"); // keep the "← Portfolio" back link while moving around
    return `/delivery/${project.id}?${p.toString()}`;
  };

  const overview = (
    <div className="flex flex-col gap-4">
      {/* hero: health + progress + latest status one-liner */}
      <div className="flex flex-wrap items-center gap-5 rounded-lg border bg-card p-5 shadow-sm">
        {(() => {
          const pctVal = latest?.progressPercent ?? 0;
          const rr = 20, cc = 2 * Math.PI * rr, oo = cc * (1 - Math.max(0, Math.min(100, pctVal)) / 100);
          const strokeCls = rag === "RED" ? "stroke-rose-500" : rag === "AMBER" ? "stroke-amber-500" : "stroke-emerald-500";
          return (
            <div className="relative size-16 shrink-0">
              <svg viewBox="0 0 52 52" className="size-16 -rotate-90">
                <circle cx="26" cy="26" r={rr} fill="none" strokeWidth="5" className="stroke-muted" />
                <circle cx="26" cy="26" r={rr} fill="none" strokeWidth="5" strokeLinecap="round" className={strokeCls} strokeDasharray={cc} strokeDashoffset={oo} />
              </svg>
              <span className="absolute inset-0 grid place-items-center font-mono text-sm font-bold">{pctVal}%</span>
            </div>
          );
        })()}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {done
              ? <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"><CheckCircle2Icon className="size-3.5" />{doneLabel}</span>
              : <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", RAG_PILL[rag])}><span className={cn("size-2 rounded-full", RAG_DOT[rag])} />{RAG_LABEL[rag]}</span>}
            <span className="text-xs text-muted-foreground">{latest ? `${latest.sentAt ? "Last sent" : "Draft"} ${format(new Date(latest.reportDate), "MMM d")}` : "No status update yet"}</span>
            {!done && tracking === "ADHOC" && <span className="rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Cadence is ad-hoc: status updates are never chased">Ad-hoc — not tracked</span>}
            {!done && tracking === "OFF" && <span className="rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground" title="Programme level is not tracked — switch it on under Manage end customers">Programme level — not tracked</span>}
            <span className="text-xs text-muted-foreground">· {plan.length > 0 ? `${planDone}/${plan.length} plan tasks done` : "no plan yet"}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{latest?.summary?.trim() || (statusDue ? "This customer is due a status update — send one so everyone can see where things stand." : "—")}</p>
        </div>
        <LinkButton href={tHref("status")} size="sm">{latest ? "Build new update" : "Build first update"}</LinkButton>
      </div>

      {/* open actions in scope, worst-overdue first */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ListChecksIcon className="size-4 text-muted-foreground" /> Actions
            <span className="font-normal text-muted-foreground">({openActions.length} open{overdueActionsCount > 0 ? <span className="text-rose-600">, {overdueActionsCount} overdue</span> : null})</span>
          </CardTitle>
          <Link href={`/actions?project=${project.id}`} className="text-xs font-medium text-primary hover:underline">Register →</Link>
        </CardHeader>
        <CardContent className="pt-1">
          {openActions.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing open — plan tasks, issues, status and meeting actions all clear.</p>
          ) : (
            <div className="flex flex-col">
              {openActions.slice(0, 6).map((a) => (
                <div key={`${a.source}:${a.id}`} className="flex items-center gap-2.5 border-b py-2 last:border-none">
                  <span className="w-24 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{ACTION_SOURCE_LABEL[a.source].replace(" / RAID", "")}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.owner ?? <span className="text-amber-600">unassigned</span>}</span>
                  <span className={cn("w-16 shrink-0 text-right font-mono text-xs", a.isOverdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{a.dueDate ? format(new Date(a.dueDate), "MMM d") : "—"}</span>
                </div>
              ))}
              {openActions.length > 6 && <p className="pt-2 text-xs text-muted-foreground">+ {openActions.length - 6} more in the register.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* next up + recent meetings */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* next up */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2"><CalendarIcon className="size-4 text-muted-foreground" /> Next up</CardTitle>
            <Link href={tHref("plan")} className="text-xs font-medium text-primary hover:underline">Plan →</Link>
          </CardHeader>
          <CardContent className="pt-1">
            {overduePlan.length === 0 && upcomingPlan.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No dated plan tasks.</p>
            ) : (
              <div className="flex flex-col">
                {overduePlan.slice(0, 3).map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 border-b py-2 last:border-none">
                    {t.isMilestone ? <DiamondIcon className="size-3.5 shrink-0 text-rose-500" /> : <span className="size-1.5 shrink-0 rounded-full bg-rose-500" />}
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <span className="shrink-0 font-mono text-xs text-rose-600 dark:text-rose-400">{t.dueDate ? format(new Date(t.dueDate), "MMM d") : ""}</span>
                  </div>
                ))}
                {upcomingPlan.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 border-b py-2 last:border-none">
                    {t.isMilestone ? <DiamondIcon className="size-3.5 shrink-0 text-primary" /> : <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />}
                    <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.dueDate ? format(new Date(t.dueDate), "MMM d") : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* recent meetings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2"><MessageSquareIcon className="size-4 text-muted-foreground" /> Recent meetings</CardTitle>
            <Link href={tHref("minutes")} className="text-xs font-medium text-primary hover:underline">All →</Link>
          </CardHeader>
          <CardContent className="pt-1">
            {minutes.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No meetings logged yet.</p>
            ) : (
              minutes.slice(0, 3).map((m) => {
                const open = m.actions.filter((a) => !a.done).length;
                return (
                  <div key={m.id} className="flex items-center gap-2.5 border-b py-2 last:border-none">
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{format(new Date(m.date), "MMM d")}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{open > 0 ? <span className="text-amber-600 dark:text-amber-400">{open} open</span> : `${m.actions.length} action${m.actions.length === 1 ? "" : "s"}`}</span>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // Lean sections built around a junior PM's real jobs — status, plan, issues, meetings/docs — with
  // an Overview that surfaces the important bits. "Issues" is the RAID log; My Day's issue nudges
  // deep-link to it (tab: "raid"), so it must exist as a tab. The count is what is still open.
  const tabs: CockpitTab[] = [
    { value: "overview", label: "Overview", content: overview },
    { value: "status", label: `Status updates (${reports.length})`, content: <StatusReportsClient projectId={project.id} engagementId={selectedEng} reports={reports} people={staff} planProgress={plan.length ? phaseProgress(plan) : null} /> },
    { value: "plan", label: `Plan (${plan.length})`, content: <PlanClient projectId={project.id} engagementId={selectedEng} tasks={plan} people={staff} /> },
    { value: "raid", label: `Issues (${openRaidList.length})`, content: <RaidClient projectId={project.id} engagementId={selectedEng} items={raid} people={staff} /> },
    { value: "minutes", label: `Minutes (${minutes.length})`, content: <MinutesClient projectId={project.id} engagementId={selectedEng} items={minutes} people={staff} /> },
    { value: "documents", label: `Documents (${docs.length})`, content: <DocumentsLibraryClient projectId={project.id} engagementId={selectedEng} docs={docs} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">{fromPortfolio ? "← Portfolio" : "← Delivery"}</Link>
        <div className="mt-1 flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={engName ?? project.client.name} className="size-11 text-sm" />
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-semibold">{engName ?? project.name}</h1>
                {done
                  ? <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"><CheckCircle2Icon className="size-3.5" />{doneLabel}</span>
                  : <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", RAG_PILL[rag])}><span className={cn("size-2 rounded-full", RAG_DOT[rag])} />{RAG_LABEL[rag]}</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {engName && <span className="font-medium text-foreground">{project.name}</span>}
                {engName && " · "}
                {project.number && <span className="font-mono text-foreground">{project.number}</span>}
                {project.number && " · "}
                {project.client.name} · PM {project.manager?.name ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton href={`/delivery/${project.id}/uat${engQs}`} variant="outline" size="sm">UAT scripts</LinkButton>
            <LinkButton href={`/delivery/${project.id}/cutover${engQs}`} variant="outline" size="sm">Cutover plans</LinkButton>
            <LinkButton href={`/projects/${project.id}`} variant="outline" size="sm">Open project</LinkButton>
          </div>
        </div>
      </div>

      <EngagementBar
        projectId={project.id}
        engagements={project.engagements.map((e) => ({ id: e.id, name: e.name, status: e.status, members: e.members.map((m) => m.user) }))}
        staff={staff}
        selectedId={selectedEng}
        keepParams={fromPortfolio ? { from: "portfolio" } : undefined}
        trackOverall={project.trackOverallStatus}
      />

      {uatScriptDue && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/45 bg-amber-500/[0.07] px-4 py-3">
          <ClipboardCheckIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">UAT test script not sent yet</div>
            <div className="text-xs text-muted-foreground">{uatScriptReason} Currently {uatCaseInfo}. The consultant prepares it — check it&apos;s ready and sent.</div>
          </div>
          <LinkButton href={`/delivery/${project.id}/uat${engQs}`} size="sm">Open UAT scripts</LinkButton>
        </div>
      )}

      {cutoverDue && (
        <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3", cutoverUrgent ? "border-rose-500/45 bg-rose-500/[0.07]" : "border-amber-500/45 bg-amber-500/[0.07]")}>
          <RocketIcon className={cn("size-5 shrink-0", cutoverUrgent ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")} />
          <div className="min-w-0 flex-1">
            <div className={cn("text-sm font-semibold", cutoverUrgent ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400")}>
              Cutover to production still to be done
            </div>
            <div className="text-xs text-muted-foreground">{cutoverReason} {cutoverProgress}. The assigned consultant runs the cutover — chase it if needed.</div>
          </div>
          <LinkButton href={`/delivery/${project.id}/cutover${engQs}`} size="sm">Open cutover plans</LinkButton>
        </div>
      )}

      {attention.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-3.5 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400"><TriangleAlertIcon className="size-4" /> Needs attention</span>
          {attention.map((a) => <span key={a} className="rounded-full border bg-background px-2.5 py-0.5 text-xs">{a}</span>)}
        </div>
      )}

      <CockpitShell tabs={tabs} initial={activeTab} />
    </div>
  );
}
