"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListChecksIcon, DownloadIcon, ArrowUpIcon, ArrowDownIcon, ArrowUpDownIcon, CheckIcon, SearchIcon, FlagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ACTION_SOURCES, ACTION_SOURCE_LABEL, actionKey, filterActions, sortActions, summarizeActions, type ActionSortKey, type ActionSource, type ActionView, type EnrichedAction } from "@/lib/actions-register";
import { saveActionChangesAction } from "./actions";

const SOURCE_TONE: Record<ActionSource, string> = {
  RAID: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
  MEETING: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  STATUS: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  PLAN: "bg-violet-500/12 text-violet-700 dark:text-violet-400",
};
const VIEWS: { key: ActionView; label: string }[] = [{ key: "open", label: "Open" }, { key: "completed", label: "Completed" }, { key: "all", label: "All" }];
const hrefOf = (a: EnrichedAction) => {
  const p = new URLSearchParams();
  if (a.engagementId) p.set("eng", a.engagementId);
  p.set("tab", a.source === "RAID" ? "raid" : a.source === "MEETING" ? "minutes" : a.source === "STATUS" ? "status" : "plan");
  return `/delivery/${a.projectId}?${p.toString()}`;
};
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
  const [sort, setSort] = useState<ActionSortKey>("worst");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  // Ticks are staged until Save: action key → the done state it will be saved as.
  const [staged, setStaged] = useState<Map<string, boolean>>(new Map());
  // Completed during this visit: stays in the Open view, crossed out, until the page is left.
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const byKey = useMemo(() => new Map(actions.map((a) => [actionKey(a), a])), [actions]);
  const isDone = (a: EnrichedAction) => { const k = actionKey(a); return staged.has(k) ? staged.get(k)! : !!a.done; };

  const rows = useMemo(() => {
    const keep = new Set([...pinned, ...staged.keys()]);
    const f = filterActions(actions, { view, pinned: keep, mineUserId: mine ? userId : null, unassigned, overdue, projectId: projectId || null, source: source || null, q });
    return sortActions(f, sort, dir);
  }, [actions, view, pinned, staged, mine, unassigned, overdue, projectId, source, q, sort, dir, userId]);
  const totals = useMemo(() => summarizeActions(actions), [actions]);
  const mineCount = useMemo(() => actions.filter((a) => !a.done && a.ownerUserId === userId).length, [actions, userId]);

  const toComplete = [...staged.values()].filter(Boolean).length;
  const toReopen = staged.size - toComplete;

  // Leaving with unsaved ticks asks first.
  useEffect(() => {
    if (staged.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [staged.size]);

  const onSort = (k: ActionSortKey) => { if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(k); setDir("asc"); } };
  const head = (k: ActionSortKey, label: string, className?: string) => <SortHead k={k} label={label} className={className} sort={sort} dir={dir} onSort={onSort} />;
  const pickView = (v: ActionView) => { setView(v); setSort(v === "completed" ? "completed" : "worst"); setDir(v === "completed" ? "desc" : "asc"); };

  function toggle(a: EnrichedAction) {
    const k = actionKey(a);
    const want = !isDone(a);
    setStaged((s) => { const n = new Map(s); if (want === !!a.done) n.delete(k); else n.set(k, want); return n; });
  }
  function discard() { setStaged(new Map()); }
  function save() {
    const changes = [...staged].flatMap(([k, done]) => { const a = byKey.get(k); return a ? [{ source: a.source, id: a.id, done }] : []; });
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
    ? "Every action assigned to you, across all projects — open and completed."
    : isAdmin
      ? "Every action across all projects — plan tasks, issues, status-update actions and meeting actions."
      : "Every action across the projects you manage — plan tasks, issues, status-update actions and meeting actions.";

  return (
    <div className="flex flex-col gap-5 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ListChecksIcon className="size-5 text-muted-foreground" /> Actions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="outline" size="sm" render={<a href={`/api/actions/export?${exportQs.toString()}`} />}><DownloadIcon className="size-4" /> Export XLSX</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="Which actions">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => pickView(v.key)}
              className={cn("rounded-full px-3 py-1 font-medium", view === v.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {v.label} <span className="font-mono text-muted-foreground">{v.key === "open" ? totals.total : v.key === "completed" ? totals.completed : actions.length}</span>
            </button>
          ))}
        </div>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {!mineOnly && <Chip active={mine} onClick={() => setMine((v) => !v)}>Mine <span className="font-mono">{mineCount}</span></Chip>}
        {view !== "completed" && <Chip active={unassigned} onClick={() => setUnassigned((v) => !v)}>Unassigned <span className="font-mono">{totals.unassigned}</span></Chip>}
        {view !== "completed" && <Chip active={overdue} onClick={() => setOverdue((v) => !v)}><span className="size-2 rounded-full bg-rose-500" /> Overdue <span className="font-mono">{totals.overdue}</span></Chip>}
        {!mineOnly && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={cn(control, "h-8 text-xs")}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={source} onChange={(e) => setSource(e.target.value as "" | ActionSource)} className={cn(control, "h-8 text-xs")}>
          <option value="">All sources</option>
          {ACTION_SOURCES.map((s) => <option key={s} value={s}>{ACTION_SOURCE_LABEL[s]}</option>)}
        </select>
        <div className="relative ml-auto">
          <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions…" className="h-8 w-56 pl-8" />
        </div>
      </div>

      <Card>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  {head("source", "Source")}
                  {head("title", "Action")}
                  {head("project", "Project / end customer")}
                  {head("owner", "Owner")}
                  {head("due", "Due", "text-right")}
                  {head("age", "Age", "text-right")}
                  {head("completed", "Status")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                    {view === "completed" ? "Nothing completed yet." : view === "open" && totals.total === 0 ? "Nothing open. Enjoy it." : "Nothing matches these filters."}
                  </TableCell></TableRow>
                )}
                {rows.map((a) => {
                  const k = actionKey(a);
                  const done = isDone(a);
                  const changed = staged.has(k);
                  const canClose = canManage || a.ownerUserId === userId;
                  return (
                    <TableRow key={k} className={cn("align-top", done && "bg-muted/30", changed && "bg-amber-500/[0.06]")}>
                      <TableCell>
                        <button
                          type="button" disabled={pending || !canClose} onClick={() => toggle(a)} aria-pressed={done}
                          title={!canClose ? "Only the owner or the project manager can change this" : done ? "Completed — click to reopen" : "Mark completed (saved when you click Save)"}
                          className={cn("grid size-5 place-items-center rounded-full border-2 transition disabled:opacity-40",
                            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 text-transparent hover:border-emerald-500 hover:text-emerald-500",
                            changed && "ring-2 ring-amber-400 ring-offset-1 ring-offset-background")}
                        ><CheckIcon className="size-3" /></button>
                      </TableCell>
                      <TableCell><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SOURCE_TONE[a.source], done && "opacity-60")}>{ACTION_SOURCE_LABEL[a.source]}</span></TableCell>
                      <TableCell className="max-w-md">
                        <Link href={hrefOf(a)} className={cn("font-medium hover:underline", done && "text-muted-foreground line-through decoration-muted-foreground/60")}>{a.title}</Link>
                        {a.critical && !done && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase text-rose-600"><FlagIcon className="size-3" /> critical</span>}
                      </TableCell>
                      <TableCell className={cn("text-sm", done && "text-muted-foreground")}><div>{a.projectName}</div>{a.engagementName && <div className="text-xs text-muted-foreground">{a.engagementName}</div>}</TableCell>
                      <TableCell className={cn("text-sm", done && "text-muted-foreground")}>{a.owner ? <span className={cn(!done && a.ownerUserId === userId && "font-medium")}>{a.owner}</span> : <span className="text-xs text-amber-600">unassigned</span>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm">
                        {a.dueDate ? <span className={cn("font-mono", done ? "text-muted-foreground" : a.isOverdue && "font-semibold text-rose-600")}>{a.dueDate}</span> : <span className="text-muted-foreground">—</span>}
                        {!done && a.isOverdue && <div className="text-[11px] text-rose-600">{a.overdueDays}d late</div>}
                        {!done && a.overdueDays === 0 && <div className="text-[11px] text-amber-600">today</div>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{a.ageDays}d</TableCell>
                      <TableCell className="text-xs">
                        {changed
                          ? <span className="font-medium text-amber-700 dark:text-amber-400">{done ? "Will be completed" : "Will be reopened"} · unsaved</span>
                          : done
                            ? <span className="text-emerald-700 dark:text-emerald-400">Completed{a.completedAt ? ` ${a.completedAt.slice(0, 10)}` : ""}{a.completedBy ? <span className="text-muted-foreground"> · {a.completedBy}</span> : null}</span>
                            : <span className="text-muted-foreground">{a.status}</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground">
            Showing {rows.length}. Tick to complete, untick a completed one to reopen, then Save. Saving closes it at source: issue → Closed, meeting and status actions → done, plan task → 100% (a reopened plan task goes back to 0%).
          </p>
        </CardContent>
      </Card>

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

function SortHead({ k, label, className, sort, dir, onSort }: { k: ActionSortKey; label: string; className?: string; sort: ActionSortKey; dir: "asc" | "desc"; onSort: (k: ActionSortKey) => void }) {
  return (
    <TableHead className={cn("cursor-pointer select-none whitespace-nowrap", className)} onClick={() => onSort(k)}>
      <span className="inline-flex items-center gap-1">{label}{sort === k ? (dir === "asc" ? <ArrowUpIcon className="size-3" /> : <ArrowDownIcon className="size-3" />) : <ArrowUpDownIcon className="size-3 opacity-40" />}</span>
    </TableHead>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition", active ? "border-foreground bg-foreground text-background" : "hover:border-primary/50")}>{children}</button>
  );
}
