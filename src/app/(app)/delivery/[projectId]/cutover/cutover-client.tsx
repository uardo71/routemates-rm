"use client";

import * as React from "react";
import Link from "next/link";
import {
  PlusIcon, Trash2Icon, ChevronUpIcon, ChevronDownIcon, DownloadIcon, ListChecksIcon, ClockIcon,
  CornerDownRightIcon, SaveIcon, Undo2Icon, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CUTOVER_STATUSES, CUTOVER_STATUS_LABEL, CUTOVER_STATUS_TONE, STANDARD_CUTOVER, hoursValue, minutesFromHours, formatHours, rollupStatus } from "@/lib/cutover";
import type { CutoverRowData, CutoverListData, CutoverStatusStr } from "./serialize";
import { saveCutoverPlanAction } from "./actions";

type Row = {
  id: string;
  parentId: string | null;
  macroActivity: string;
  activity: string;
  description: string;
  responsible: string;
  prerequisite: string;
  referenceList: string;
  startDate: string;
  endDate: string;
  durationText: string;
  status: CutoverStatusStr;
};

type Col = { key: string; label: string; width: number; resizable: boolean };
const COLUMNS: Col[] = [
  { key: "num", label: "#", width: 52, resizable: false },
  { key: "macro", label: "Macro activity", width: 150, resizable: true },
  { key: "activity", label: "Activity", width: 220, resizable: true },
  { key: "description", label: "Description", width: 320, resizable: true },
  { key: "reference", label: "Ref. list", width: 130, resizable: true },
  { key: "responsible", label: "Responsible", width: 150, resizable: true },
  { key: "prerequisite", label: "Prereq.", width: 96, resizable: true },
  { key: "start", label: "Start", width: 132, resizable: false },
  { key: "end", label: "End", width: 132, resizable: false },
  { key: "duration", label: "Duration (h)", width: 100, resizable: false },
  { key: "status", label: "Status", width: 132, resizable: false },
  { key: "actions", label: "", width: 108, resizable: false },
];

const toEditable = (d: CutoverRowData): Row => ({
  id: d.id, parentId: d.parentId, macroActivity: d.macroActivity, activity: d.activity, description: d.description,
  responsible: d.responsible, prerequisite: d.prerequisite, referenceList: d.referenceList, startDate: d.startDate,
  endDate: d.endDate, durationText: hoursValue(d.durationMinutes), status: d.status,
});

const newId = () => `new:${crypto.randomUUID()}`;
const blankRow = (parentId: string | null, macro = ""): Row => ({
  id: newId(), parentId, macroActivity: macro, activity: "", description: "", responsible: "", prerequisite: "",
  referenceList: "", startDate: "", endDate: "", durationText: "", status: "PENDING",
});

const autoGrow = (el: HTMLTextAreaElement | null) => { if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; };

type Agg = { responsible: string; startDate: string; endDate: string; durationHoursText: string; status: CutoverStatusStr };
// A parent with children reports a rollup of its sub-steps instead of its own editable values.
function aggregate(kids: Row[]): Agg {
  const mins = kids.reduce((s, k) => s + (minutesFromHours(k.durationText) ?? 0), 0);
  const starts = kids.map((k) => k.startDate).filter(Boolean).sort();
  const ends = kids.map((k) => k.endDate).filter(Boolean).sort();
  const responsible = [...new Set(kids.map((k) => k.responsible.trim()).filter(Boolean))].join(", ");
  return {
    responsible,
    startDate: starts[0] ?? "",
    endDate: ends[ends.length - 1] ?? "",
    durationHoursText: hoursValue(mins),
    status: rollupStatus(kids.map((k) => k.status)),
  };
}

export function CutoverClient({
  planId, planName, engagementName, projectName, projectNumber, clientName, rows: initial, lists: initialLists, userNames, backHref,
}: {
  planId: string;
  planName: string;
  engagementName: string | null;
  projectName: string;
  projectNumber: string | null;
  clientName: string;
  rows: CutoverRowData[];
  lists: CutoverListData[];
  userNames: string[];
  backHref: string;
}) {
  const [rows, setRows] = React.useState<Row[]>(initial.map(toEditable));
  const [baseline, setBaseline] = React.useState<Row[]>(initial.map(toEditable));
  const [lists, setLists] = React.useState<CutoverListData[]>(initialLists);
  const [baselineLists, setBaselineLists] = React.useState<CutoverListData[]>(initialLists);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [colW, setColW] = React.useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.filter((c) => c.resizable).map((c) => [c.key, c.width])));

  // Warn before leaving with unsaved changes.
  React.useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const edit = (id: string, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))); setDirty(true); };
  const addRow = () => { setRows((rs) => [...rs, blankRow(null)]); setDirty(true); };
  const addChild = (parentId: string) => { const p = rows.find((r) => r.id === parentId); setRows((rs) => [...rs, blankRow(parentId, p?.macroActivity ?? "")]); setDirty(true); };
  const addStandard = () => {
    setRows((rs) => [...rs, ...STANDARD_CUTOVER.map((t) => ({ ...blankRow(null, t.macro), activity: t.activity, description: t.description ?? "" }))]);
    setDirty(true);
  };
  const del = (id: string) => { setRows((rs) => rs.filter((r) => r.id !== id && r.parentId !== id)); setDirty(true); };
  const move = (id: string, dir: "up" | "down") => {
    setRows((rs) => {
      const row = rs.find((r) => r.id === id);
      if (!row) return rs;
      const sibs = rs.filter((r) => r.parentId === row.parentId);
      const si = sibs.findIndex((r) => r.id === id);
      const ti = dir === "up" ? si - 1 : si + 1;
      if (ti < 0 || ti >= sibs.length) return rs;
      const a = rs.findIndex((r) => r.id === id);
      const b = rs.findIndex((r) => r.id === sibs[ti].id);
      const copy = [...rs];
      [copy[a], copy[b]] = [copy[b], copy[a]];
      return copy;
    });
    setDirty(true);
  };

  // Ordered (parent-first) list with computed step numbers, depth, and — for parents — a rollup of
  // their children (total time, date range, status, responsible).
  const flat = React.useMemo(() => {
    const top = rows.filter((r) => !r.parentId);
    const out: { row: Row; number: string; depth: number; hasChildren: boolean; agg: Agg | null }[] = [];
    top.forEach((t, i) => {
      const kids = rows.filter((r) => r.parentId === t.id);
      out.push({ row: t, number: `${i + 1}`, depth: 0, hasChildren: kids.length > 0, agg: kids.length > 0 ? aggregate(kids) : null });
      kids.forEach((c, j) => out.push({ row: c, number: `${i + 1}.${j + 1}`, depth: 1, hasChildren: false, agg: null }));
    });
    return out;
  }, [rows]);

  async function save() {
    setSaving(true);
    setError(null);
    const tasks = flat.map(({ row: r }) => ({
      id: r.id, parentId: r.parentId, macroActivity: r.macroActivity, activity: r.activity, description: r.description,
      responsible: r.responsible, prerequisite: r.prerequisite, referenceList: r.referenceList, startDate: r.startDate || null, endDate: r.endDate || null,
      durationMinutes: minutesFromHours(r.durationText), status: r.status,
    }));
    const listPayload = lists.map((l) => ({ id: l.id, name: l.name, columns: l.columns, rows: l.rows }));
    const res = await saveCutoverPlanAction(planId, { tasks, lists: listPayload });
    if (res.rows) {
      const eds = res.rows.map(toEditable);
      setRows(eds); setBaseline(eds);
      setLists(res.lists ?? []); setBaselineLists(res.lists ?? []);
      setDirty(false);
    } else setError(res.error ?? "Could not save.");
    setSaving(false);
  }
  function discard() {
    setRows(baseline.map((r) => ({ ...r })));
    setLists(baselineLists.map((l) => ({ ...l, columns: [...l.columns], rows: l.rows.map((rr) => [...rr]) })));
    setDirty(false); setError(null);
  }

  // Only leaf steps (no children) count toward totals — a header rolls up its own children.
  const leaves = rows.filter((r) => !rows.some((c) => c.parentId === r.id));
  const totalMin = leaves.reduce((s, r) => s + (minutesFromHours(r.durationText) ?? 0), 0);
  const doneCount = leaves.filter((r) => r.status === "DONE").length;
  const macros = [...new Set(rows.map((r) => r.macroActivity).filter(Boolean))];
  const width = (c: Col) => (c.resizable ? colW[c.key] ?? c.width : c.width);

  function startResize(key: string, e: React.PointerEvent) {
    const startX = e.clientX;
    const startW = colW[key] ?? COLUMNS.find((c) => c.key === key)!.width;
    const onMove = (ev: PointerEvent) => setColW((w) => ({ ...w, [key]: Math.max(70, startW + ev.clientX - startX) }));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    e.preventDefault();
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href={backHref} className="text-sm text-muted-foreground hover:underline">← Back</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{planName}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {engagementName && <span className="font-medium text-foreground">{engagementName} · </span>}
              {projectName}{projectNumber ? ` · ${projectNumber}` : ""} · {clientName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved changes</span>}
            <Button variant="outline" size="sm" onClick={discard} disabled={!dirty || saving} className="gap-1.5"><Undo2Icon className="size-4" /> Discard</Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5"><SaveIcon className="size-4" /> {saving ? "Saving…" : "Save"}</Button>
            <a
              href={dirty ? undefined : `/api/cutover/${planId}/export`}
              aria-disabled={dirty}
              title={dirty ? "Save your changes first" : "Export to Excel"}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors", dirty ? "pointer-events-none opacity-50" : "hover:border-primary/50 hover:text-primary")}
            >
              <DownloadIcon className="size-4" /> Export Excel
            </a>
          </div>
        </div>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
          <SummaryTile icon={ListChecksIcon} label="Steps" value={`${leaves.length}`} />
          <SummaryTile icon={ClockIcon} label="Planned duration" value={formatHours(totalMin) || "—"} />
          <SummaryTile icon={ListChecksIcon} label="Completed" value={`${doneCount}/${leaves.length}`} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No cutover steps yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start from the standard SAP go-live runbook, then adapt it. Remember to Save.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button onClick={addStandard} className="gap-1.5"><ListChecksIcon className="size-4" /> Add standard SAP plan</Button>
            <Button variant="outline" onClick={addRow} className="gap-1.5"><PlusIcon className="size-4" /> Add blank row</Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="border-collapse text-sm" style={{ tableLayout: "fixed", width: COLUMNS.reduce((s, c) => s + width(c), 0) }}>
            <colgroup>{COLUMNS.map((c) => <col key={c.key} style={{ width: width(c) }} />)}</colgroup>
            <thead>
              <tr className="border-b bg-muted/50 text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="relative px-2 py-2 font-medium">
                    {c.label}
                    {c.resizable && (
                      <span onPointerDown={(e) => startResize(c.key, e)} className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/30" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flat.map(({ row: r, number, depth, hasChildren, agg }, i) => (
                <tr key={r.id} className={cn("group border-b align-top last:border-none", hasChildren ? "bg-primary/[0.06] hover:bg-primary/10" : "hover:bg-muted/20")}>
                  <td className={cn("px-2 py-2 text-center font-mono text-xs tabular-nums", hasChildren ? "font-semibold text-foreground" : "text-muted-foreground")}>{number}</td>
                  <td className="border-l"><InputCell value={r.macroActivity} onChange={(v) => edit(r.id, { macroActivity: v })} list="cutover-macros" placeholder="Phase…" className={cn("font-medium", hasChildren && "font-semibold")} /></td>
                  <td className="border-l">
                    <div className={cn("flex items-start", depth === 1 && "pl-3")}>
                      {depth === 1 && <CornerDownRightIcon className="mt-1.5 ml-0.5 size-3.5 shrink-0 text-muted-foreground/50" />}
                      <TextCell value={r.activity} onChange={(v) => edit(r.id, { activity: v })} placeholder={depth === 1 ? "Sub-step…" : "What to do…"} className={hasChildren ? "font-semibold" : undefined} />
                    </div>
                  </td>
                  <td className="border-l"><TextCell value={r.description} onChange={(v) => edit(r.id, { description: v })} placeholder="Details…" /></td>
                  <td className="border-l">
                    {hasChildren
                      ? <div className="px-2 py-1.5 text-sm text-muted-foreground">—</div>
                      : <InputCell value={r.referenceList} onChange={(v) => edit(r.id, { referenceList: v })} list="cutover-lists" placeholder="—" className="font-medium text-primary" />}
                  </td>
                  {hasChildren ? (
                    <>
                      <td className="border-l px-2 py-1.5 text-sm text-muted-foreground"><span className="line-clamp-2">{agg!.responsible || "—"}</span></td>
                      <td className="border-l px-2 py-1.5 text-sm text-muted-foreground tabular-nums">—</td>
                      <td className="border-l px-2 py-1.5 text-sm tabular-nums">{agg!.startDate || "—"}</td>
                      <td className="border-l px-2 py-1.5 text-sm tabular-nums">{agg!.endDate || "—"}</td>
                      <td className="border-l px-2 py-1.5 text-sm font-semibold tabular-nums">{agg!.durationHoursText || "—"}</td>
                      <td className="border-l px-2 py-1.5"><span className={cn("inline-block rounded-full px-2 py-1 text-xs font-medium", CUTOVER_STATUS_TONE[agg!.status])}>{CUTOVER_STATUS_LABEL[agg!.status]}</span></td>
                    </>
                  ) : (
                    <>
                      <td className="border-l"><InputCell value={r.responsible} onChange={(v) => edit(r.id, { responsible: v })} list="cutover-users" placeholder="Who…" /></td>
                      <td className="border-l"><InputCell value={r.prerequisite} onChange={(v) => edit(r.id, { prerequisite: v })} placeholder="e.g. 3" className="tabular-nums" /></td>
                      <td className="border-l"><input type="date" value={r.startDate} onChange={(e) => edit(r.id, { startDate: e.target.value })} className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                      <td className="border-l"><input type="date" value={r.endDate} onChange={(e) => edit(r.id, { endDate: e.target.value })} className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                      <td className="border-l"><input type="number" min="0" step="0.25" inputMode="decimal" value={r.durationText} onChange={(e) => edit(r.id, { durationText: e.target.value })} placeholder="1.25" className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums outline-none focus:bg-muted/50" /></td>
                      <td className="border-l px-2 py-1.5">
                        <select value={r.status} onChange={(e) => edit(r.id, { status: e.target.value as CutoverStatusStr })} className={cn("w-full cursor-pointer rounded-full border-0 px-2 py-1 text-xs font-medium outline-none focus:ring-2 focus:ring-ring", CUTOVER_STATUS_TONE[r.status])}>
                          {CUTOVER_STATUSES.map((s) => <option key={s} value={s} className="bg-background text-foreground">{CUTOVER_STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                    </>
                  )}
                  <td className="border-l">
                    <div className="flex items-center justify-center gap-0.5 py-1.5">
                      <button type="button" onClick={() => move(r.id, "up")} disabled={i === 0} title="Move up" className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20"><ChevronUpIcon className="size-4" /></button>
                      <button type="button" onClick={() => move(r.id, "down")} disabled={i === flat.length - 1} title="Move down" className="text-muted-foreground/40 hover:text-foreground disabled:opacity-20"><ChevronDownIcon className="size-4" /></button>
                      {depth === 0 && <button type="button" onClick={() => addChild(r.id)} title="Add sub-step" className="text-muted-foreground/40 hover:text-primary"><CornerDownRightIcon className="size-4" /></button>}
                      <button type="button" onClick={() => del(r.id)} title="Delete row" className="text-muted-foreground/40 hover:text-destructive"><Trash2Icon className="size-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5"><PlusIcon className="size-4" /> Add row</Button>
          <Button variant="ghost" size="sm" onClick={addStandard} className="gap-1.5 text-muted-foreground"><ListChecksIcon className="size-4" /> Append standard SAP plan</Button>
        </div>
      )}

      {/* Reference lists — detail tables (TR lists, jobs, table entries) that steps point to. */}
      <ReferenceLists lists={lists} onChange={(l) => { setLists(l); setDirty(true); }} />

      <datalist id="cutover-users">{userNames.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="cutover-macros">{macros.map((m) => <option key={m} value={m} />)}</datalist>
      <datalist id="cutover-lists">{lists.map((l) => l.name && <option key={l.id} value={l.name} />)}</datalist>

      <p className="text-xs text-muted-foreground">
        <strong>#</strong> auto-numbers the steps (3.1, 3.2 are sub-steps of step 3). <strong>Prereq.</strong> is the step number that must finish first. <strong>Duration</strong> is in hours (0.25 = 15 min).
        <strong> Ref. list</strong> points a step at one of the detail lists below (each becomes its own tab in the Excel export).
        Drag a column&apos;s right edge to widen it. Changes are only stored when you press <strong>Save</strong>.
      </p>
    </div>
  );
}

function ReferenceLists({ lists, onChange }: { lists: CutoverListData[]; onChange: (lists: CutoverListData[]) => void }) {
  const update = (id: string, fn: (l: CutoverListData) => CutoverListData) => onChange(lists.map((l) => (l.id === id ? fn(l) : l)));
  const addList = () => onChange([...lists, { id: newId(), name: "", columns: ["", ""], rows: [] }]);
  const delList = (id: string) => onChange(lists.filter((l) => l.id !== id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reference lists</h2>
        <span className="h-px flex-1 bg-border" />
        <Button variant="outline" size="sm" onClick={addList} className="gap-1.5"><PlusIcon className="size-4" /> Add list</Button>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">Detail tables a step can point to (e.g. TRANSPORT LIST, JOBS). Each is exported as its own tab in the workbook.</p>

      {lists.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No reference lists. Add one for TRs, jobs, table entries…</div>
      ) : (
        lists.map((l) => (
          <div key={l.id} className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <input
                value={l.name}
                onChange={(e) => update(l.id, (x) => ({ ...x, name: e.target.value }))}
                placeholder="LIST NAME (e.g. TRANSPORT LIST)"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase tracking-wide outline-none placeholder:font-normal placeholder:normal-case placeholder:tracking-normal placeholder:text-muted-foreground"
              />
              <span className="shrink-0 text-xs text-muted-foreground">{l.rows.length} row{l.rows.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => delList(l.id)} title="Delete list" className="shrink-0 text-muted-foreground/40 hover:text-destructive"><Trash2Icon className="size-4" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/20">
                    <th className="w-8" />
                    {l.columns.map((c, ci) => (
                      <th key={ci} className="border-l px-1 py-1 text-left">
                        <div className="flex items-center gap-1">
                          <input value={c} onChange={(e) => update(l.id, (x) => ({ ...x, columns: x.columns.map((v, k) => (k === ci ? e.target.value : v)) }))} placeholder={`Column ${ci + 1}`} className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none" />
                          {l.columns.length > 1 && <button type="button" onClick={() => update(l.id, (x) => ({ ...x, columns: x.columns.filter((_, k) => k !== ci), rows: x.rows.map((r) => r.filter((_, k) => k !== ci)) }))} title="Delete column" className="shrink-0 text-muted-foreground/30 hover:text-destructive"><Trash2Icon className="size-3" /></button>}
                        </div>
                      </th>
                    ))}
                    <th className="w-9 border-l text-center">
                      <button type="button" onClick={() => update(l.id, (x) => ({ ...x, columns: [...x.columns, ""], rows: x.rows.map((r) => [...r, ""]) }))} title="Add column" className="text-muted-foreground/50 hover:text-primary"><PlusIcon className="mx-auto size-3.5" /></button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {l.rows.map((r, ri) => (
                    <tr key={ri} className="border-b last:border-none hover:bg-muted/20">
                      <td className="text-center text-[10px] text-muted-foreground/50 tabular-nums">{ri + 1}</td>
                      {l.columns.map((_, ci) => (
                        <td key={ci} className="border-l"><input value={r[ci] ?? ""} onChange={(e) => update(l.id, (x) => ({ ...x, rows: x.rows.map((row, k) => (k === ri ? row.map((v, kk) => (kk === ci ? e.target.value : v)) : row)) }))} className="w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/50" /></td>
                      ))}
                      <td className="border-l text-center"><button type="button" onClick={() => update(l.id, (x) => ({ ...x, rows: x.rows.filter((_, k) => k !== ri) }))} title="Delete row" className="text-muted-foreground/30 hover:text-destructive"><Trash2Icon className="size-3" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t px-3 py-1.5">
              <button type="button" onClick={() => update(l.id, (x) => ({ ...x, rows: [...x.rows, Array(x.columns.length).fill("")] }))} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"><PlusIcon className="size-3.5" /> Add row</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TextCell({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <textarea
      rows={1}
      ref={(el) => autoGrow(el)}
      onInput={(e) => autoGrow(e.currentTarget)}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn("w-full resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm leading-snug outline-none focus:bg-muted/50", className)}
    />
  );
}

function InputCell({ value, onChange, list, placeholder, className }: { value: string; onChange: (v: string) => void; list?: string; placeholder?: string; className?: string }) {
  return (
    <input
      value={value}
      list={list}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn("w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-muted/50", className)}
    />
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <Icon className="size-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0">
        <div className="text-[0.625rem] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate font-mono text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
