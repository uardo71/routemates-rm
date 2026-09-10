"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, DiamondIcon, WandSparklesIcon, ChevronUpIcon, ChevronDownIcon, Settings2Icon, FileDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { phaseProgress } from "@/lib/delivery";
import type { PlanTaskStatus } from "@prisma/client";
import { createPlanTaskAction, updatePlanTaskAction, deletePlanTaskAction, seedDefaultPlanAction, movePlanTaskAction, clearPlanAction } from "../actions";

export type PlanRow = {
  id: string; phase: string | null; name: string; owner: string | null;
  startDate: string | null; dueDate: string | null; progress: number;
  status: PlanTaskStatus; isMilestone: boolean;
};

const STATUSES: PlanTaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"];
const STATUS_LABEL: Record<PlanTaskStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked" };
const STATUS_BAR: Record<PlanTaskStatus, string> = { NOT_STARTED: "bg-blue-400", IN_PROGRESS: "bg-blue-500", COMPLETED: "bg-emerald-500", BLOCKED: "bg-rose-500" };
const STATUS_DOT: Record<PlanTaskStatus, string> = { NOT_STARTED: "bg-blue-400", IN_PROGRESS: "bg-blue-500", COMPLETED: "bg-emerald-500", BLOCKED: "bg-rose-500" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const dnum = (s: string | null) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtMs = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
// Progress drives the status: 0 = not started, 100 = completed, in-between = in progress.
// A manually-set BLOCKED status is preserved (it's a state %-completion can't express).
const derive = (pr: number, cur: PlanTaskStatus): PlanTaskStatus =>
  cur === "BLOCKED" ? "BLOCKED" : pr >= 100 ? "COMPLETED" : pr <= 0 ? "NOT_STARTED" : "IN_PROGRESS";

const ROW_H = 40;
const HEAD_H = 42;

type Draft = { id?: string; phase: string; name: string; owner: string; startDate: string; dueDate: string; progress: string; status: PlanTaskStatus; isMilestone: boolean };
const emptyDraft = (phase = ""): Draft => ({ phase, name: "", owner: "", startDate: "", dueDate: "", progress: "0", status: "NOT_STARTED", isMilestone: false });

const CELL = "h-7 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none hover:border-input focus:border-primary focus:bg-background";

export function PlanClient({ projectId, engagementId, tasks }: { projectId: string; engagementId: string | null; tasks: PlanRow[] }) {
  const router = useRouter();
  const [list, setList] = useState<PlanRow[]>(tasks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [cols, setCols] = useState({ name: 230, owner: 100, start: 120, due: 120, pct: 66 });
  const grid = `30px ${cols.name}px ${cols.owner}px ${cols.start}px ${cols.due}px ${cols.pct}px 52px`;
  function startResize(key: keyof typeof cols, e: React.PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX; const w0 = cols[key];
    const mv = (m: PointerEvent) => setCols((c) => ({ ...c, [key]: Math.max(44, w0 + (m.clientX - x0)) }));
    const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }

  // Keep local rows in sync when the server sends fresh data (add/delete/seed/reorder refresh, or an
  // engagement switch). Inline edits/drags update `list` optimistically and don't refresh, so typing
  // and dragging stay smooth.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setList(tasks); }, [tasks]);

  const phases = [...new Set(list.map((t) => t.phase ?? "General"))];

  // Optimistic field patch: update the row locally + persist. Only structural ops refresh.
  function patch(t: PlanRow, p: Partial<PlanRow>) {
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, ...p } : x)));
    const merged = { ...t, ...p };
    updatePlanTaskAction({
      id: t.id, projectId, engagementId, phase: merged.phase, name: merged.name, owner: merged.owner,
      startDate: merged.startDate, dueDate: merged.dueDate, progress: merged.progress, status: merged.status, isMilestone: merged.isMilestone,
    }).then((r) => { if (r.error) { toast.error(r.error); router.refresh(); } });
  }
  function structural(fn: () => Promise<{ error?: string }>, ok?: string) {
    setBusy(true);
    fn().then((r) => { if (r.error) toast.error(r.error); else if (ok) toast.success(ok); router.refresh(); }).finally(() => setBusy(false));
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Enter a task name.");
    const payload = {
      projectId, engagementId, phase: draft.phase || null, name: draft.name.trim(), owner: draft.owner || null,
      startDate: draft.startDate || null, dueDate: draft.dueDate || null,
      progress: draft.progress === "" ? 0 : Number(draft.progress), status: draft.status, isMilestone: draft.isMilestone,
    };
    setDraft(null);
    structural(() => (payload && draft.id ? updatePlanTaskAction({ id: draft.id, ...payload }) : createPlanTaskAction(payload)), "Saved.");
  }

  if (list.length === 0) {
    return (
      <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground">No project plan yet.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => structural(() => seedDefaultPlanAction(projectId, engagementId), "Standard plan added.")} disabled={busy}><WandSparklesIcon className="size-3.5" /> Add standard SAP plan</Button>
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> Add task</Button>
        </div>
        <p className="text-xs text-muted-foreground">The standard plan seeds a baseline schedule (Mobilize → Analysis → Build → Validate → Go-live) you can drag, resize and edit.</p>
      </CardContent></Card>
    );
  }

  // ---- flat rows (phase summary + tasks) ----
  type FlatRow = { kind: "phase"; label: string; wbs: string; s: number; e: number; progress: number } | { kind: "task"; wbs: string; t: PlanRow };
  const flat: FlatRow[] = [];
  phases.forEach((phase, pi) => {
    const group = list.filter((t) => (t.phase ?? "General") === phase);
    const starts = group.map((t) => dnum(t.startDate)).filter((n) => !Number.isNaN(n));
    const ends = group.map((t) => dnum(t.dueDate ?? t.startDate)).filter((n) => !Number.isNaN(n));
    const progress = phaseProgress(group);
    flat.push({ kind: "phase", label: phase, wbs: String(pi + 1), s: starts.length ? Math.min(...starts) : NaN, e: ends.length ? Math.max(...ends) : NaN, progress });
    group.forEach((t, ti) => flat.push({ kind: "task", wbs: `${pi + 1}.${ti + 1}`, t }));
  });

  const allTimes = list.flatMap((t) => [dnum(t.startDate), dnum(t.dueDate)]).filter((n) => !Number.isNaN(n));
  const hasTimeline = allTimes.length > 0;
  // Snap the window to whole months so the first/last items always have room (no edge-clipping) and
  // the month headers line up.
  const bounds = hasTimeline
    ? (() => {
        const a = new Date(Math.min(...allTimes)); a.setUTCDate(1); a.setUTCHours(0, 0, 0, 0);
        const b = new Date(Math.max(...allTimes)); b.setUTCMonth(b.getUTCMonth() + 1, 1); b.setUTCHours(0, 0, 0, 0);
        return { min: a.getTime(), max: b.getTime() };
      })()
    : { min: 0, max: 0 };
  const min = bounds.min, max = bounds.max;
  const totalDays = Math.max(1, Math.ceil((max - min) / DAY));
  const dayW = totalDays <= 45 ? 20 : totalDays <= 90 ? 13 : totalDays <= 180 ? 8 : totalDays <= 300 ? 5 : 3;
  const totalW = totalDays * dayW;
  const xOf = (ms: number) => ((ms - min) / DAY) * dayW;

  const monthTicks: { label: string; x: number }[] = [];
  if (hasTimeline) {
    const d = new Date(min); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    let g = 0;
    while (d.getTime() <= max && g++ < 60) { monthTicks.push({ label: `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, x: xOf(d.getTime()) }); d.setUTCMonth(d.getUTCMonth() + 1); }
  }
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const todayX = hasTimeline && todayMs >= min && todayMs <= max ? xOf(todayMs) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden p-0 gap-0">
        <CardHeader className="flex flex-row items-center justify-between border-b p-4">
          <div>
            <CardTitle className="text-base">Project plan</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Type to edit · drag a bar to move it · drag an edge to resize.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={`/print/plan/${projectId}${engagementId ? `?eng=${engagementId}` : ""}`} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline"><FileDownIcon className="size-3.5" /> Export PDF</Button>
            </a>
            <Button size="sm" onClick={() => setDraft(emptyDraft(phases[0] === "General" ? "" : phases[0] ?? ""))}><PlusIcon className="size-3.5" /> Add task</Button>
            <Button
              size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy}
              title="Delete every task of this plan"
              onClick={() => { if (confirm(`Delete this whole plan (${list.length} task${list.length === 1 ? "" : "s"})? Status updates, minutes and documents are kept.`)) structural(() => clearPlanAction(projectId, engagementId), "Plan deleted."); }}
            ><Trash2Icon className="size-3.5" /> Delete plan</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex">
            {/* LEFT: editable table */}
            <div className="shrink-0 border-r">
              <div className="grid items-center border-b bg-muted/40 text-[11px] font-medium text-muted-foreground" style={{ height: HEAD_H, gridTemplateColumns: grid }}>
                <div className="px-2">#</div>
                <ColHead label="Task" onResize={(e) => startResize("name", e)} />
                <ColHead label="Owner" onResize={(e) => startResize("owner", e)} />
                <ColHead label="Start" onResize={(e) => startResize("start", e)} />
                <ColHead label="Due" onResize={(e) => startResize("due", e)} />
                <ColHead label="%" align="right" onResize={(e) => startResize("pct", e)} />
                <div />
              </div>
              {flat.map((r, i) => r.kind === "phase" ? (
                <div key={`p${i}`} className="grid items-center border-b bg-muted/25 text-sm font-semibold" style={{ height: ROW_H, gridTemplateColumns: grid }}>
                  <div className="px-2 text-xs text-muted-foreground">{r.wbs}</div>
                  <div className="px-1.5 truncate">{r.label}</div>
                  <div /><div /><div />
                  <div className="px-1 text-right text-xs tabular-nums text-muted-foreground">{r.progress}%</div><div />
                </div>
              ) : (
                <TaskLeftRow key={r.t.id} wbs={r.wbs} t={r.t} busy={busy} grid={grid} onPatch={patch}
                  onEdit={() => setDraft({ id: r.t.id, phase: r.t.phase ?? "", name: r.t.name, owner: r.t.owner ?? "", startDate: r.t.startDate ?? "", dueDate: r.t.dueDate ?? "", progress: String(r.t.progress), status: r.t.status, isMilestone: r.t.isMilestone })}
                  onMove={(dir) => structural(() => movePlanTaskAction(r.t.id, dir))}
                  onDelete={() => { if (confirm(`Delete "${r.t.name}"?`)) structural(() => deletePlanTaskAction(r.t.id), "Deleted."); }} />
              ))}
            </div>

            {/* RIGHT: draggable timeline */}
            <div className="flex-1 overflow-x-auto">
              {hasTimeline ? (
                <div className="relative" style={{ width: totalW, minWidth: "100%" }}>
                  <div className="relative border-b bg-muted/40" style={{ height: HEAD_H }}>
                    {monthTicks.map((m, i) => <div key={i} className="absolute top-0 h-full border-l border-border/70 pl-1 text-[10px] text-muted-foreground" style={{ left: m.x }}>{m.label}</div>)}
                  </div>
                  {todayX != null && <div className="pointer-events-none absolute bottom-0 z-10 w-px bg-primary/70" style={{ left: todayX, top: HEAD_H }} title="Today" />}
                  {flat.map((r, i) => (
                    <div key={r.kind === "phase" ? `pb${i}` : r.t.id} className="relative border-b" style={{ height: ROW_H }}>
                      {monthTicks.map((m, k) => <div key={k} className="absolute top-0 h-full border-l border-border/30" style={{ left: m.x }} />)}
                      {r.kind === "phase"
                        ? (!Number.isNaN(r.s) && !Number.isNaN(r.e) && (
                            <div className="absolute top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-sm bg-muted ring-1 ring-black/5" style={{ left: xOf(r.s), width: Math.max(dayW, xOf(r.e) - xOf(r.s) + dayW) }}>
                              <div className={cn("h-full", r.progress >= 100 ? "bg-emerald-500" : r.progress <= 0 ? "bg-blue-400/70" : "bg-blue-500")} style={{ width: `${r.progress}%` }} />
                            </div>
                          ))
                        : <TaskBar t={r.t} dayW={dayW} xOf={xOf} onPatch={patch} />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">Add start/due dates to your tasks to see the timeline.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Dialog open disablePointerDismissal onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle className="flex items-center justify-between"><span>{draft.id ? "Edit plan item" : "Add plan item"}</span>{draft.id && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => { const id = draft.id!; setDraft(null); if (confirm("Delete this plan item?")) structural(() => deletePlanTaskAction(id), "Deleted."); }}><Trash2Icon className="size-3.5" /></Button>}</DialogTitle></DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Phase</Label><Input value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value })} placeholder="e.g. Build" list="plan-phases" /><datalist id="plan-phases">{phases.map((p) => <option key={p} value={p} />)}</datalist></div>
                <div className="flex items-center gap-2 mt-6"><input id="pl-ms" type="checkbox" className="size-4" checked={draft.isMilestone} onChange={(e) => setDraft({ ...draft, isMilestone: e.target.checked })} /><Label htmlFor="pl-ms">Milestone / gate (e.g. Go-live)</Label></div>
              </div>
              <div className="flex flex-col gap-1.5"><Label>Task name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={300} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Owner</Label><Input value={draft.owner} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} placeholder="Who's working on it" maxLength={200} /></div>
                <div className="flex flex-col gap-1.5"><Label>Start</Label><Input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></div>
                <div className="flex flex-col gap-1.5"><Label>{draft.isMilestone ? "Date" : "Due"}</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5"><Label>Progress %</Label><Input type="number" min="0" max="100" value={draft.progress} onChange={(e) => setDraft({ ...draft, progress: e.target.value })} disabled={draft.isMilestone} /></div>
                <div className="flex flex-col gap-1.5"><Label>Status</Label>
                  <Select value={draft.status} items={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} onValueChange={(v) => setDraft({ ...draft, status: (v as PlanTaskStatus) ?? "NOT_STARTED" })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" onClick={saveDraft} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---- left row: inline-editable cells (uncontrolled inputs keyed by value so drags update them) ----
function ColHead({ label, align, onResize }: { label: string; align?: "right"; onResize: (e: React.PointerEvent) => void }) {
  return (
    <div className={cn("relative px-1", align === "right" && "text-right")}>
      {label}
      <span onPointerDown={onResize} className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/50" title="Drag to resize" />
    </div>
  );
}

function TaskLeftRow({ wbs, t, busy, grid, onPatch, onEdit, onMove, onDelete }: {
  wbs: string; t: PlanRow; busy: boolean; grid: string;
  onPatch: (t: PlanRow, p: Partial<PlanRow>) => void; onEdit: () => void; onMove: (dir: "up" | "down") => void; onDelete: () => void;
}) {
  const eff = derive(t.progress, t.status);
  return (
    <div className="group grid items-center border-b text-sm hover:bg-muted/25" style={{ height: ROW_H, gridTemplateColumns: grid }}>
      <div className="px-2 text-xs text-muted-foreground">{wbs}</div>
      <div className="flex items-center gap-1 pl-4 pr-1">
        <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[eff])} title={STATUS_LABEL[eff]} />
        {t.isMilestone && <DiamondIcon className="size-3 shrink-0 text-primary" />}
        <input defaultValue={t.name} key={`n${t.name}`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) onPatch(t, { name: v }); }} className={cn(CELL, "min-w-0 flex-1")} />
      </div>
      <input defaultValue={t.owner ?? ""} key={`o${t.owner}`} placeholder="—" onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== t.owner) onPatch(t, { owner: v }); }} className={cn(CELL, "w-full text-xs")} />
      <input type="date" defaultValue={t.startDate ?? ""} key={`s${t.startDate}`} onChange={(e) => onPatch(t, { startDate: e.target.value || null })} className={cn(CELL, "w-full text-xs")} />
      <input type="date" defaultValue={t.dueDate ?? ""} key={`d${t.dueDate}`} onChange={(e) => onPatch(t, { dueDate: e.target.value || null })} className={cn(CELL, "w-full text-xs")} />
      {t.isMilestone
        ? <div className="px-1 text-right text-xs text-muted-foreground/50">—</div>
        : <input type="number" min={0} max={100} defaultValue={t.progress} key={`pr${t.progress}`} onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== t.progress) onPatch(t, { progress: v, status: derive(v, t.status) }); }} className={cn(CELL, "w-full text-right text-xs tabular-nums")} />}
      <div className="flex items-center justify-end gap-0.5 pr-1 opacity-0 group-hover:opacity-100">
        <button type="button" title="Up" onClick={() => onMove("up")} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronUpIcon className="size-3.5" /></button>
        <button type="button" title="Down" onClick={() => onMove("down")} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronDownIcon className="size-3.5" /></button>
        <button type="button" title="More…" onClick={onEdit} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2Icon className="size-3.5" /></button>
        <button type="button" title="Delete" onClick={onDelete} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2Icon className="size-3.5" /></button>
      </div>
    </div>
  );
}

// ---- timeline bar with drag-to-move and edge-resize ----
function TaskBar({ t, dayW, xOf, onPatch }: { t: PlanRow; dayW: number; xOf: (ms: number) => number; onPatch: (t: PlanRow, p: Partial<PlanRow>) => void }) {
  const [pv, setPv] = useState<{ s: number; e: number } | null>(null);
  const drag = useRef<{ mode: "move" | "l" | "r"; x0: number; s0: number; e0: number } | null>(null);
  const pvRef = useRef<{ s: number; e: number } | null>(null);

  const s0 = dnum(t.startDate); const e0 = dnum(t.dueDate);
  const baseS = !Number.isNaN(s0) ? s0 : e0; const baseE = !Number.isNaN(e0) ? e0 : s0;
  if (Number.isNaN(baseS) && Number.isNaN(baseE)) return null;

  const s = pv ? pv.s : baseS; const e = pv ? pv.e : baseE;
  const left = xOf(Math.min(s, e)); const width = Math.max(dayW, xOf(Math.max(s, e)) - xOf(Math.min(s, e)) + dayW);

  function begin(mode: "move" | "l" | "r", ev: React.PointerEvent) {
    ev.preventDefault(); ev.stopPropagation();
    drag.current = { mode, x0: ev.clientX, s0: baseS, e0: baseE };
    function mv(m: PointerEvent) {
      const d = drag.current; if (!d) return;
      const delta = Math.round((m.clientX - d.x0) / dayW) * DAY;
      let ns = d.s0, ne = d.e0;
      if (t.isMilestone || d.mode === "move") { ns = d.s0 + delta; ne = d.e0 + delta; }
      else if (d.mode === "l") { ns = Math.min(d.s0 + delta, d.e0); }
      else { ne = Math.max(d.e0 + delta, d.s0); }
      pvRef.current = { s: ns, e: ne }; setPv({ s: ns, e: ne });
    }
    function up() {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up);
      const p = pvRef.current; drag.current = null; pvRef.current = null; setPv(null);
      if (p) {
        const ns = toISO(Math.min(p.s, p.e)); const ne = toISO(Math.max(p.s, p.e));
        if (t.isMilestone) { if (ne !== t.dueDate) onPatch(t, { startDate: ne, dueDate: ne }); }
        else if (ns !== t.startDate || ne !== t.dueDate) onPatch(t, { startDate: ns, dueDate: ne });
      }
    }
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }

  if (t.isMilestone) {
    return (
      <div className="absolute top-1/2 flex -translate-y-1/2 cursor-grab items-center gap-1.5 active:cursor-grabbing" style={{ left: xOf(e) + dayW / 2 - 7 }} onPointerDown={(ev) => begin("move", ev)}>
        <div className={cn("size-3.5 shrink-0 rotate-45 bg-primary shadow", pv ? "ring-2 ring-primary/40" : "ring-1 ring-black/10")} />
        <span className="whitespace-nowrap text-[10px] font-medium text-foreground/80">{t.name} <span className="font-normal text-muted-foreground">· {fmtMs(e)}</span></span>
      </div>
    );
  }
  return (
    <div className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5" style={{ left }}>
      <div className={cn("group/bar relative h-4 rounded bg-muted ring-1 ring-black/5", pv && "ring-primary")} style={{ width }}>
        <div className={cn("h-full rounded-l", STATUS_BAR[derive(t.progress, t.status)], t.progress >= 100 && "rounded")} style={{ width: `${t.progress}%` }} />
        {/* move zone */}
        <div className="absolute inset-x-1.5 inset-y-0 cursor-grab active:cursor-grabbing" onPointerDown={(ev) => begin("move", ev)} />
        {/* resize handles */}
        <div className="absolute left-0 inset-y-0 w-1.5 cursor-ew-resize rounded-l bg-black/5 opacity-0 group-hover/bar:opacity-100" onPointerDown={(ev) => begin("l", ev)} />
        <div className="absolute right-0 inset-y-0 w-1.5 cursor-ew-resize rounded-r bg-black/5 opacity-0 group-hover/bar:opacity-100" onPointerDown={(ev) => begin("r", ev)} />
      </div>
      <span className="pointer-events-none whitespace-nowrap text-[10px] text-muted-foreground">{t.progress}%{t.owner ? ` · ${t.owner}` : ""}</span>
    </div>
  );
}
