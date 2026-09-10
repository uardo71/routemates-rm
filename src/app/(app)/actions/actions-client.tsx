"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListChecksIcon, DownloadIcon, ArrowUpIcon, ArrowDownIcon, ArrowUpDownIcon, CheckIcon, SearchIcon, FlagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ACTION_SOURCES, ACTION_SOURCE_LABEL, filterActions, sortActions, summarizeActions, type ActionSortKey, type ActionSource, type EnrichedAction } from "@/lib/actions-register";
import { completeActionAction } from "./actions";

const SOURCE_TONE: Record<ActionSource, string> = {
  RAID: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
  MEETING: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  STATUS: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  PLAN: "bg-violet-500/12 text-violet-700 dark:text-violet-400",
};
const hrefOf = (a: EnrichedAction) => {
  const p = new URLSearchParams();
  if (a.engagementId) p.set("eng", a.engagementId);
  p.set("tab", a.source === "RAID" ? "raid" : a.source === "MEETING" ? "minutes" : a.source === "STATUS" ? "status" : "plan");
  return `/delivery/${a.projectId}?${p.toString()}`;
};
const control = "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ActionsRegisterClient({ actions, projects, userId, mineOnly, canManage }: {
  actions: EnrichedAction[]; projects: { id: string; name: string }[]; userId: string; mineOnly: boolean; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mine, setMine] = useState(mineOnly);
  const [unassigned, setUnassigned] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [source, setSource] = useState<"" | ActionSource>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ActionSortKey>("worst");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [closing, setClosing] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const f = filterActions(actions, { mineUserId: mine ? userId : null, unassigned, overdue, projectId: projectId || null, source: source || null, q });
    return sortActions(f, sort, dir);
  }, [actions, mine, unassigned, overdue, projectId, source, q, sort, dir, userId]);
  const totals = useMemo(() => summarizeActions(actions), [actions]);
  const mineCount = useMemo(() => actions.filter((a) => a.ownerUserId === userId).length, [actions, userId]);

  const onSort = (k: ActionSortKey) => { if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setSort(k); setDir("asc"); } };
  const head = (k: ActionSortKey, label: string, className?: string) => <SortHead k={k} label={label} className={className} sort={sort} dir={dir} onSort={onSort} />;

  function done(a: EnrichedAction) {
    setClosing((s) => new Set(s).add(a.id));
    start(async () => {
      const r = await completeActionAction({ source: a.source, id: a.id });
      if (r.error) { toast.error(r.error); setClosing((s) => { const n = new Set(s); n.delete(a.id); return n; }); }
      else { toast.success("Closed."); router.refresh(); }
    });
  }

  const exportQs = new URLSearchParams();
  if (mine) exportQs.set("mine", "1"); if (unassigned) exportQs.set("unassigned", "1"); if (overdue) exportQs.set("overdue", "1");
  if (projectId) exportQs.set("project", projectId); if (source) exportQs.set("source", source); if (q.trim()) exportQs.set("q", q.trim());

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ListChecksIcon className="size-5 text-muted-foreground" /> Actions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {mineOnly ? "Every open action assigned to you, across all projects." : "Every open action across your projects — plan tasks, issues, status-update actions and meeting actions — worst first."}
          </p>
        </div>
        <Button variant="outline" size="sm" render={<a href={`/api/actions/export${exportQs.size ? `?${exportQs.toString()}` : ""}`} />}><DownloadIcon className="size-4" /> Export XLSX</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!mineOnly && <Chip active={mine} onClick={() => setMine((v) => !v)}>Mine <span className="font-mono">{mineCount}</span></Chip>}
        <Chip active={unassigned} onClick={() => setUnassigned((v) => !v)}>Unassigned <span className="font-mono">{totals.unassigned}</span></Chip>
        <Chip active={overdue} onClick={() => setOverdue((v) => !v)}><span className="size-2 rounded-full bg-rose-500" /> Overdue <span className="font-mono">{totals.overdue}</span></Chip>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">{actions.length === 0 ? "Nothing open. Enjoy it." : "Nothing matches these filters."}</TableCell></TableRow>}
                {rows.map((a) => {
                  const isClosing = closing.has(a.id);
                  const canClose = canManage || a.ownerUserId === userId;
                  return (
                    <TableRow key={`${a.source}:${a.id}`} className={cn("align-top", isClosing && "opacity-40")}>
                      <TableCell>
                        <button
                          type="button" disabled={pending || isClosing || !canClose} onClick={() => done(a)}
                          title={canClose ? "Mark done — closes it at source" : "Only the owner or the project manager can close this"}
                          className={cn("grid size-5 place-items-center rounded-full border-2 transition", isClosing ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 text-transparent hover:border-emerald-500 hover:text-emerald-500 disabled:opacity-40")}
                        ><CheckIcon className="size-3" /></button>
                      </TableCell>
                      <TableCell><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", SOURCE_TONE[a.source])}>{ACTION_SOURCE_LABEL[a.source]}</span></TableCell>
                      <TableCell className="max-w-md">
                        <Link href={hrefOf(a)} className="font-medium hover:underline">{a.title}</Link>
                        {a.critical && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase text-rose-600"><FlagIcon className="size-3" /> critical</span>}
                      </TableCell>
                      <TableCell className="text-sm"><div>{a.projectName}</div>{a.engagementName && <div className="text-xs text-muted-foreground">{a.engagementName}</div>}</TableCell>
                      <TableCell className="text-sm">{a.owner ? <span className={cn(a.ownerUserId === userId && "font-medium")}>{a.owner}</span> : <span className="text-xs text-amber-600">unassigned</span>}</TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm">
                        {a.dueDate ? <span className={cn("font-mono", a.isOverdue && "font-semibold text-rose-600")}>{a.dueDate}</span> : <span className="text-muted-foreground">—</span>}
                        {a.isOverdue && <div className="text-[11px] text-rose-600">{a.overdueDays}d late</div>}
                        {a.overdueDays === 0 && <div className="text-[11px] text-amber-600">today</div>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{a.ageDays}d</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.status}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="px-6 py-3 text-xs text-muted-foreground">Showing {rows.length} of {actions.length}. Ticking an action closes it at source: issue → Closed, meeting and status actions → done, plan task → 100%.</p>
        </CardContent>
      </Card>
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

