"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon, DiamondIcon, WandSparklesIcon, ChevronUpIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { PlanTaskStatus } from "@prisma/client";
import { createPlanTaskAction, updatePlanTaskAction, deletePlanTaskAction, seedDefaultPlanAction, movePlanTaskAction } from "../actions";

export type PlanRow = {
  id: string;
  phase: string | null;
  name: string;
  owner: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  status: PlanTaskStatus;
  isMilestone: boolean;
};

const STATUSES: PlanTaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"];
const STATUS_LABEL: Record<PlanTaskStatus, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Completed", BLOCKED: "Blocked" };
const STATUS_BAR: Record<PlanTaskStatus, string> = { NOT_STARTED: "bg-blue-400", IN_PROGRESS: "bg-blue-500", COMPLETED: "bg-emerald-500", BLOCKED: "bg-rose-500" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
const dnum = (s: string | null) => (s ? Date.parse(`${s}T00:00:00Z`) : NaN);
const dstr = (s: string | null) => (s ? `${MONTHS[new Date(dnum(s)).getUTCMonth()]} ${new Date(dnum(s)).getUTCDate()}` : "—");

const ROW_H = 32;
const HEAD_H = 40;
const LEFT_W = 460;

type Draft = { id?: string; phase: string; name: string; owner: string; startDate: string; dueDate: string; progress: string; status: PlanTaskStatus; isMilestone: boolean };
const emptyDraft = (phase = ""): Draft => ({ phase, name: "", owner: "", startDate: "", dueDate: "", progress: "0", status: "NOT_STARTED", isMilestone: false });

export function PlanClient({ projectId, engagementId, tasks }: { projectId: string; engagementId: string | null; tasks: PlanRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);

  const phases = [...new Set(tasks.map((t) => t.phase ?? "General"))];

  function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Enter a task name.");
    const payload = {
      projectId, engagementId, phase: draft.phase || null, name: draft.name.trim(), owner: draft.owner || null,
      startDate: draft.startDate || null, dueDate: draft.dueDate || null,
      progress: draft.progress === "" ? 0 : Number(draft.progress), status: draft.status, isMilestone: draft.isMilestone,
    };
    start(async () => {
      const r = draft.id ? await updatePlanTaskAction({ id: draft.id, ...payload }) : await createPlanTaskAction(payload);
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); setDraft(null); router.refresh(); }
    });
  }
  function remove(id: string) {
    if (!confirm("Delete this plan item?")) return;
    start(async () => { const r = await deletePlanTaskAction(id); if (r.error) toast.error(r.error); else { toast.success("Deleted."); router.refresh(); } });
  }
  function edit(t: PlanRow) {
    setDraft({ id: t.id, phase: t.phase ?? "", name: t.name, owner: t.owner ?? "", startDate: t.startDate ?? "", dueDate: t.dueDate ?? "", progress: String(t.progress), status: t.status, isMilestone: t.isMilestone });
  }
  function seed() {
    start(async () => { const r = await seedDefaultPlanAction(projectId, engagementId); if (r.error) toast.error(r.error); else { toast.success("Standard plan added."); router.refresh(); } });
  }
  function move(id: string, dir: "up" | "down") {
    start(async () => { const r = await movePlanTaskAction(id, dir); if (r.error) toast.error(r.error); else router.refresh(); });
  }

  if (tasks.length === 0) {
    return (
      <Card><CardContent className="py-12 flex flex-col items-center gap-3 text-center">
        <p className="text-muted-foreground">No project plan yet.</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={seed} disabled={pending}><WandSparklesIcon className="size-3.5" /> Add standard SAP plan</Button>
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}><PlusIcon className="size-3.5" /> Add task</Button>
        </div>
        <p className="text-xs text-muted-foreground">The standard plan seeds a baseline schedule (Mobilize → Analysis → Build → Validate → Go-live) you can adjust and share.</p>
      </CardContent></Card>
    );
  }

  // ---- build flat rows (phase summary + its tasks) and the date scale ----
  type FlatRow =
    | { kind: "phase"; label: string; wbs: string; s: number; e: number; progress: number }
    | { kind: "task"; wbs: string; t: PlanRow };
  const flat: FlatRow[] = [];
  phases.forEach((phase, pi) => {
    const group = tasks.filter((t) => (t.phase ?? "General") === phase);
    const starts = group.map((t) => dnum(t.startDate)).filter((n) => !Number.isNaN(n));
    const ends = group.map((t) => dnum(t.dueDate)).filter((n) => !Number.isNaN(n));
    const real = group.filter((t) => !t.isMilestone);
    const progress = real.length ? Math.round(real.reduce((s, t) => s + t.progress, 0) / real.length) : 0;
    flat.push({ kind: "phase", label: phase, wbs: String(pi + 1), s: starts.length ? Math.min(...starts) : NaN, e: ends.length ? Math.max(...ends) : NaN, progress });
    group.forEach((t, ti) => flat.push({ kind: "task", wbs: `${pi + 1}.${ti + 1}`, t }));
  });

  const allTimes = tasks.flatMap((t) => [dnum(t.startDate), dnum(t.dueDate)]).filter((n) => !Number.isNaN(n));
  const hasTimeline = allTimes.length > 0;
  const min = hasTimeline ? Math.min(...allTimes) - 3 * DAY : 0;
  const max = hasTimeline ? Math.max(...allTimes) + 3 * DAY : 0;
  const totalDays = Math.max(1, Math.ceil((max - min) / DAY));
  const dayW = totalDays <= 60 ? 16 : totalDays <= 120 ? 10 : totalDays <= 240 ? 6 : 3.5;
  const totalW = totalDays * dayW;
  const xOf = (ms: number) => ((ms - min) / DAY) * dayW;

  const monthTicks: { label: string; x: number }[] = [];
  if (hasTimeline) {
    const d = new Date(min); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    let g = 0;
    while (d.getTime() <= max && g++ < 60) {
      monthTicks.push({ label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, x: xOf(d.getTime()) });
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Project plan</CardTitle>
          <Button size="sm" onClick={() => setDraft(emptyDraft(phases[0] ?? ""))}><PlusIcon className="size-3.5" /> Add task</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex border-t">
            {/* LEFT: task table */}
            <div className="shrink-0 border-r" style={{ width: LEFT_W }}>
              <div className="flex items-center border-b bg-muted/40 text-[11px] font-medium text-muted-foreground" style={{ height: HEAD_H }}>
                <div className="w-9 px-2 shrink-0">#</div>
                <div className="flex-1 px-1">Task</div>
                <div className="w-24 px-1 shrink-0">Owner</div>
                <div className="w-16 px-1 shrink-0">Start</div>
                <div className="w-16 px-1 shrink-0">Due</div>
                <div className="w-10 px-1 shrink-0 text-right">%</div>
              </div>
              {flat.map((r, i) => r.kind === "phase" ? (
                <div key={`p${i}`} className="flex items-center border-b bg-muted/30 text-sm font-semibold" style={{ height: ROW_H }}>
                  <div className="w-9 px-2 shrink-0 text-xs text-muted-foreground">{r.wbs}</div>
                  <div className="flex-1 px-1 truncate">{r.label}</div>
                  <div className="w-24 px-1 shrink-0" />
                  <div className="w-16 px-1 shrink-0 text-xs text-muted-foreground tabular-nums">{Number.isNaN(r.s) ? "" : dstr(new Date(r.s).toISOString().slice(0, 10))}</div>
                  <div className="w-16 px-1 shrink-0 text-xs text-muted-foreground tabular-nums">{Number.isNaN(r.e) ? "" : dstr(new Date(r.e).toISOString().slice(0, 10))}</div>
                  <div className="w-10 px-1 shrink-0 text-right text-xs tabular-nums">{r.progress}%</div>
                </div>
              ) : (
                <div key={r.t.id} className="group relative flex items-center border-b hover:bg-muted/30 cursor-pointer text-sm" style={{ height: ROW_H }} onClick={() => edit(r.t)}>
                  <div className="w-9 px-2 shrink-0 text-xs text-muted-foreground">{r.wbs}</div>
                  <div className="flex-1 px-1 truncate">{r.t.isMilestone && <DiamondIcon className="inline size-3 mr-1 text-primary" />}{r.t.name}</div>
                  <div className="w-24 px-1 shrink-0 truncate text-xs text-muted-foreground">{r.t.owner ?? "—"}</div>
                  <div className="w-16 px-1 shrink-0 text-xs text-muted-foreground tabular-nums">{dstr(r.t.startDate)}</div>
                  <div className="w-16 px-1 shrink-0 text-xs text-muted-foreground tabular-nums">{dstr(r.t.dueDate)}</div>
                  <div className="w-10 px-1 shrink-0 text-right text-xs tabular-nums">{r.t.isMilestone ? "" : `${r.t.progress}%`}</div>
                  <div className="absolute right-0 inset-y-0 hidden group-hover:flex items-center gap-0.5 pl-4 pr-1 bg-gradient-to-l from-background via-background to-transparent" onClick={(e) => e.stopPropagation()}>
                    <button type="button" title="Move up" onClick={() => move(r.t.id, "up")} disabled={pending} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronUpIcon className="size-4" /></button>
                    <button type="button" title="Move down" onClick={() => move(r.t.id, "down")} disabled={pending} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><ChevronDownIcon className="size-4" /></button>
                  </div>
                </div>
              ))}
            </div>

            {/* RIGHT: timeline */}
            <div className="flex-1 overflow-x-auto">
              {hasTimeline ? (
                <div style={{ width: totalW, minWidth: "100%" }}>
                  {/* month header + gridlines */}
                  <div className="relative border-b bg-muted/40" style={{ height: HEAD_H }}>
                    {monthTicks.map((m, i) => (
                      <div key={i} className="absolute top-0 h-full border-l border-border/70 pl-1 text-[10px] text-muted-foreground" style={{ left: m.x }}>{m.label}</div>
                    ))}
                  </div>
                  {flat.map((r, i) => {
                    const bg = <>{monthTicks.map((m, k) => <div key={k} className="absolute top-0 h-full border-l border-border/40" style={{ left: m.x }} />)}</>;
                    if (r.kind === "phase") {
                      const has = !Number.isNaN(r.s) && !Number.isNaN(r.e);
                      const left = has ? xOf(r.s) : 0;
                      const width = has ? Math.max(dayW, xOf(r.e) - left + dayW) : 0;
                      return (
                        <div key={`pb${i}`} className="relative border-b bg-muted/20" style={{ height: ROW_H }}>
                          {bg}
                          {has && (
                            <div className="absolute top-1/2 -translate-y-1/2 h-2 rounded-sm bg-foreground/70" style={{ left, width }}>
                              <div className="absolute -top-0.5 left-0 h-3 w-1 rounded-sm bg-foreground/70" />
                              <div className="absolute -top-0.5 right-0 h-3 w-1 rounded-sm bg-foreground/70" />
                            </div>
                          )}
                        </div>
                      );
                    }
                    const t = r.t;
                    const s = dnum(t.startDate), e = dnum(t.dueDate);
                    const hasD = !Number.isNaN(s) || !Number.isNaN(e);
                    const left = xOf(Number.isNaN(s) ? e : s);
                    const width = Math.max(dayW, xOf(Number.isNaN(e) ? s : e) - left + dayW);
                    return (
                      <div key={t.id} className="group relative border-b hover:bg-muted/20 cursor-pointer" style={{ height: ROW_H }} onClick={() => edit(t)}>
                        {bg}
                        {hasD && (t.isMilestone ? (
                          <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center gap-1" style={{ left: xOf(Number.isNaN(e) ? s : e) }}>
                            <div className="size-3 rotate-45 bg-primary shadow" />
                            <span className="whitespace-nowrap text-[10px] text-muted-foreground translate-x-1">{t.name}</span>
                          </div>
                        ) : (
                          <div className="absolute top-1/2 -translate-y-1/2 flex items-center gap-1.5" style={{ left }}>
                            <div className="h-3.5 rounded bg-muted overflow-hidden ring-1 ring-black/5" style={{ width }}>
                              <div className={cn("h-full", STATUS_BAR[t.status])} style={{ width: `${t.progress}%` }} />
                            </div>
                            <span className="whitespace-nowrap text-[10px] text-muted-foreground">{t.progress}%{t.owner ? ` · ${t.owner}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">Add start/due dates to your tasks to see the timeline.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <DialogHeader><DialogTitle className="flex items-center justify-between"><span>{draft.id ? "Edit plan item" : "Add plan item"}</span>{draft.id && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => { const id = draft.id!; setDraft(null); remove(id); }}><Trash2Icon className="size-3.5" /></Button>}</DialogTitle></DialogHeader>
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
              <Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
