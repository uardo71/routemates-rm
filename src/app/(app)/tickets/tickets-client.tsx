"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookmarkIcon, SaveIcon, Trash2Icon, ArrowUpIcon, ArrowDownIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TICKET_PRIORITY_LABEL, TICKET_PRIORITY_DOT } from "@/lib/ticket";
import type { TicketStatusCategory } from "@prisma/client";
import type { TicketRow } from "./serialize";
import { SlaBadge, slaBadgeState } from "./sla";
import { TypeChip, StatusChip } from "./ticket-visuals";
import { NATIVE_COLUMNS, DEFAULT_COLUMNS, columnValue } from "./columns";
import { filterRows, sortRows, type TicketFilters, type TicketFocus } from "./filters";
import { TicketFilterBar } from "./filter-bar";
import { saveTicketViewAction, deleteTicketViewAction } from "./view-actions";

type ClientStatus = { id: string; name: string; color: string | null; category: TicketStatusCategory };
export type ClientConfig = {
  types: { id: string; name: string; color: string | null; icon: string | null; statuses: ClientStatus[] }[];
  customColumns: { key: string; label: string }[];
  /** Archived custom fields: labelled "(archived)" where a saved view already shows them, never offered to add. */
  archivedColumns: { key: string; label: string }[];
};
type SavedView = { id: string; name: string; shared: boolean; mine: boolean; filters: TicketFilters; columns: string[]; sort: { key: string; dir: "asc" | "desc" } | null };

const EMPTY: TicketFilters = { onlyOpen: true };

/** Filter chip options keyed by account id, labelled by name, sorted by name. */
function optionsById(pairs: [string | null, string | null][]): { v: string; l: string }[] {
  const m = new Map<string, string>();
  for (const [id, name] of pairs) if (id && name) m.set(id, name);
  return [...m.entries()].map(([v, l]) => ({ v, l })).sort((a, b) => a.l.localeCompare(b.l));
}

export function TicketsClient({ rows, config, canManage, currentUserId, views, lockedClient, initialFocus = null }: {
  rows: TicketRow[]; config: ClientConfig; canManage: boolean; currentUserId: string; views: SavedView[];
  /** Drill-down from an overview number (?focus=…): opens the list already narrowed to those tickets. */
  initialFocus?: TicketFocus | null;
  /** Set inside a client workspace: rows are already scoped server-side, so the client filter is
   *  hidden, new tickets pre-select this client, and exports stay within it. */
  lockedClient?: { id: string; name: string };
}) {
  const router = useRouter();
  // "Resolved" must not be hidden by the default open-only filter.
  const [filters, setFilters] = React.useState<TicketFilters>(initialFocus ? { focus: initialFocus, onlyOpen: initialFocus !== "resolved7d" } : EMPTY);
  const [columns, setColumns] = React.useState<string[]>(DEFAULT_COLUMNS);
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>({ key: "createdAt", dir: "desc" });
  const [activeView, setActiveView] = React.useState<string | null>(null);
  const [colsOpen, setColsOpen] = React.useState(false);
  const [saveOpen, setSaveOpen] = React.useState(false);

  const allColumns = React.useMemo(
    () => [...NATIVE_COLUMNS, ...config.customColumns.map((c) => ({ key: `cf:${c.key}`, label: c.label }))],
    [config.customColumns],
  );
  const archivedColumns = config.archivedColumns.map((c) => ({ key: `cf:${c.key}`, label: c.label }));
  const labelOf = (key: string) => allColumns.find((c) => c.key === key)?.label ?? archivedColumns.find((c) => c.key === key)?.label ?? key;

  const assignees = React.useMemo(() => optionsById(rows.map((r) => [r.assigneeId, r.assigneeName])), [rows]);
  const clients = React.useMemo(() => optionsById(rows.map((r) => [r.clientId, r.clientName])), [rows]);

  const shown = React.useMemo(() => sortRows(filterRows(rows, filters, currentUserId), sort), [rows, filters, sort, currentUserId]);

  function applyView(v: SavedView | null) {
    if (!v) { setActiveView(null); setFilters(EMPTY); setColumns(DEFAULT_COLUMNS); setSort({ key: "createdAt", dir: "desc" }); return; }
    setActiveView(v.id);
    setFilters(v.filters);
    setColumns(v.columns.length ? v.columns : DEFAULT_COLUMNS);
    setSort(v.sort);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Saved views */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ViewChip label="All open" active={activeView === null} onClick={() => applyView(null)} />
        {views.map((v) => <ViewChip key={v.id} label={v.name} shared={v.shared && !v.mine} active={activeView === v.id} onClick={() => applyView(views.find((x) => x.id === v.id) ?? null)} />)}
        <button onClick={() => setSaveOpen(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:text-primary"><BookmarkIcon className="size-3" /> Save view</button>
      </div>

      <TicketFilterBar
        filters={filters}
        setFilters={setFilters}
        config={{ types: config.types.map((t) => ({ v: t.id, l: t.name })), assignees, clients }}
        lockedClient={lockedClient}
        onColumns={() => setColsOpen(true)}
        exportPayload={JSON.stringify({ filters: lockedClient ? { ...filters, clientIds: [lockedClient.id] } : filters, columns, sort })}
        onReset={() => { setActiveView(null); setFilters({}); }}
      />

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
                {columns.map((k) => {
                  // "created" is the legacy alias some saved views still carry for createdAt.
                  const sk = k === "created" ? "createdAt" : k;
                  const active = sort?.key === sk;
                  const dir = active ? sort!.dir : null;
                  return (
                    <th key={k} className="whitespace-nowrap px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setSort((cur) => cur && cur.key === sk
                          ? { key: sk, dir: cur.dir === "asc" ? "desc" : "asc" }
                          // Dates read newest-first by default; everything else A→Z.
                          : { key: sk, dir: sk === "createdAt" || sk === "dueDate" || sk === "resolveBy" ? "desc" : "asc" })}
                        className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
                        title={`Sort by ${labelOf(k)}`}
                      >
                        {labelOf(k)}
                        {dir === "asc" && <ArrowUpIcon className="size-3" />}
                        {dir === "desc" && <ArrowDownIcon className="size-3" />}
                      </button>
                    </th>
                  );
                })}
                <th className="px-3 py-2 font-medium">SLA</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sla = slaBadgeState(r);
                return (
                  <tr key={r.id} onClick={() => router.push(`/tickets/${r.id}`)} className="cursor-pointer border-b last:border-none hover:bg-muted/40">
                    {columns.map((k) => <td key={k} className="px-3 py-2 align-middle">{renderCell(r, k)}</td>)}
                    <td className="px-3 py-2"><SlaBadge state={sla} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!canManage && <p className="text-xs text-muted-foreground">You see the tickets of the clients you&apos;re staffed on, plus any you raised or are assigned to.</p>}

      {colsOpen && <ColumnsDialog all={allColumns} labelOf={labelOf} value={columns} onChange={setColumns} onClose={() => setColsOpen(false)} />}
      {saveOpen && <SaveViewDialog current={views.find((v) => v.id === activeView) ?? null} filters={filters} columns={columns} sort={sort} onClose={() => setSaveOpen(false)} onSaved={() => { setSaveOpen(false); router.refresh(); }} />}
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


// `all` holds only addable columns (archived fields excluded); `labelOf` also names archived columns a
// saved view already shows, so they read "Name (archived)" in the shown list.
function ColumnsDialog({ all, labelOf, value, onChange, onClose }: { all: { key: string; label: string }[]; labelOf: (key: string) => string; value: string[]; onChange: (v: string[]) => void; onClose: () => void }) {
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
                  <span>{labelOf(k)}</span>
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
