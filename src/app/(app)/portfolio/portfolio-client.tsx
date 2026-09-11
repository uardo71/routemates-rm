"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SearchIcon, Building2Icon, ChevronDownIcon, ChevronRightIcon,
  ArrowUpIcon, ArrowDownIcon, ArrowUpDownIcon, FlagIcon, XIcon, ListChecksIcon, PaperclipIcon, FileTextIcon,
} from "lucide-react";
import { AttachDialog } from "./attach-dialog";
import type { RagStatus } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InitialsAvatar } from "@/components/initials-avatar";
import { cn } from "@/lib/utils";
import { RAG_DOT, RAG_PILL } from "@/lib/delivery";
import type { WorkspaceRow } from "@/lib/delivery-day";
import { formatSlip } from "@/lib/plan-schedule";
import { HYGIENE_CHECKS, hygieneCounts, type HygieneItem, type HygieneKey } from "@/lib/hygiene";

// A triage table, so the worst health sorts to the top by default.
const RAG_RANK: Record<RagStatus, number> = { RED: 0, AMBER: 1, GREEN: 2 };
const RAG_ORDER: RagStatus[] = ["RED", "AMBER", "GREEN"];
const RAG_SHORT: Record<RagStatus, string> = { RED: "Red", AMBER: "Amber", GREEN: "Green" };

type SortKey = "health" | "name" | "customer" | "progress" | "status" | "issues" | "overdue" | "slip";
type Dir = "asc" | "desc";
const SORT_KEYS: SortKey[] = ["health", "name", "customer", "progress", "status", "issues", "overdue", "slip"];
const DEFAULT_SORT: SortKey = "health";
const DEFAULT_DIR: Dir = "asc";
const isSortKey = (v: string | null): v is SortKey => v != null && (SORT_KEYS as string[]).includes(v);

const TYPE_META = (w: WorkspaceRow) =>
  w.isEngagement
    ? { label: "End customer", cls: "bg-violet-500/12 text-violet-600 dark:text-violet-400" }
    : w.account
      ? { label: "Programme", cls: "bg-primary/15 text-primary" }
      : { label: "Project", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-400" };

// "Needs attention" = anything that isn't quietly green — the same rule the old card board used.
const needsAttention = (w: WorkspaceRow) => !w.completed && !(w.rag === "GREEN" && !w.statusDue && w.overdueTasks === 0);

function wsHref(w: WorkspaceRow, tab?: string) {
  const p = new URLSearchParams();
  if (w.engagementId) p.set("eng", w.engagementId);
  if (tab) p.set("tab", tab);
  p.set("from", "portfolio"); // so the workspace's back link returns here, not to My Day
  return `/delivery/${w.projectId}?${p.toString()}`;
}

function compare(a: WorkspaceRow, b: WorkspaceRow, key: SortKey): number {
  switch (key) {
    case "health":
      return (
        RAG_RANK[a.rag] - RAG_RANK[b.rag] ||
        Number(b.statusDue) - Number(a.statusDue) ||
        b.overdueTasks - a.overdueTasks ||
        b.openIssues - a.openIssues ||
        a.name.localeCompare(b.name)
      );
    case "name":
      return a.name.localeCompare(b.name);
    case "customer":
      return a.customerName.localeCompare(b.customerName) || a.name.localeCompare(b.name);
    case "progress":
      return (a.progress ?? -1) - (b.progress ?? -1);
    case "status": {
      // Most recently reported first; never-reported last.
      const da = a.lastStatusDays ?? Number.POSITIVE_INFINITY;
      const db = b.lastStatusDays ?? Number.POSITIVE_INFINITY;
      return da === db ? 0 : da < db ? -1 : 1;
    }
    case "issues":
      return a.openIssues - b.openIssues;
    case "overdue":
      return a.overdueTasks - b.overdueTasks;
    case "slip":
      // Not baselined sorts below "on baseline".
      return (a.slipDays ?? -1e9) - (b.slipDays ?? -1e9);
  }
}

export function PortfolioClient({ workspaces, hygiene, isAdmin }: { workspaces: WorkspaceRow[]; hygiene: HygieneItem[]; isAdmin: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();

  // Filters live in React state and are mirrored to the URL with replaceState — no server
  // round-trip per keystroke — so they survive opening a workspace and coming back.
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [rag, setRag] = useState<Set<RagStatus>>(
    () => new Set((sp.get("rag") ?? "").split(",").filter((x): x is RagStatus => x in RAG_RANK)),
  );
  const [attention, setAttention] = useState(sp.get("attn") === "1");
  const [due, setDue] = useState(sp.get("due") === "1");
  const [over, setOver] = useState(sp.get("over") === "1");
  const [group, setGroup] = useState(sp.get("group") === "1");
  const [showDone, setShowDone] = useState(sp.get("done") === "1");
  const [sort, setSort] = useState<SortKey>(() => (isSortKey(sp.get("sort")) ? (sp.get("sort") as SortKey) : DEFAULT_SORT));
  const [dir, setDir] = useState<Dir>(sp.get("dir") === "desc" ? "desc" : DEFAULT_DIR);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [attachTo, setAttachTo] = useState<WorkspaceRow | null>(null);
  const [hyg, setHyg] = useState<HygieneKey | null>(() => { const v = sp.get("hyg"); return HYGIENE_CHECKS.some((c) => c.key === v) ? (v as HygieneKey) : null; });
  const hygCounts = useMemo(() => hygieneCounts(hygiene), [hygiene]);
  const hygProjects = useMemo(() => (hyg ? new Set(hygiene.filter((h) => h.key === hyg).map((h) => h.projectId)) : null), [hyg, hygiene]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (rag.size > 0) p.set("rag", RAG_ORDER.filter((r) => rag.has(r)).join(","));
    if (attention) p.set("attn", "1");
    if (due) p.set("due", "1");
    if (over) p.set("over", "1");
    if (group) p.set("group", "1");
    if (showDone) p.set("done", "1");
    if (sort !== DEFAULT_SORT) p.set("sort", sort);
    if (dir !== DEFAULT_DIR) p.set("dir", dir);
    if (hyg) p.set("hyg", hyg);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [q, rag, attention, due, over, group, showDone, sort, dir, hyg]);

  // Counts over everything (not the filtered set), so the strip reads as "state of the portfolio".
  const completedCount = workspaces.filter((w) => w.completed).length;
  const counts = useMemo(() => {
    const live = workspaces.filter((w) => !w.completed);
    const c = { total: live.length, RED: 0, AMBER: 0, GREEN: 0, due: 0, over: 0, attention: 0 };
    for (const w of live) {
      c[w.rag]++;
      if (w.statusDue) c.due++;
      if (w.overdueTasks > 0) c.over++;
      if (needsAttention(w)) c.attention++;
    }
    return c;
  }, [workspaces]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = workspaces.filter((w) => {
      if (w.completed && !showDone) return false;
      if (rag.size > 0 && !rag.has(w.rag)) return false;
      if (attention && !needsAttention(w)) return false;
      if (due && !w.statusDue) return false;
      if (over && w.overdueTasks === 0) return false;
      if (hygProjects && !hygProjects.has(w.projectId)) return false;
      if (needle && !`${w.name} ${w.customerName} ${w.account ?? ""} ${w.ragLabel} ${w.statusLine}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) => {
      const c = compare(a, b, sort);
      return dir === "asc" ? c : -c;
    });
    return out;
  }, [workspaces, q, rag, attention, due, over, showDone, sort, dir, hygProjects]);

  // Optional grouping by the client company; groups themselves order worst-health first.
  const groups = useMemo(() => {
    if (!group) return null;
    const m = new Map<string, WorkspaceRow[]>();
    for (const w of rows) (m.get(w.customerName) ?? m.set(w.customerName, []).get(w.customerName)!).push(w);
    return [...m.entries()]
      .map(([client, list]) => ({
        client,
        list,
        worst: Math.min(...list.map((w) => RAG_RANK[w.rag])),
        red: list.filter((w) => w.rag === "RED").length,
        amber: list.filter((w) => w.rag === "AMBER").length,
        green: list.filter((w) => w.rag === "GREEN").length,
      }))
      .sort((a, b) => a.worst - b.worst || a.client.localeCompare(b.client));
  }, [rows, group]);

  const onSort = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir("asc"); }
  };
  const toggleRag = (r: RagStatus) =>
    setRag((prev) => { const n = new Set(prev); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  const toggleCollapse = (client: string) =>
    setCollapsed((prev) => { const n = new Set(prev); if (n.has(client)) n.delete(client); else n.add(client); return n; });

  const anyFilter = q.trim() !== "" || rag.size > 0 || attention || due || over || hyg !== null;
  const clearFilters = () => { setQ(""); setRag(new Set()); setAttention(false); setDue(false); setOver(false); setHyg(null); };
  const colCount = group ? 9 : 10;

  const headCls = "sticky top-0 z-10 border-b bg-muted";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin ? "Every customer workspace across the company" : "The customer workspaces you manage"}, worst health first. Click a row to open it.
          </p>
        </div>
        <div className="inline-flex rounded-full border bg-muted/40 p-0.5 text-xs">
          <button type="button" onClick={() => setAttention(false)} className={cn("rounded-full px-3 py-1 font-medium", !attention ? "bg-background shadow-sm" : "text-muted-foreground")}>
            All <span className="font-mono text-muted-foreground">{counts.total}</span>
          </button>
          <button type="button" onClick={() => setAttention(true)} className={cn("rounded-full px-3 py-1 font-medium", attention ? "bg-background shadow-sm" : "text-muted-foreground")}>
            Needs attention <span className="font-mono text-muted-foreground">{counts.attention}</span>
          </button>
        </div>
      </div>

      {/* data hygiene — what the project records are missing (lib/hygiene); a chip filters the table */}
      {hygiene.length > 0 && (
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium"><ListChecksIcon className="size-4 text-muted-foreground" /> Hygiene</span>
              <span className="text-xs text-muted-foreground">{hygiene.length} thing{hygiene.length === 1 ? "" : "s"} incomplete — click a check to filter the table and see what fixes it.</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {HYGIENE_CHECKS.filter((c) => hygCounts.get(c.key)).map((c) => (
                <Chip key={c.key} active={hyg === c.key} onClick={() => setHyg((v) => (v === c.key ? null : c.key))}>
                  <span className={cn("size-2 rounded-full", c.severity === "WARN" ? "bg-amber-500" : "bg-slate-400")} />
                  {c.label} <span className="font-mono">{hygCounts.get(c.key)}</span>
                </Chip>
              ))}
            </div>
            {hyg && (
              <ul className="flex flex-col divide-y rounded-md border text-sm">
                {hygiene.filter((h) => h.key === hyg).map((h) => (
                  <li key={`${h.key}:${h.subjectId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                    <span className="font-medium">{h.projectName}</span>
                    <span className="min-w-0 flex-1 text-xs text-muted-foreground">{h.hint}</span>
                    <Link href={h.fixHref} className="text-xs font-medium text-primary hover:underline">Fix it</Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* summary strip — every chip is also a filter */}
      <div className="flex flex-wrap items-center gap-2">
        {RAG_ORDER.map((r) => (
          <Chip key={r} active={rag.has(r)} onClick={() => toggleRag(r)}>
            <span className={cn("size-2 rounded-full", RAG_DOT[r])} />
            {RAG_SHORT[r]} <span className="font-mono">{counts[r]}</span>
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <Chip active={due} onClick={() => setDue((v) => !v)}>Status due <span className="font-mono">{counts.due}</span></Chip>
        <Chip active={over} onClick={() => setOver((v) => !v)}>Tasks overdue <span className="font-mono">{counts.over}</span></Chip>
        {completedCount > 0 && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            <Chip active={showDone} onClick={() => setShowDone((v) => !v)}>Completed <span className="font-mono">{completedCount}</span></Chip>
          </>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant={group ? "secondary" : "outline"} size="sm" aria-pressed={group} onClick={() => setGroup((v) => !v)}>
            <Building2Icon /> Group by client
          </Button>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, workspace, status…" className="w-64 pl-8" />
          </div>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No customer projects assigned to you yet.</CardContent></Card>
      ) : (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Showing <span className="font-mono text-foreground">{rows.length}</span> of {counts.total}</span>
            {anyFilter && (
              <Button variant="ghost" size="xs" onClick={clearFilters}><XIcon /> Clear filters</Button>
            )}
          </div>

          {/* Own scroll container (not the shadcn Table wrapper) so the header can stick with 100+ rows. */}
          <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-lg border bg-card shadow-sm">
            <table className="w-full caption-bottom text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortHead col="health" label="Health" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%]")} />
                  <SortHead col="name" label="Workspace" sort={sort} dir={dir} onSort={onSort} className={headCls} />
                  {!group && <SortHead col="customer" label="Customer" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%]")} />}
                  <SortHead col="progress" label="Progress" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%]")} />
                  <SortHead col="status" label="Last status" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%]")} />
                  <SortHead col="issues" label="Issues" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%] text-right")} />
                  <SortHead col="overdue" label="Overdue" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%] text-right")} />
                  <SortHead col="slip" label="Slip" sort={sort} dir={dir} onSort={onSort} className={cn(headCls, "w-[1%] text-right")} />
                  <TableHead className={cn(headCls, "w-[1%]")}>Next</TableHead>
                  <TableHead className={cn(headCls, "w-[1%]")}>Plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="py-10 text-center text-muted-foreground">Nothing matches your filters.</TableCell>
                  </TableRow>
                )}
                {groups
                  ? groups.map((g) => {
                      const isCollapsed = collapsed.has(g.client);
                      return (
                        <GroupRows key={g.client} colCount={colCount} client={g.client} count={g.list.length} red={g.red} amber={g.amber} green={g.green} collapsed={isCollapsed} onToggle={() => toggleCollapse(g.client)}>
                          {!isCollapsed && g.list.map((w) => <WorkspaceTableRow key={w.key} w={w} showCustomer={false} onOpen={() => router.push(wsHref(w))} onAttach={() => setAttachTo(w)} />)}
                        </GroupRows>
                      );
                    })
                  : rows.map((w) => <WorkspaceTableRow key={w.key} w={w} showCustomer onOpen={() => router.push(wsHref(w))} onAttach={() => setAttachTo(w)} />)}
              </TableBody>
            </table>
          </div>
        </>
      )}
      {attachTo && <AttachDialog w={attachTo} onClose={() => setAttachTo(null)} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/60",
        active ? "border-primary/60 bg-primary/10 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SortHead({ col, label, sort, dir, onSort, className }: {
  col: SortKey; label: string; sort: SortKey; dir: Dir; onSort: (k: SortKey) => void; className?: string;
}) {
  const active = sort === col;
  const Icon = !active ? ArrowUpDownIcon : dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(col)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active ? "text-foreground" : "text-muted-foreground")}>
        {label}
        <Icon className={cn("size-3", active ? "text-foreground" : "text-muted-foreground/50")} />
      </button>
    </TableHead>
  );
}

function GroupRows({ colCount, client, count, red, amber, green, collapsed, onToggle, children }: {
  colCount: number; client: string; count: number; red: number; amber: number; green: number; collapsed: boolean; onToggle: () => void; children: ReactNode;
}) {
  const Chevron = collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <>
      <TableRow className="bg-muted/40 hover:bg-muted/60">
        <TableCell colSpan={colCount} className="py-1.5">
          <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex w-full items-center gap-2 text-left">
            <Chevron className="size-4 shrink-0 text-muted-foreground" />
            <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold">{client}</span>
            <span className="text-xs text-muted-foreground">{count} workspace{count === 1 ? "" : "s"}</span>
            <span className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
              {red > 0 && <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", RAG_DOT.RED)} />{red}</span>}
              {amber > 0 && <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", RAG_DOT.AMBER)} />{amber}</span>}
              {green > 0 && <span className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-full", RAG_DOT.GREEN)} />{green}</span>}
            </span>
          </button>
        </TableCell>
      </TableRow>
      {children}
    </>
  );
}

function WorkspaceTableRow({ w, showCustomer, onOpen, onAttach }: { w: WorkspaceRow; showCustomer: boolean; onOpen: () => void; onAttach: () => void }) {
  const latest = w.planFiles[0];
  const type = TYPE_META(w);
  const pct = w.progress == null ? null : Math.max(0, Math.min(100, w.progress));
  return (
    <TableRow onClick={onOpen} className="cursor-pointer">
      <TableCell>
        {w.completed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-muted-foreground/50" />
            {w.ragLabel}
          </span>
        ) : (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", RAG_PILL[w.rag])}>
            <span className={cn("size-2 rounded-full", RAG_DOT[w.rag])} />
            {w.ragLabel}
          </span>
        )}
      </TableCell>
      {/* w-full + max-w-0 lets this column take the remaining width and still truncate. */}
      <TableCell className="w-full max-w-0">
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={w.isEngagement ? w.name : w.customerName} className="size-7 text-[10px]" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link href={wsHref(w)} onClick={(e) => e.stopPropagation()} className="truncate font-medium hover:underline">{w.name}</Link>
              <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", type.cls)}>{type.label}</span>
              {w.isEngagement && w.account && <span className="truncate text-xs text-muted-foreground">via {w.account}</span>}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{w.statusLine}</span>
              {!w.completed && w.tracking === "ADHOC" && <span className="shrink-0 rounded-full border border-dashed px-1.5 py-0.5 text-[10px]" title="Cadence is ad-hoc: status updates are never chased">Ad-hoc — not tracked</span>}
              {!w.completed && w.tracking === "OFF" && <span className="shrink-0 rounded-full border border-dashed px-1.5 py-0.5 text-[10px]" title="Programme level is not tracked — switch it on under Manage end customers">Not tracked</span>}
            </div>
          </div>
        </div>
      </TableCell>
      {showCustomer && <TableCell className="text-muted-foreground">{w.customerName}</TableCell>}
      <TableCell>
        {pct == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
            <span className="w-8 text-right font-mono text-xs tabular-nums">{pct}%</span>
          </div>
        )}
      </TableCell>
      <TableCell>
        {w.statusDue ? (
          <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            {w.lastStatusDays === null ? "Never sent" : `Due · ${w.lastStatusDays}d ago`}
          </span>
        ) : w.lastStatusDays === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="text-xs tabular-nums">
            {w.lastStatusDays}d ago{w.lastStatusDraft && <span className="text-muted-foreground"> · draft</span>}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {w.openIssues > 0 ? w.openIssues : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-right">
        {w.overdueTasks > 0 ? (
          <span className="rounded-full bg-rose-500/12 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-rose-600 dark:text-rose-400">{w.overdueTasks}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right" title={w.slipDays == null ? "No baseline set on this plan" : "Plan finish vs baseline finish"}>
        {w.slipDays == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cn("rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums", w.slipDays > 0 ? "bg-rose-500/12 text-rose-600 dark:text-rose-400" : w.slipDays < 0 ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{formatSlip(w.slipDays)}</span>
        )}
      </TableCell>
      <TableCell className="max-w-[16rem]">
        {w.nextMilestone ? (
          <span className="inline-flex max-w-full items-center gap-1 text-xs"><FlagIcon className="size-3 shrink-0 text-primary" /><span className="truncate">{w.nextMilestone}</span></span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      {/* The latest attached project plan, and Attach — clicks here never open the row. */}
      <TableCell onClick={(e) => e.stopPropagation()} className="cursor-default">
        <div className="flex items-center gap-1.5">
          {latest && (
            <a href={latest.url} target="_blank" rel="noreferrer" title={`${latest.name} · attached ${latest.date}`} className="inline-flex max-w-[11rem] items-center gap-1 text-xs text-primary hover:underline">
              <FileTextIcon className="size-3.5 shrink-0" /><span className="truncate">{latest.name}</span>
            </a>
          )}
          {w.planFiles.length > 1 && (
            <Link href={wsHref(w, "documents")} title="All plan files in the Documents library" className="shrink-0 font-mono text-[11px] text-muted-foreground hover:underline">+{w.planFiles.length - 1}</Link>
          )}
          <button
            type="button" onClick={onAttach}
            title="Attach a project plan or any other document"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PaperclipIcon className="size-3" />{latest ? <span className="sr-only">Attach</span> : "Attach"}
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}
