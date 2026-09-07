"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PlusIcon, SearchIcon, LayoutGridIcon, Columns3Icon, DownloadIcon, AlertTriangleIcon,
  BookmarkIcon, SaveIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon, XIcon, SettingsIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TicketStatusCategory } from "@prisma/client";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_PRIORITY_DOT } from "@/lib/ticket";
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABEL } from "@/lib/ticket-config";
import type { TicketRow } from "./serialize";
import { slaState, SlaPill } from "./sla";
import { TypeChip, StatusChip } from "./ticket-visuals";
import { NATIVE_COLUMNS, DEFAULT_COLUMNS, columnValue } from "./columns";
import { filterRows, sortRows, type TicketFilters } from "./filters";
import { saveTicketViewAction, deleteTicketViewAction } from "./view-actions";

type ClientStatus = { id: string; name: string; color: string | null; category: TicketStatusCategory };
export type ClientConfig = {
  types: { id: string; name: string; color: string | null; icon: string | null; statuses: ClientStatus[] }[];
  customColumns: { key: string; label: string }[];
};
type SavedView = { id: string; name: string; shared: boolean; mine: boolean; filters: Record<string, unknown>; columns: string[]; sort: { key: string; dir: "asc" | "desc" } | null };

const EMPTY: TicketFilters = { onlyOpen: true };

export function TicketsClient({ rows, config, canManage, currentUserName, views }: {
  rows: TicketRow[]; config: ClientConfig; canManage: boolean; currentUserName: string; views: SavedView[];
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState<TicketFilters>(EMPTY);
  const [columns, setColumns] = React.useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>({ key: "createdAt", dir: "desc" });
  const [activeView, setActiveView] = React.useState<string | null>(null);
  const [colsOpen, setColsOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [more, setMore] = React.useState(false);

  const allColumns = React.useMemo(
    () => [...NATIVE_COLUMNS, ...config.customColumns.map((c) => ({ key: `cf:${c.key}`, label: c.label }))],
    [config.customColumns],
  );
  const labelOf = (key: string) => allColumns.find((c) => c.key === key)?.label ?? key;

  const assignees = React.useMemo(() => Array.from(new Set(rows.map((r) => r.assigneeName).filter((x): x is string => !!x))).sort(), [rows]);
  const clients = React.useMemo(() => Array.from(new Set(rows.map((r) => r.clientName).filter((x): x is string => !!x))).sort(), [rows]);

  const shown = React.useMemo(() => sortRows(filterRows(rows, filters, currentUserName), sort), [rows, filters, sort, currentUserName]);

  function applyView(v: SavedView | null) {
    if (!v) { setActiveView(null); setFilters(EMPTY); setColumns(DEFAULT_COLUMNS); setSort({ key: "createdAt", dir: "desc" }); return; }
    setActiveView(v.id);
    setFilters(v.filters as TicketFilters);
    setColumns(v.columns.length ? v.columns : DEFAULT_COLUMNS);
    setSort(v.sort);
  }
  function toggle<T extends string>(key: keyof TicketFilters, value: T) {
    setFilters((f) => {
      const cur = (f[key] as T[] | undefined) ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...f, [key]: next };
    });
  }
  const chipOn = (key: keyof TicketFilters, value: string) => ((filters[key] as string[] | undefined) ?? []).includes(value);

  const activeViewObj = views.find((v) => v.id === activeView) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Configurable incidents, requests, changes, bugs &amp; tasks — with SLA targets, custom fields and saved views.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && <Link href="/tickets/settings" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary"><SettingsIcon className="size-4" /> Configure</Link>}
          <Link href="/tickets/board" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:border-primary/50 hover:text-primary"><LayoutGridIcon className="size-4" /> Board</Link>
          <Link href="/tickets/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:bg-foreground/90"><PlusIcon className="size-4" /> New ticket</Link>
        </div>
      </div>

      {/* Saved views */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ViewChip label="All open" active={activeView === null} onClick={() => applyView(null)} />
        {views.map((v) => <ViewChip key={v.id} label={v.name} shared={v.shared && !v.mine} active={activeView === v.id} onClick={() => applyView(views.find((x) => x.id === v.id) ?? null)} />)}
        <button onClick={() => setSaveOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:text-primary"><BookmarkIcon className="size-3" /> Save view</button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.text ?? ""} onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))} placeholder="Search number, title, client, system…" className="h-9 pl-8" />
          </div>
          <button onClick={() => setFilters((f) => ({ ...f, mine: f.mine === "assigned" ? null : "assigned" }))} className={cn("h-9 rounded-md border px-3 text-sm", filters.mine === "assigned" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>Assigned to me</button>
          <button onClick={() => setFilters((f) => ({ ...f, mine: f.mine === "requested" ? null : "requested" }))} className={cn("h-9 rounded-md border px-3 text-sm", filters.mine === "requested" ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}>Raised by me</button>
          <button onClick={() => setColsOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted"><Columns3Icon className="size-4" /> Columns</button>
          <form method="post" action="/api/tickets/export">
            <input type="hidden" name="payload" value={JSON.stringify({ filters, columns, sort })} />
            <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground hover:bg-muted"><DownloadIcon className="size-4" /> Export</button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ChipGroup label="Type" options={config.types.map((t) => ({ v: t.id, l: t.name }))} on={(v) => chipOn("typeIds", v)} toggle={(v) => toggle("typeIds", v)} />
          <ChipGroup label="Stage" options={STATUS_CATEGORIES.map((c) => ({ v: c, l: STATUS_CATEGORY_LABEL[c] }))} on={(v) => chipOn("statusCategories", v)} toggle={(v) => toggle<TicketStatusCategory>("statusCategories", v as TicketStatusCategory)} />
          <ChipGroup label="Priority" options={TICKET_PRIORITIES.map((p) => ({ v: p, l: TICKET_PRIORITY_LABEL[p] }))} on={(v) => chipOn("priorities", v)} toggle={(v) => toggle("priorities", v)} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={filters.onlyOpen ?? false} onChange={(e) => setFilters((f) => ({ ...f, onlyOpen: e.target.checked }))} className="accent-primary" /> Open only</label>
          <button onClick={() => setMore((m) => !m)} className="text-xs text-muted-foreground hover:text-primary">{more ? "Fewer filters" : "More filters"}</button>
          {(activeViewObj || Object.keys(filters).length > 1) && <button onClick={() => applyView(null)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"><XIcon className="size-3" /> Reset</button>}
        </div>
        {more && (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5 border-t pt-2">
            {assignees.length > 0 && <ChipGroup label="Assignee" options={assignees.map((a) => ({ v: a, l: a }))} on={(v) => chipOn("assigneeNames", v)} toggle={(v) => toggle("assigneeNames", v)} />}
            {clients.length > 0 && <ChipGroup label="Client" options={clients.map((c) => ({ v: c, l: c }))} on={(v) => chipOn("clientNames", v)} toggle={(v) => toggle("clientNames", v)} />}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{shown.length} of {rows.length} tickets</span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? <>No tickets yet. <Link href="/tickets/new" className="text-primary hover:underline">Raise the first one</Link>.</> : "No tickets match these filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {columns.map((k) => <th key={k} className="whitespace-nowrap px-3 py-2 font-medium">{labelOf(k)}</th>)}
                <th className="px-3 py-2 font-medium">SLA</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sla = slaState(r);
                return (
                  <tr key={r.id} onClick={() => router.push(`/tickets/${r.id}`)} className="cursor-pointer border-b last:border-none hover:bg-muted/40">
                    {columns.map((k) => <td key={k} className="px-3 py-2 align-middle">{renderCell(r, k)}</td>)}
                    <td className="px-3 py-2">{sla.breached ? <span className="inline-flex items-center gap-1 text-xs text-rose-500"><AlertTriangleIcon className="size-3.5" /> {sla.label}</span> : <SlaPill state={sla} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!canManage && <p className="text-xs text-muted-foreground">You see tickets you raised or are assigned to. PMs and admins see and triage all.</p>}

      {colsOpen && <ColumnsDialog all={allColumns} value={columns} onChange={setColumns} onClose={() => setColsOpen(false)} />}
      {saveOpen && <SaveViewDialog current={activeViewObj} filters={filters} columns={columns} sort={sort} onClose={() => setSaveOpen(false)} onSaved={() => { setSaveOpen(false); router.refresh(); }} />}
    </div>
  );
}

function renderCell(r: TicketRow, key: string) {
  if (key === "type") return <TypeChip name={r.typeName} color={r.typeColor} icon={r.typeIcon} />;
  if (key === "status") return <StatusChip name={r.statusName} color={r.statusColor} />;
  if (key === "priority") return <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", TICKET_PRIORITY_DOT[r.priority])} /> {TICKET_PRIORITY_LABEL[r.priority]}</span>;
  if (key === "number") return <span className="font-mono text-xs text-muted-foreground">{r.number}</span>;
  if (key === "title") return <span className="font-medium">{r.title}</span>;
  const v = columnValue(r, key);
  return v ? <span className="text-muted-foreground">{v}</span> : <span className="text-muted-foreground/30">—</span>;
}

function ViewChip({ label, active, shared, onClick }: { label: string; active: boolean; shared?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", active ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>
      {label}{shared && <span className="text-[0.6rem] opacity-60">shared</span>}
    </button>
  );
}

function ChipGroup({ label, options, on, toggle }: { label: string; options: { v: string; l: string }[]; on: (v: string) => boolean; toggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground/70">{label}</span>
      {options.map((o) => (
        <button key={o.v} onClick={() => toggle(o.v)} className={cn("rounded-full border px-2 py-0.5 text-xs transition-colors", on(o.v) ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>{o.l}</button>
      ))}
    </div>
  );
}

function ColumnsDialog({ all, value, onChange, onClose }: { all: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; onClose: () => void }) {
  const [cols, setCols] = React.useState<string[]>(value);
  const available = all.filter((c) => !cols.includes(c.key));
  const move = (i: number, d: -1 | 1) => setCols((c) => { const n = [...c]; const j = i + d; if (j < 0 || j >= n.length) return c; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Columns</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shown (in order)</div>
            <div className="flex flex-col divide-y rounded-md border">
              {cols.map((k, i) => (
                <div key={k} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                  <span>{all.find((c) => c.key === k)?.label ?? k}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUpIcon className="size-3.5" /></button>
                    <button onClick={() => move(i, 1)} disabled={i === cols.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDownIcon className="size-3.5" /></button>
                    <button onClick={() => setCols((c) => c.filter((x) => x !== k))} className="text-muted-foreground hover:text-destructive"><XIcon className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {available.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add column</div>
              <div className="flex flex-wrap gap-1">
                {available.map((c) => <button key={c.key} onClick={() => setCols((cur) => [...cur, c.key])} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">+ {c.label}</button>)}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { onChange(cols); onClose(); }}>Apply</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaveViewDialog({ current, filters, columns, sort, onClose, onSaved }: {
  current: SavedView | null; filters: TicketFilters; columns: string[]; sort: { key: string; dir: "asc" | "desc" } | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = React.useState(current?.mine ? current.name : "");
  const [shared, setShared] = React.useState(current?.shared ?? false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const canUpdate = current?.mine ?? false;

  async function save(asNew: boolean) {
    setSaving(true); setErr(null);
    const r = await saveTicketViewAction({ id: asNew ? undefined : current?.mine ? current.id : undefined, name, shared, filters: filters as Record<string, unknown>, columns, sort });
    setSaving(false);
    if (r.error) setErr(r.error); else onSaved();
  }
  async function remove() {
    if (!current?.mine) return;
    setSaving(true);
    const r = await deleteTicketViewAction(current.id);
    setSaving(false);
    if (r.error) setErr(r.error); else onSaved();
  }
  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Save view</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1"><Label htmlFor="vn">View name</Label><Input id="vn" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My open bugs" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-primary" /> Share with the whole team</label>
          <p className="text-xs text-muted-foreground">Saves the current filters, columns and sort order.</p>
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <div>{canUpdate && <Button variant="outline" onClick={remove} disabled={saving} className="text-destructive"><Trash2Icon className="size-4" /></Button>}</div>
          <div className="flex gap-2">
            {canUpdate && <Button variant="outline" onClick={() => save(false)} disabled={saving || !name.trim()}><SaveIcon className="mr-1.5 size-4" /> Update</Button>}
            <Button onClick={() => save(true)} disabled={saving || !name.trim()}>Save as new</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
