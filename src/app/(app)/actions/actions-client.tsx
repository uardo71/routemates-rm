"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListChecksIcon, DownloadIcon, CheckIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, ArrowRightIcon, AlertTriangleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ACTION_SOURCES, ACTION_SOURCE_LABEL, actionKey, attentionActions, filterActions, groupByClient, isTicket,
  sortActions, summarizeActions, type ActionSource, type ActionView, type EnrichedAction,
} from "@/lib/actions-register";
import { SlaKindBadge } from "../tickets/sla";
import { saveActionChangesAction } from "./actions";

// The cross-project actions register, grouped by CLIENT.
//
// Client is the primary grouping, not project: the same generic project name sits under several
// unrelated accounts, so a project heading read as one thing when it was three. Inside a client the
// engagement / project is the sub-heading.
//
// Two rules govern the right-hand control, and they are the whole point of the redesign:
//   * routine work (an ordinary status action, plan task or meeting action) still completes with one
//     tick, staged and saved in a batch exactly as before;
//   * a CRITICAL item, and EVERY support ticket, has no tick at all — it links out to the record
//     that owns it. A ticket in particular must never be closeable from an aggregated list: its
//     stage gates and Save flow are what resolve it.

const SOURCE_TONE: Record<ActionSource, string> = {
  RAID: "bg-danger-soft text-destructive",
  MEETING: "bg-primary/10 text-primary",
  STATUS: "bg-warning-soft text-warning",
  PLAN: "bg-accent text-accent-foreground",
  TICKET: "bg-success-soft text-success",
};
const VIEWS: { key: ActionView; label: string }[] = [{ key: "open", label: "Open" }, { key: "completed", label: "Completed" }, { key: "all", label: "All" }];
const control = "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ActionsRegisterClient({ actions, projects, userId, mineOnly, isAdmin, canManage }: {
  actions: EnrichedAction[]; projects: { id: string; name: string }[]; userId: string; mineOnly: boolean; isAdmin: boolean; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [view, setView] = useState<ActionView>("open");
  const [mine, setMine] = useState(mineOnly);
  const [unassigned, setUnassigned] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [source, setSource] = useState<"" | ActionSource>("");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Ticks are staged until Save: action key → the done state it will be saved as.
  const [staged, setStaged] = useState<Map<string, boolean>>(new Map());
  // Completed during this visit: stays in the Open view, crossed out, until the page is left.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const byKey = useMemo(() => new Map(actions.map((a) => [actionKey(a), a])), [actions]);
  const isDone = (a: EnrichedAction) => { const k = actionKey(a); return staged.has(k) ? staged.get(k)! : !!a.done; };

  const rows = useMemo(() => {
    const keep = new Set([...pinned, ...staged.keys()]);
    const f = filterActions(actions, { view, pinned: keep, mineUserId: mine ? userId : null, unassigned, overdue, projectId: projectId || null, source: source || null, q });
    return sortActions(f, "worst", "asc");
  }, [actions, view, pinned, staged, mine, unassigned, overdue, projectId, source, q, userId]);

  const groups = useMemo(() => groupByClient(rows), [rows]);
  const attention = useMemo(() => attentionActions(rows), [rows]);
  const totals = useMemo(() => summarizeActions(actions), [actions]);
  const mineCount = useMemo(() => actions.filter((a) => !a.done && a.ownerUserId === userId).length, [actions, userId]);
  const ticketCount = useMemo(() => actions.filter((a) => !a.done && isTicket(a.source)).length, [actions]);

  const toComplete = [...staged.values()].filter(Boolean).length;
  const toReopen = staged.size - toComplete;

  // Leaving with unsaved ticks asks first.
  useEffect(() => {
    if (staged.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [staged.size]);

  function toggle(a: EnrichedAction) {
    const k = actionKey(a);
    const want = !isDone(a);
    setStaged((s) => { const n = new Map(s); if (want === !!a.done) n.delete(k); else n.set(k, want); return n; });
  }
  function discard() { setStaged(new Map()); }
  function save() {
    const changes = [...staged].flatMap(([k, done]) => {
      const a = byKey.get(k);
      // Belt and braces: a ticket can never reach the server action from here.
      return a && !isTicket(a.source) ? [{ source: a.source as Exclude<ActionSource, "TICKET">, id: a.id, done }] : [];
    });
    if (changes.length === 0) return;
    start(async () => {
      const r = await saveActionChangesAction({ changes });
      if (r.error) { toast.error(r.error); return; }
      setPinned((p) => { const n = new Set(p); for (const [k, done] of staged) if (done) n.add(k); return n; });
      setStaged(new Map());
      toast.success(`Saved ${changes.length} change${changes.length === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  const exportQs = new URLSearchParams();
  exportQs.set("view", view);
  if (mine) exportQs.set("mine", "1"); if (unassigned) exportQs.set("unassigned", "1"); if (overdue) exportQs.set("overdue", "1");
  if (projectId) exportQs.set("project", projectId); if (source) exportQs.set("source", source); if (q.trim()) exportQs.set("q", q.trim());

  const subtitle = mineOnly
    ? "Everything waiting on you, across every client — plan tasks, issues, status and meeting actions, and the support tickets that need you now."
    : isAdmin
      ? "Every action across every client — plan tasks, issues, status and meeting actions, and the support tickets that need someone now."
      : "Every action across the clients you manage, plus the support tickets that need someone now.";

  return (
    <div className="flex flex-col gap-5 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ListChecksIcon className="size-5 text-muted-foreground" /> Actions</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" render={<a href={`/api/actions/export?${exportQs.toString()}`} />}><DownloadIcon className="size-4" /> Export XLSX</Button>
      </div>

      {/* Needs attention — overdue, critical or urgent, across every client. */}
      {attention.length > 0 && (
        <Card className="border-destructive/30">
          <CardContent className="px-0 py-0">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
              <AlertTriangleIcon className="size-4 text-destructive" />
              Needs attention
              <span className="font-normal text-muted-foreground">— overdue, critical or breached, across every client</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{attention.length}</span>
            </div>
            {attention.slice(0, 8).map((a) => (
              <div key={actionKey(a)} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto_auto] items-center gap-3 border-b px-4 py-2 last:border-none">
                <span className="truncate text-xs font-semibold" title={a.clientName ?? "No client"}>{a.clientName ?? "No client"}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <TypePill a={a} />
                  <span className="truncate text-sm">{a.title}</span>
                  {a.critical && <CriticalBadge />}
                </span>
                <DueCell a={a} />
                <ResolveLink a={a} />
              </div>
            ))}
            {attention.length > 8 && (
              <div className="px-4 py-2 text-xs text-muted-foreground">and {attention.length - 8} more below.</div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="Which actions">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
              className={cn("rounded-full px-3 py-1 font-medium", view === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {v.label} <span className="font-mono text-muted-foreground">{v.key === "open" ? totals.total : v.key === "completed" ? totals.completed : actions.length}</span>
            </button>
          ))}
        </div>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {!mineOnly && <Chip active={mine} onClick={() => setMine((v) => !v)}>Mine <span className="font-mono">{mineCount}</span></Chip>}
        {view !== "completed" && <Chip active={unassigned} onClick={() => setUnassigned((v) => !v)}>Unassigned <span className="font-mono">{totals.unassigned}</span></Chip>}
        {view !== "completed" && <Chip active={overdue} onClick={() => setOverdue((v) => !v)}><span className="size-2 rounded-full bg-destructive" /> Overdue <span className="font-mono">{totals.overdue}</span></Chip>}
        {ticketCount > 0 && (
          <Chip active={source === "TICKET"} onClick={() => setSource((s) => (s === "TICKET" ? "" : "TICKET"))}>Tickets <span className="font-mono">{ticketCount}</span></Chip>
        )}
        {!mineOnly && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={cn(control, "h-8 text-xs")}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={source} onChange={(e) => setSource(e.target.value as "" | ActionSource)} className={cn(control, "h-8 text-xs")}>
          <option value="">All types</option>
          {ACTION_SOURCES.map((s) => <option key={s} value={s}>{ACTION_SOURCE_LABEL[s]}</option>)}
        </select>
        <div className="relative ml-auto">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions…" className="h-8 w-56 pl-8" />
        </div>
      </div>

      {groups.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          {view === "completed" ? "Nothing completed yet." : view === "open" && totals.total === 0 ? "Nothing open. Enjoy it." : "Nothing matches these filters."}
        </CardContent></Card>
      )}

      {groups.map((g) => {
        const key = g.clientId || "none";
        const open = !collapsed.has(key);
        const engagements = new Set(g.subGroups.map((s) => s.label)).size;
        return (
          <Card key={key} className="overflow-hidden">
            <CardContent className="px-0 py-0">
              <button
                type="button"
                onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                className="flex w-full items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-left hover:bg-muted/50"
              >
                {open ? <ChevronDownIcon className="size-4 text-muted-foreground" /> : <ChevronRightIcon className="size-4 text-muted-foreground" />}
                <span className="font-semibold">{g.clientName}</span>
                <span className="text-xs text-muted-foreground">
                  {g.openCount} open{g.actions.length > g.openCount ? ` · ${g.actions.length - g.openCount} done` : ""}
                  {engagements > 1 ? ` · ${engagements} engagements` : ""}
                </span>
              </button>

              {open && g.subGroups.map((sub) => (
                <div key={sub.key}>
                  <div className="border-b bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground">{sub.label}</div>
                  {sub.actions.map((a) => {
                    const k = actionKey(a);
                    const done = isDone(a);
                    const changed = staged.has(k);
                    const mayClose = canManage || a.ownerUserId === userId;
                    return (
                      <div
                        key={k}
                        className={cn(
                          "grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,10rem)_6.5rem_7rem] items-center gap-3 border-b px-4 py-2.5 last:border-none",
                          done && "bg-muted/30",
                          changed && "bg-warning-soft/50",
                        )}
                      >
                        <TypePill a={a} done={done} />

                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Link href={a.href} className={cn("truncate text-sm font-medium hover:underline", done && "text-muted-foreground line-through decoration-muted-foreground/60")}>
                              {a.ref ? <span className="mr-1.5 font-mono text-xs text-muted-foreground">{a.ref}</span> : null}
                              {a.title}
                            </Link>
                            {a.critical && !done && <CriticalBadge />}
                          </div>
                          <StateCell a={a} done={done} />
                        </div>

                        <span className={cn("truncate text-sm", done && "text-muted-foreground")}>
                          {a.owner ? <span className={cn(!done && a.ownerUserId === userId && "font-medium")}>{a.owner}</span> : <span className="text-xs text-warning">unassigned</span>}
                        </span>

                        <DueCell a={a} done={done} />

                        <div className="flex justify-end">
                          {changed ? (
                            <span className="text-[11px] font-medium text-warning">{done ? "will complete" : "will reopen"}</span>
                          ) : a.completableHere ? (
                            <button
                              type="button" disabled={pending || !mayClose} onClick={() => toggle(a)} aria-pressed={done}
                              title={!mayClose ? "Only the owner or the project manager can change this" : done ? "Completed — click to reopen" : "Mark completed (saved when you click Save)"}
                              className={cn("grid size-5 place-items-center rounded-full border-2 transition disabled:opacity-40",
                                done ? "border-success bg-success text-white" : "border-muted-foreground/30 text-transparent hover:border-success hover:text-success")}
                            ><CheckIcon className="size-3" /></button>
                          ) : (
                            <ResolveLink a={a} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">
        Tick a routine action to complete it, then Save — issue → Closed, meeting and status actions → done, plan task → 100%.
        Critical items open at their source instead, and a <strong>support ticket is never closed from here</strong>: open it and let its own
        stage gates and Save decide.
      </p>

      {staged.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-lg border bg-background px-4 py-2.5 shadow-lg">
            <span className="text-sm"><span className="font-semibold">{staged.size}</span> unsaved change{staged.size === 1 ? "" : "s"}</span>
            <span className="text-xs text-muted-foreground">
              {toComplete > 0 && `${toComplete} to complete`}{toComplete > 0 && toReopen > 0 && " · "}{toReopen > 0 && `${toReopen} to reopen`}
            </span>
            <Button size="sm" variant="outline" onClick={discard} disabled={pending}>Discard</Button>
            <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TypePill({ a, done }: { a: EnrichedAction; done?: boolean }) {
  return (
    <span className={cn("w-fit rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", SOURCE_TONE[a.source], done && "opacity-60")}>
      {ACTION_SOURCE_LABEL[a.source]}
    </span>
  );
}

function CriticalBadge() {
  return <span className="rounded-full bg-destructive px-1.5 py-px text-[10px] font-bold tracking-wide text-white uppercase">critical</span>;
}

/** The old single "Status" column meant four different things at once. Each type now says the one
 *  thing that is true of it: a plan task's real progress, an issue's state, where a status or
 *  meeting action came from, and for a ticket the very badge Support draws. */
function StateCell({ a, done }: { a: EnrichedAction; done: boolean }) {
  if (done) {
    return (
      <div className="mt-0.5 text-[11px] text-success">
        Completed{a.completedAt ? ` ${a.completedAt.slice(0, 10)}` : ""}{a.completedBy ? <span className="text-muted-foreground"> · {a.completedBy}</span> : null}
      </div>
    );
  }
  if (a.source === "PLAN" && a.progress != null) {
    return (
      <div className="mt-1 flex items-center gap-2">
        <span className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, a.progress))}%` }} />
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">{a.progress}%</span>
      </div>
    );
  }
  if (a.source === "TICKET") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {a.slaKind ? <SlaKindBadge kind={a.slaKind} detail={a.slaDetail ?? ""} /> : null}
        {a.stageName ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
            {a.stageName}
            {a.gatesWaiting ? <span className="font-normal opacity-80">· {a.gatesWaiting} gate{a.gatesWaiting === 1 ? "" : "s"} waiting</span> : null}
          </span>
        ) : null}
      </div>
    );
  }
  return <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{a.status}</div>;
}

function DueCell({ a, done }: { a: EnrichedAction; done?: boolean }) {
  if (!a.dueDate) return <span className="text-right text-xs text-muted-foreground">—</span>;
  return (
    <span className="text-right whitespace-nowrap">
      <span className={cn("font-mono text-xs", done ? "text-muted-foreground" : a.isOverdue ? "font-semibold text-destructive" : "")}>{a.dueDate}</span>
      {!done && a.isOverdue && <span className="block text-[11px] text-destructive">{a.overdueDays}d late</span>}
      {!done && a.overdueDays === 0 && <span className="block text-[11px] text-warning">today</span>}
    </span>
  );
}

function ResolveLink({ a }: { a: EnrichedAction }) {
  return (
    <Link href={a.href} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline">
      {isTicket(a.source) ? "Open ticket" : "Resolve"} <ArrowRightIcon className="size-3" />
    </Link>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition", active ? "border-foreground bg-foreground text-background" : "hover:border-primary/50")}>{children}</button>
  );
}
