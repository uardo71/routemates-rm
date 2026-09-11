"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, DiamondIcon, WandSparklesIcon, ChevronUpIcon, ChevronDownIcon, Settings2Icon, FileDownIcon, FlagIcon, Link2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OwnerCombobox, resolveOwner, type OwnerPerson } from "@/components/owner-combobox";
import { weightedProgress, slipDays, planSlip, formatSlip, wouldCreateCycle, type DateShift } from "@/lib/plan-schedule";
import type { PlanTaskStatus } from "@prisma/client";
import { createPlanTaskAction, updatePlanTaskAction, deletePlanTaskAction, seedDefaultPlanAction, movePlanTaskAction, clearPlanAction, setPlanDatesAction, setPlanBaselineAction } from "../actions";

export type PlanRow = {
  id: string; phase: string | null; name: string; owner: string | null; ownerUserId: string | null;
  startDate: string | null; dueDate: string | null; progress: number;
  status: PlanTaskStatus; isMilestone: boolean;
  /** Effort estimate; drives the effort-weighted progress when every task has one. */
  estimatedHours: number | null;
  /** The work people log time against. Actuals = approved hours on the milestone (narrowed to the task). */
  milestoneId: string | null; taskId: string | null;
  /** Finish-to-start predecessor: moving it moves this row by the same number of days. */
  dependsOnId: string | null;
  /** Frozen by "Set baseline"; never moved by a drag or an edit. */
  baselineStart: string | null; baselineEnd: string | null;
  /** Approved hours when a milestone is linked, else null. */
  actualHours: number | null;
};
export type PlanMilestone = { id: string; name: string; tasks: { id: string; name: string }[] };

const STATUSES: PlanTaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"];
const STATUS_LABEL: Record<PlanTaskStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked" };
const STATUS_BAR: Record<PlanTaskStatus, string> = { NOT_STARTED: "bg-blue-400", IN_PROGRESS: "bg-blue-500", COMPLETED: "bg-emerald-500", BLOCKED: "bg-rose-500" };
const STATUS_DOT: Record<PlanTaskStatus, string> = { NOT_STARTED: "bg-blue-400", IN_PROGRESS: "bg-blue-500", COMPLETED: "bg-emerald-500", BLOCKED: "bg-rose-500" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const NONE = "none";
const dnum = (s: string | null) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
const toISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtMs = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const fmtIso = (s: string | null) => (s ? fmtMs(dnum(s)) : "—");
const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
// Progress drives the status: 0 = not started, 100 = completed, in-between = in progress.
// A manually-set BLOCKED status is preserved (it's a state %-completion can't express).
const derive = (pr: number, cur: PlanTaskStatus): PlanTaskStatus =>
  cur === "BLOCKED" ? "BLOCKED" : pr >= 100 ? "COMPLETED" : pr <= 0 ? "NOT_STARTED" : "IN_PROGRESS";

const ROW_H = 40;
const HEAD_H = 42;

type Draft = {
  id?: string; phase: string; name: string; owner: string; ownerUserId: string | null; startDate: string; dueDate: string; progress: string; status: PlanTaskStatus; isMilestone: boolean;
  estimatedHours: string; milestoneId: string | null; taskId: string | null; dependsOnId: string | null;
};
const emptyDraft = (phase = ""): Draft => ({ phase, name: "", owner: "", ownerUserId: null, startDate: "", dueDate: "", progress: "0", status: "NOT_STARTED", isMilestone: false, estimatedHours: "", milestoneId: null, taskId: null, dependsOnId: null });
const draftOf = (t: PlanRow): Draft => ({
  id: t.id, phase: t.phase ?? "", name: t.name, owner: t.owner ?? "", ownerUserId: t.ownerUserId, startDate: t.startDate ?? "", dueDate: t.dueDate ?? "", progress: String(t.progress), status: t.status, isMilestone: t.isMilestone,
  estimatedHours: t.estimatedHours != null ? String(t.estimatedHours) : "", milestoneId: t.milestoneId, taskId: t.taskId, dependsOnId: t.dependsOnId,
});

const CELL = "h-7 rounded border border-transparent bg-transparent px-1.5 text-sm outline-none hover:border-input focus:border-primary focus:bg-background";

type DateRow = { id: string; startDate: string | null; dueDate: string | null };

export function PlanClient({ projectId, engagementId, tasks, people, milestones }: { projectId: string; engagementId: string | null; tasks: PlanRow[]; people: OwnerPerson[]; milestones: PlanMilestone[] }) {
  const router = useRouter();
  const [list, setList] = useState<PlanRow[]>(tasks);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [cols, setCols] = useState({ name: 220, owner: 96, start: 112, due: 112, pct: 58, slip: 56, effort: 104 });
  const grid = `30px ${cols.name}px ${cols.owner}px ${cols.start}px ${cols.due}px ${cols.pct}px ${cols.slip}px ${cols.effort}px 52px`;
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
  const msById = new Map(milestones.map((m) => [m.id, m]));

  function payloadOf(r: PlanRow) {
    return {
      id: r.id, projectId, engagementId, phase: r.phase, name: r.name, owner: r.owner, ownerUserId: r.ownerUserId,
      startDate: r.startDate, dueDate: r.dueDate, progress: r.progress, status: r.status, isMilestone: r.isMilestone,
      estimatedHours: r.estimatedHours, milestoneId: r.milestoneId, taskId: r.taskId, dependsOnId: r.dependsOnId,
    };
  }
  function applyDates(rows: DateRow[]) {
    const m = new Map(rows.map((r) => [r.id, r]));
    setList((l) => l.map((x) => { const d = m.get(x.id); return d ? { ...x, startDate: d.startDate, dueDate: d.dueDate } : x; }));
  }
  /** A move pushed the tasks that follow it: show them moved, and offer to put everything back. */
  function announceCascade(before: DateRow, name: string, shifted: DateShift[], delta: number, refreshAfter: boolean) {
    applyDates(shifted);
    const undo: DateRow[] = [before, ...shifted.map((s) => ({ id: s.id, startDate: s.prevStartDate, dueDate: s.prevDueDate }))];
    const n = shifted.length;
    toast(`Moved ${n} dependent task${n === 1 ? "" : "s"} ${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "later" : "earlier"}`, {
      description: `They follow “${name}”, so they moved with it.`,
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () => {
          applyDates(undo);
          setPlanDatesAction({ projectId, rows: undo }).then((r) => {
            if (r.error) { toast.error(r.error); router.refresh(); }
            else { toast.success("Move undone."); if (refreshAfter) router.refresh(); }
          });
        },
      },
    });
  }

  // Optimistic field patch: update the row locally + persist. Only structural ops refresh.
  function patch(t: PlanRow, p: Partial<PlanRow>) {
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, ...p } : x)));
    const merged = { ...t, ...p };
    updatePlanTaskAction(payloadOf(merged)).then((r) => {
      if (r.error) { toast.error(r.error); router.refresh(); return; }
      if (r.shifted && r.shifted.length > 0) announceCascade({ id: t.id, startDate: t.startDate, dueDate: t.dueDate }, merged.name, r.shifted, r.delta ?? 0, false);
    });
  }
  function structural(fn: () => Promise<{ error?: string }>, ok?: string) {
    setBusy(true);
    fn().then((r) => { if (r.error) toast.error(r.error); else if (ok) toast.success(ok); router.refresh(); }).finally(() => setBusy(false));
  }
  function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Enter a task name.");
    const est = draft.estimatedHours.trim() === "" ? null : Number(draft.estimatedHours);
    if (est != null && (!Number.isFinite(est) || est < 0)) return toast.error("Estimated hours must be a positive number.");
    const payload = {
      projectId, engagementId, phase: draft.phase || null, name: draft.name.trim(), owner: draft.owner || null, ownerUserId: draft.ownerUserId,
      startDate: draft.startDate || null, dueDate: draft.dueDate || null,
      progress: draft.progress === "" ? 0 : Number(draft.progress), status: draft.status, isMilestone: draft.isMilestone,
      estimatedHours: est, milestoneId: draft.milestoneId, taskId: draft.taskId, dependsOnId: draft.dependsOnId,
    };
    const editing = draft.id ? list.find((x) => x.id === draft.id) ?? null : null;
    setBusy(true);
    const run = editing ? updatePlanTaskAction({ id: editing.id, ...payload }) : createPlanTaskAction(payload);
    run.then((r: { error?: string; shifted?: DateShift[]; delta?: number }) => {
      if (r.error) { toast.error(r.error); return; }
      setDraft(null);
      toast.success("Saved.");
      if (editing && r.shifted && r.shifted.length > 0) announceCascade({ id: editing.id, startDate: editing.startDate, dueDate: editing.dueDate }, payload.name, r.shifted, r.delta ?? 0, true);
      router.refresh();
    }).finally(() => setBusy(false));
  }

  if (list.length === 0) {
    return (
      <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground">No project plan yet.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => structural(() => seedDefaultPlanAction(projectId, engagementId), "Standard plan added.")} disabled={busy}><WandSparklesIcon className="size-3.5" /> Add standard SAP plan</Button>
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> Add task</Button>
        </div>
        <p className="text-xs text-muted-foreground">The standard plan seeds a schedule (Mobilize → Analysis → Build → Validate → Go-live) you can drag, resize and edit.</p>
        {draft && <PlanDialog draft={draft} setDraft={setDraft} busy={busy} phases={phases} people={people} milestones={milestones} list={list} wbsById={new Map()} onSave={saveDraft} onDelete={() => {}} />}
      </CardContent></Card>
    );
  }

  // ---- flat rows (phase summary + tasks) ----
  type PhaseRow = { kind: "phase"; label: string; wbs: string; s: number; e: number; progress: number; slip: number | null; est: number; actual: number; hasEst: boolean; hasActual: boolean };
  type FlatRow = PhaseRow | { kind: "task"; wbs: string; t: PlanRow };
  const flat: FlatRow[] = [];
  const wbsById = new Map<string, string>();
  phases.forEach((phase, pi) => {
    const group = list.filter((t) => (t.phase ?? "General") === phase);
    const starts = group.map((t) => dnum(t.startDate)).filter((n) => !Number.isNaN(n));
    const ends = group.map((t) => dnum(t.dueDate ?? t.startDate)).filter((n) => !Number.isNaN(n));
    flat.push({
      kind: "phase", label: phase, wbs: String(pi + 1),
      s: starts.length ? Math.min(...starts) : NaN, e: ends.length ? Math.max(...ends) : NaN,
      progress: weightedProgress(group).percent, slip: planSlip(group),
      est: group.reduce((s, t) => s + (t.estimatedHours ?? 0), 0), actual: group.reduce((s, t) => s + (t.actualHours ?? 0), 0),
      hasEst: group.some((t) => t.estimatedHours != null), hasActual: group.some((t) => t.actualHours != null),
    });
    group.forEach((t, ti) => { const wbs = `${pi + 1}.${ti + 1}`; wbsById.set(t.id, wbs); flat.push({ kind: "task", wbs, t }); });
  });
  const overall = weightedProgress(list);
  const baselinedCount = list.filter((t) => t.baselineStart || t.baselineEnd).length;
  const unbaselinedCount = list.filter((t) => !t.baselineStart && !t.baselineEnd && (t.startDate || t.dueDate)).length;
  const overallSlip = planSlip(list);
  const nameById = new Map(list.map((t) => [t.id, t.name]));

  // Timeline window: current AND baseline dates, so a ghost baseline bar is never clipped. Snapped to
  // whole months so the first/last items always have room and the month headers line up.
  const allTimes = list.flatMap((t) => [dnum(t.startDate), dnum(t.dueDate), dnum(t.baselineStart), dnum(t.baselineEnd)]).filter((n) => !Number.isNaN(n));
  const hasTimeline = allTimes.length > 0;
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

  const linkLabel = (t: PlanRow) => {
    if (!t.milestoneId) return null;
    const m = msById.get(t.milestoneId);
    const task = t.taskId ? m?.tasks.find((x) => x.id === t.taskId) : null;
    return `${m?.name ?? "Milestone"}${task ? ` · ${task.name}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <datalist id="plan-owner-people">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      <Card className="overflow-hidden p-0 gap-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b p-4">
          <div>
            <CardTitle className="text-base">Project plan</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {overall.percent}% complete · {overall.basis === "effort" ? "weighted by estimated hours" : overall.basis === "duration" ? "weighted by duration" : "plain average"} · drag a bar to move it, an edge to resize. Tasks that follow it move with it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {baselinedCount === 0 ? (
              <Button
                size="sm" variant="outline" disabled={busy || unbaselinedCount === 0}
                title="Freeze today's dates as the baseline, so slip can be measured"
                onClick={() => { if (confirm(`Freeze the current dates of ${unbaselinedCount} task${unbaselinedCount === 1 ? "" : "s"} as the baseline?\n\nA baseline is never changed afterwards: moving or editing a task only changes its current dates, and the difference shows as slip.`)) structural(() => setPlanBaselineAction(projectId, engagementId), "Baseline set."); }}
              ><FlagIcon className="size-3.5" /> Set baseline</Button>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" title="Latest current due date vs latest baseline end, over baselined tasks">
                  <FlagIcon className="size-3 text-primary" /> Baselined
                  {overallSlip != null && <span className={cn("font-mono tabular-nums font-medium", overallSlip > 0 ? "text-rose-600 dark:text-rose-400" : overallSlip < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{formatSlip(overallSlip)}</span>}
                </span>
                {unbaselinedCount > 0 && (
                  <Button size="sm" variant="ghost" disabled={busy} title="Baseline the tasks added since — existing baselines stay as they are"
                    onClick={() => { if (confirm(`Baseline ${unbaselinedCount} task${unbaselinedCount === 1 ? "" : "s"} added since? Existing baselines are not touched.`)) structural(() => setPlanBaselineAction(projectId, engagementId), "Baseline updated."); }}
                  >Baseline {unbaselinedCount} new</Button>
                )}
              </>
            )}
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
                <ColHead label="Slip" align="right" title="Due date vs baseline end" onResize={(e) => startResize("slip", e)} />
                <ColHead label="Actual / est." title="Approved hours on the linked milestone (or task) vs the estimate" onResize={(e) => startResize("effort", e)} />
                <div />
              </div>
              {flat.map((r, i) => r.kind === "phase" ? (
                <div key={`p${i}`} className="grid items-center border-b bg-muted/25 text-sm font-semibold" style={{ height: ROW_H, gridTemplateColumns: grid }}>
                  <div className="px-2 text-xs text-muted-foreground">{r.wbs}</div>
                  <div className="px-1.5 truncate">{r.label}</div>
                  <div /><div /><div />
                  <div className="px-1 text-right text-xs tabular-nums text-muted-foreground">{r.progress}%</div>
                  <div className="px-1 text-right"><SlipChip days={r.slip} /></div>
                  <div className="px-1">{(r.hasEst || r.hasActual) && <EffortBar actual={r.hasActual ? r.actual : null} est={r.hasEst ? r.est : null} />}</div>
                  <div />
                </div>
              ) : (
                <TaskLeftRow key={r.t.id} wbs={r.wbs} t={r.t} busy={busy} grid={grid} onPatch={patch} people={people}
                  predecessor={r.t.dependsOnId ? `${wbsById.get(r.t.dependsOnId) ?? ""} ${nameById.get(r.t.dependsOnId) ?? "(removed)"}`.trim() : null}
                  link={linkLabel(r.t)}
                  onEdit={() => setDraft(draftOf(r.t))}
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
                        : (
                          <>
                            <BaselineGhost t={r.t} dayW={dayW} xOf={xOf} />
                            <TaskBar t={r.t} dayW={dayW} xOf={xOf} onPatch={patch} />
                          </>
                        )}
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
        <PlanDialog
          draft={draft} setDraft={setDraft} busy={busy} phases={phases} people={people} milestones={milestones} list={list} wbsById={wbsById} onSave={saveDraft}
          onDelete={() => { const id = draft.id!; setDraft(null); if (confirm("Delete this plan item?")) structural(() => deletePlanTaskAction(id), "Deleted."); }}
        />
      )}
    </div>
  );
}

// ---- add / edit dialog ----
function PlanDialog({ draft, setDraft, busy, phases, people, milestones, list, wbsById, onSave, onDelete }: {
  draft: Draft; setDraft: (d: Draft | null) => void; busy: boolean; phases: string[]; people: OwnerPerson[]; milestones: PlanMilestone[];
  list: PlanRow[]; wbsById: Map<string, string>; onSave: () => void; onDelete: () => void;
}) {
  const ms = draft.milestoneId ? milestones.find((m) => m.id === draft.milestoneId) ?? null : null;
  const selfId = draft.id ?? "__new__";
  // Only predecessors that keep the chain loop-free are offered (the server refuses the rest anyway).
  const predecessors = list.filter((t) => t.id !== draft.id && !wouldCreateCycle(list, selfId, t.id));
  const predLabel = (t: PlanRow) => `${wbsById.get(t.id) ? `${wbsById.get(t.id)} ` : ""}${t.name}`;
  const current = draft.id ? list.find((t) => t.id === draft.id) : undefined;
  const msItems = [{ value: NONE, label: "Not linked" }, ...milestones.map((m) => ({ value: m.id, label: m.name }))];
  const taskItems = [{ value: NONE, label: "Whole milestone" }, ...(ms?.tasks ?? []).map((t) => ({ value: t.id, label: t.name }))];
  const predItems = [{ value: NONE, label: "None" }, ...predecessors.map((t) => ({ value: t.id, label: predLabel(t) }))];
  return (
    <Dialog open disablePointerDismissal onOpenChange={(v) => !v && setDraft(null)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center justify-between"><span>{draft.id ? "Edit plan item" : "Add plan item"}</span>{draft.id && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDelete}><Trash2Icon className="size-3.5" /></Button>}</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label>Phase</Label><Input value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value })} placeholder="e.g. Build" list="plan-phases" /><datalist id="plan-phases">{phases.map((p) => <option key={p} value={p} />)}</datalist></div>
            <div className="flex items-center gap-2 mt-6"><input id="pl-ms" type="checkbox" className="size-4" checked={draft.isMilestone} onChange={(e) => setDraft({ ...draft, isMilestone: e.target.checked })} /><Label htmlFor="pl-ms">Milestone / gate (e.g. Go-live)</Label></div>
          </div>
          <div className="flex flex-col gap-1.5"><Label>Task name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={300} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5"><Label>Owner</Label><OwnerCombobox value={{ owner: draft.owner, ownerUserId: draft.ownerUserId }} people={people} onChange={(v) => setDraft({ ...draft, ...v })} placeholder="Who's working on it" /></div>
            <div className="flex flex-col gap-1.5"><Label>Start</Label><Input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></div>
            <div className="flex flex-col gap-1.5"><Label>{draft.isMilestone ? "Date" : "Due"}</Label><Input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} /></div>
          </div>
          {current && (current.baselineStart || current.baselineEnd) && (
            <p className="-mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><FlagIcon className="size-3" /> Baseline {fmtIso(current.baselineStart)} → {fmtIso(current.baselineEnd)} — frozen, edits don&apos;t move it.</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label>Progress %</Label><Input type="number" min="0" max="100" value={draft.progress} onChange={(e) => setDraft({ ...draft, progress: e.target.value })} disabled={draft.isMilestone} /></div>
            <div className="flex flex-col gap-1.5"><Label>Status</Label>
              <Select value={draft.status} items={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} onValueChange={(v) => setDraft({ ...draft, status: (v as PlanTaskStatus) ?? "NOT_STARTED" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5"><Label>Starts after (finish-to-start)</Label>
            <Select value={draft.dependsOnId ?? NONE} items={predItems} onValueChange={(v) => setDraft({ ...draft, dependsOnId: !v || v === NONE ? null : String(v) })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{predItems.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">When that task moves, this one moves by the same number of days.</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-3 flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5"><Label>Estimated hours</Label><Input type="number" min="0" step="0.5" value={draft.estimatedHours} onChange={(e) => setDraft({ ...draft, estimatedHours: e.target.value })} placeholder="e.g. 40" disabled={draft.isMilestone} /></div>
              <div className="col-span-2 flex flex-col gap-1.5"><Label>Time logged on</Label>
                <Select value={draft.milestoneId ?? NONE} items={msItems} onValueChange={(v) => setDraft({ ...draft, milestoneId: !v || v === NONE ? null : String(v), taskId: null })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{msItems.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {ms && ms.tasks.length > 0 && (
              <div className="flex flex-col gap-1.5"><Label>Task</Label>
                <Select value={draft.taskId ?? NONE} items={taskItems} onValueChange={(v) => setDraft({ ...draft, taskId: !v || v === NONE ? null : String(v) })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{taskItems.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">Approved hours on the milestone{ms && ms.tasks.length > 0 ? " (or just that task)" : ""} show as actuals against the estimate. When every task has an estimate, progress is weighted by effort.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- small cells ----
function ColHead({ label, align, title, onResize }: { label: string; align?: "right"; title?: string; onResize: (e: React.PointerEvent) => void }) {
  return (
    <div className={cn("relative truncate px-1", align === "right" && "text-right")} title={title}>
      {label}
      <span onPointerDown={onResize} className="absolute -right-0.5 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-primary/50" title="Drag to resize" />
    </div>
  );
}

function SlipChip({ days, title }: { days: number | null; title?: string }) {
  if (days == null) return <span className="text-xs text-muted-foreground/50" title={title ?? "No baseline"}>—</span>;
  return (
    <span title={title} className={cn("rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums",
      days > 0 ? "bg-rose-500/12 text-rose-600 dark:text-rose-400" : days < 0 ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>{formatSlip(days)}</span>
  );
}

function EffortBar({ actual, est, title }: { actual: number | null; est: number | null; title?: string }) {
  const over = actual != null && est != null && est > 0 && actual > est;
  const pct = actual != null && est != null && est > 0 ? Math.min(100, (actual / est) * 100) : 0;
  return (
    <div className="flex flex-col gap-0.5" title={title}>
      <span className={cn("font-mono text-[10px] tabular-nums leading-none", over ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        {actual != null ? fmtH(actual) : "–"} / {est != null ? `${fmtH(est)}h` : "–"}
      </span>
      {est != null && est > 0 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", over ? "bg-rose-500" : "bg-blue-500")} style={{ width: `${actual != null ? pct : 0}%` }} /></div>
      )}
    </div>
  );
}

function TaskLeftRow({ wbs, t, busy, grid, onPatch, onEdit, onMove, onDelete, people, predecessor, link }: {
  wbs: string; t: PlanRow; busy: boolean; grid: string; people: OwnerPerson[]; predecessor: string | null; link: string | null;
  onPatch: (t: PlanRow, p: Partial<PlanRow>) => void; onEdit: () => void; onMove: (dir: "up" | "down") => void; onDelete: () => void;
}) {
  const eff = derive(t.progress, t.status);
  const slip = slipDays(t.dueDate, t.baselineEnd);
  const effortTitle = link
    ? `Approved hours on ${link}${t.estimatedHours != null ? ` vs ${fmtH(t.estimatedHours)}h estimated` : " — no estimate yet"}`
    : t.estimatedHours != null ? "Estimate only — link a milestone under More… to see actual hours" : undefined;
  return (
    <div className="group grid items-center border-b text-sm hover:bg-muted/25" style={{ height: ROW_H, gridTemplateColumns: grid }}>
      <div className="px-2 text-xs text-muted-foreground">{wbs}</div>
      <div className="flex items-center gap-1 pl-4 pr-1">
        <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[eff])} title={STATUS_LABEL[eff]} />
        {t.isMilestone && <DiamondIcon className="size-3 shrink-0 text-primary" />}
        {predecessor && <span title={`Starts after ${predecessor}`} className="shrink-0"><Link2Icon className="size-3 text-muted-foreground" /></span>}
        <input defaultValue={t.name} key={`n${t.name}`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) onPatch(t, { name: v }); }} className={cn(CELL, "min-w-0 flex-1")} />
      </div>
      <input defaultValue={t.owner ?? ""} key={`o${t.owner}`} placeholder="—" title={t.ownerUserId ? "Linked to a person" : "Free text — type a colleague's exact name to link them"} list="plan-owner-people" onBlur={(e) => { const r = resolveOwner(e.target.value, people); if ((r.owner || null) !== t.owner || r.ownerUserId !== t.ownerUserId) onPatch(t, { owner: r.owner || null, ownerUserId: r.ownerUserId }); }} className={cn(CELL, "w-full text-xs", t.ownerUserId && "text-emerald-700 dark:text-emerald-400")} />
      <input type="date" defaultValue={t.startDate ?? ""} key={`s${t.startDate}`} onChange={(e) => onPatch(t, { startDate: e.target.value || null })} className={cn(CELL, "w-full text-xs")} />
      <input type="date" defaultValue={t.dueDate ?? ""} key={`d${t.dueDate}`} onChange={(e) => onPatch(t, { dueDate: e.target.value || null })} className={cn(CELL, "w-full text-xs")} />
      {t.isMilestone
        ? <div className="px-1 text-right text-xs text-muted-foreground/50">—</div>
        : <input type="number" min={0} max={100} defaultValue={t.progress} key={`pr${t.progress}`} onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); if (v !== t.progress) onPatch(t, { progress: v, status: derive(v, t.status) }); }} className={cn(CELL, "w-full text-right text-xs tabular-nums")} />}
      <div className="px-1 text-right"><SlipChip days={slip} title={t.baselineEnd ? `Baseline ${fmtIso(t.baselineStart)} → ${fmtIso(t.baselineEnd)}` : "No baseline"} /></div>
      <div className="px-1">
        {t.isMilestone || (t.estimatedHours == null && t.actualHours == null)
          ? <span className="text-xs text-muted-foreground/50" title={t.isMilestone ? undefined : "Set an estimate and link a milestone under More…"}>—</span>
          : <EffortBar actual={t.actualHours} est={t.estimatedHours} title={effortTitle} />}
      </div>
      <div className="flex items-center justify-end gap-0.5 pr-1 opacity-0 group-hover:opacity-100">
        <button type="button" title="Up" onClick={() => onMove("up")} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronUpIcon className="size-3.5" /></button>
        <button type="button" title="Down" onClick={() => onMove("down")} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronDownIcon className="size-3.5" /></button>
        <button type="button" title="More…" onClick={onEdit} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2Icon className="size-3.5" /></button>
        <button type="button" title="Delete" onClick={onDelete} disabled={busy} className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"><Trash2Icon className="size-3.5" /></button>
      </div>
    </div>
  );
}

// ---- baseline: a thin ghost under the bar (or a hollow diamond for a gate), never draggable ----
function BaselineGhost({ t, dayW, xOf }: { t: PlanRow; dayW: number; xOf: (ms: number) => number }) {
  const bs = dnum(t.baselineStart); const be = dnum(t.baselineEnd);
  const s = !Number.isNaN(bs) ? bs : be; const e = !Number.isNaN(be) ? be : bs;
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const title = `Baseline ${fmtMs(Math.min(s, e))} → ${fmtMs(Math.max(s, e))}`;
  if (t.isMilestone) {
    if (t.dueDate && dnum(t.dueDate) === e) return null; // on baseline: the real diamond covers it
    return <div className="pointer-events-none absolute top-1/2 size-3 -translate-y-1/2 rotate-45 border border-dashed border-muted-foreground/60" style={{ left: xOf(e) + dayW / 2 - 6 }} title={title} />;
  }
  return <div className="pointer-events-none absolute h-[3px] rounded-full bg-muted-foreground/35" style={{ left: xOf(Math.min(s, e)), width: Math.max(dayW, xOf(Math.max(s, e)) - xOf(Math.min(s, e)) + dayW), top: ROW_H / 2 + 10 }} title={title} />;
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
