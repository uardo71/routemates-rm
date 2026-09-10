"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  TriangleAlertIcon, CalendarClockIcon, CheckCircle2Icon,
  FileTextIcon, CalendarIcon, AlertCircleIcon, ClipboardListIcon, MessageSquareIcon,
  ArrowRightIcon, LightbulbIcon, CheckIcon, RocketIcon, ClipboardCheckIcon, LayoutListIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GuideHelp } from "@/components/guide-help";
import type { Guide } from "@/lib/guides-server";
import { cn } from "@/lib/utils";
import {
  DAY_GROUP, DAY_GROUP_ORDER,
  type DayItem, type DayItemKind, type DayPriority, type DayStats, type UpcomingItem, type DayGroupKey,
} from "@/lib/delivery-day";

const KIND_ICON: Record<DayItemKind, typeof FileTextIcon> = {
  UAT_SCRIPT_DUE: ClipboardCheckIcon, CUTOVER_DUE: RocketIcon, NO_STATUS: FileTextIcon, STATUS_DUE: FileTextIcon, PLAN_OVERDUE: ClipboardListIcon,
  ISSUE_DUE: AlertCircleIcon, ISSUE_OPEN: TriangleAlertIcon, ACTION_OVERDUE: MessageSquareIcon,
};
const GROUP_ICON: Record<DayGroupKey, typeof FileTextIcon> = {
  golive: RocketIcon, status: FileTextIcon, issues: AlertCircleIcon, plan: ClipboardListIcon, meetings: MessageSquareIcon,
};
const GROUP_LABEL: Record<DayGroupKey, string> = {
  golive: "Go-live & UAT", status: "Status updates", issues: "Issues to handle", plan: "Plan slipping", meetings: "Meeting actions",
};
// Which coaching guide opens when Enida clicks "How?" on a group of the day.
const GROUP_GUIDE_CAT: Record<DayGroupKey, string> = {
  golive: "golive", status: "status", issues: "escalation", plan: "slipping_date", meetings: "general",
};
const PRIO: Record<DayPriority, { dot: string; chip: string; label: string }> = {
  CRIT: { dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-600 dark:text-rose-400", label: "Overdue" },
  WARN: { dot: "bg-amber-500", chip: "bg-amber-500/12 text-amber-600 dark:text-amber-400", label: "Due soon" },
  INFO: { dot: "bg-slate-400", chip: "bg-slate-400/14 text-slate-600 dark:text-slate-300", label: "Watch" },
};

function wsHref(projectId: string, engagementId: string | null, tab?: string) {
  const params = new URLSearchParams();
  if (engagementId) params.set("eng", engagementId);
  if (tab) params.set("tab", tab);
  const q = params.toString();
  return `/delivery/${projectId}${q ? `?${q}` : ""}`;
}

// "My Day" only — the customer portfolio has its own page at /portfolio (and its own nav entry),
// so it's no longer tucked behind a view toggle here.
export function DeliveryHomeClient({
  greeting, firstName, todayLabel, isAdmin, dayItems, stats, upcoming, guides,
}: {
  greeting: string; firstName: string; todayLabel: string; isAdmin: boolean;
  dayItems: DayItem[]; stats: DayStats; upcoming: UpcomingItem[]; guides: Guide[];
}) {
  const [done, setDone] = useState<Set<string>>(new Set());

  // Per-day "ticked off" state, kept in the browser so the progress feels tracked without a DB write.
  const dayKey = todayLabel; // stable per render/day
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`rm.delivery.done.${dayKey}`);
      // Hydrate the "ticked off today" set from the browser after mount (client-only; avoids an SSR
      // mismatch). Intentional setState-in-effect — same pattern as sidebar-shell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDone(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, [dayKey]);
  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(`rm.delivery.done.${dayKey}`, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const groups = DAY_GROUP_ORDER
    .map((key) => ({ key, label: GROUP_LABEL[key], items: dayItems.filter((it) => DAY_GROUP[it.kind].key === key) }))
    .filter((g) => g.items.length > 0);
  const doneCount = dayItems.filter((it) => done.has(it.id)).length;
  const pct = dayItems.length > 0 ? Math.round((doneCount / dayItems.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}, {firstName} 👋</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{isAdmin ? "Delivery across all projects — work top to bottom." : "Your path for today — work top to bottom."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-muted-foreground">{todayLabel}</span>
          <Link href="/portfolio" className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary">
            <LayoutListIcon className="size-3.5" /> Portfolio <ArrowRightIcon className="size-3" />
          </Link>
          <GuideHelp guides={guides} />
        </div>
      </div>

      {/* progress + stats */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-medium">Today</div>
          <div className="font-mono text-sm text-muted-foreground"><span className="font-semibold text-foreground">{doneCount}</span> of {dayItems.length} done</div>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" /> {stats.overdue} overdue</span>
          <span className="inline-flex items-center gap-1.5"><CalendarClockIcon className="size-3.5" /> {stats.dueThisWeek} due this week</span>
          <span className="inline-flex items-center gap-1.5"><TriangleAlertIcon className="size-3.5" /> {stats.openIssues} open issues</span>
        </div>
      </div>

      {/* grouped path */}
      {dayItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2Icon className="size-8 text-emerald-500" />
            <p className="font-medium">You&apos;re all caught up.</p>
            <p className="text-sm text-muted-foreground">No status updates due, no overdue tasks or issues across your workspaces.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => {
            const GIcon = GROUP_ICON[g.key];
            const remaining = g.items.filter((it) => !done.has(it.id)).length;
            return (
              <div key={g.key}>
                <div className="mb-2 flex items-center gap-2 px-0.5">
                  <GIcon className="size-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">{g.label}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{remaining || "✓"}</span>
                  <div className="ml-auto">
                    <GuideHelp guides={guides} triggerLabel="How?" initialCategory={GROUP_GUIDE_CAT[g.key]} triggerClassName="h-7 px-2 text-xs text-muted-foreground" />
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  {g.items.map((it) => {
                    const isDone = done.has(it.id);
                    const p = PRIO[it.priority];
                    const Icon = KIND_ICON[it.kind];
                    return (
                      <div key={it.id} className={cn("group flex items-center gap-3 border-b px-3.5 py-2.5 last:border-none transition-colors", isDone ? "bg-muted/30" : "hover:bg-muted/30")}>
                        <button onClick={() => toggle(it.id)} aria-label={isDone ? "Mark not done" : "Mark done"} className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2 transition", isDone ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 text-transparent hover:border-emerald-500")}>
                          <CheckIcon className="size-3" strokeWidth={3} />
                        </button>
                        <Icon className={cn("size-4 shrink-0", isDone ? "text-muted-foreground/50" : "text-muted-foreground")} />
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-sm font-medium", isDone && "text-muted-foreground line-through")}>{it.title}</div>
                          <div className="truncate text-xs text-muted-foreground">{it.context}</div>
                        </div>
                        {!isDone && it.priority !== "INFO" && (
                          <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline", p.chip)}>{p.label}</span>
                        )}
                        <span className="hidden shrink-0 text-muted-foreground/60 hover:text-primary sm:inline" title={it.how}><LightbulbIcon className="size-4" /></span>
                        {!isDone && (
                          <Link href={it.href ?? wsHref(it.projectId, it.engagementId, it.tab)} className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary">
                            {it.cta} <ArrowRightIcon className="size-3" />
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* coming up */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><CalendarIcon className="size-4 text-muted-foreground" /> Coming up this week</CardTitle></CardHeader>
          <CardContent className="pt-1">
            {upcoming.map((u) => (
              <Link key={u.id} href={wsHref(u.projectId, u.engagementId, u.tab)} className="-mx-2 flex items-center gap-3 rounded-sm border-b px-2 py-2.5 last:border-none hover:bg-muted/30">
                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{u.dateLabel}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{u.title}</div><div className="truncate text-xs text-muted-foreground">{u.context}</div></div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{u.tag}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{u.daysAway === 0 ? "today" : u.daysAway === 1 ? "tomorrow" : `in ${u.daysAway}d`}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
