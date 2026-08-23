"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrentWeekBadge } from "@/components/current-week-badge";
import { cn } from "@/lib/utils";
import { getPublicHoliday } from "@/lib/holidays";
import { savePlanAction, updateAssignmentEndDateAction, type PlanCell } from "./actions";

// Week columns render at a fixed w-20 (5rem = 80px) — used to translate horizontal drag
// distance into "how many weeks" for the extend-end-date handle below.
const COLUMN_WIDTH_PX = 80;

/** Names of any Albanian public holidays that fall within the 7 days starting `weekKey`
 *  ("yyyy-MM-dd") — the Planner is week-granularity, so holidays are surfaced per-week rather
 *  than per-day like the Time Entry grid. */
function holidaysInWeek(weekKey: string): string[] {
  const start = new Date(`${weekKey}T00:00:00`);
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const holiday = getPublicHoliday(addDays(start, i));
    if (holiday) names.push(holiday);
  }
  return names;
}

const CAPACITY_PER_WEEK = 40;

/** End (Sunday) of the week starting at `weekKey` ("yyyy-MM-dd"), as the same string format —
 *  ISO date strings sort lexicographically the same as chronologically, so callers can compare
 *  these directly against an assignment's startDate/endDate without round-tripping through Date. */
function weekEndKey(weekKey: string): string {
  return format(addDays(new Date(`${weekKey}T00:00:00`), 6), "yyyy-MM-dd");
}

/** Whether `weekKey` falls at least partially within the assignment's own start/end date
 *  window — mirrors the same "pickable" check the Time Entry grid uses for its assignment
 *  picker (see time/page.tsx), so planning and time entry never disagree about which weeks are
 *  valid for a given assignment. */
function weekInAssignmentWindow(a: PlanAssignmentRow, weekKey: string): boolean {
  return a.startDate <= weekEndKey(weekKey) && a.endDate >= weekKey;
}

export type PlanTaskRow = { id: string; name: string; estimatedHours: number | null };
export type PlanAssignmentRow = {
  id: string;
  label: string;
  allocatedHours: number | null;
  startDate: string;
  endDate: string;
  /** This person's tasks on the milestone — the ones that can be planned under this assignment. */
  tasks: PlanTaskRow[];
};
export type PlanResourceRow = { userId: string; userName: string; role: string; assignments: PlanAssignmentRow[] };
export type PlanCellInit = { assignmentId: string; taskId: string | null; weekStartDate: string; hours: number };

// Composite key for a plan cell in local state — taskId "" means the assignment-level cell.
function cellKey(assignmentId: string, taskId: string | null, weekKey: string): string {
  return `${assignmentId}|${taskId ?? ""}|${weekKey}`;
}

function capacityTone(hours: number): string {
  if (hours === 0) return "text-muted-foreground";
  if (hours > CAPACITY_PER_WEEK) return "bg-red-500/20 text-red-700 dark:text-red-400 font-semibold";
  if (hours === CAPACITY_PER_WEEK) return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold";
  return "bg-amber-400/25 text-amber-800 dark:text-amber-300 font-semibold";
}

export function PlannerGrid({
  weeks,
  resources,
  initialCells,
  canManage,
  todayWeekKey,
}: {
  weeks: { key: string; label: string }[];
  resources: PlanResourceRow[];
  initialCells: PlanCellInit[];
  canManage: boolean;
  /** The current calendar week's key — draws a highlighted column border there so "now" is
   *  visible at a glance across an 8-week grid. */
  todayWeekKey?: string;
}) {
  function weekBorderClass(weekKey: string): string {
    return weekKey === todayWeekKey ? "border-l-2 border-l-primary" : "border-l";
  }
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Keyed by userId (resource rows) AND assignmentId (assignment rows) — the id spaces don't collide.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [labelWidth, setLabelWidth] = useState(280);
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(null);

  function onResizePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    resizeState.current = { startX: e.clientX, startWidth: labelWidth };
  }
  function onResizePointerMove(e: React.PointerEvent) {
    if (!resizeState.current) return;
    const delta = e.clientX - resizeState.current.startX;
    setLabelWidth(Math.min(640, Math.max(180, resizeState.current.startWidth + delta)));
  }
  function onResizePointerUp() {
    resizeState.current = null;
  }

  // Drag-to-resize: grabbing the handle at the right edge of an assignment's last editable week
  // and dragging moves its endDate — right to extend, left to shrink. This only *stages* the
  // change locally (like an hour-cell edit) — nothing is written until "Save plan" is clicked,
  // same as every other edit on this grid. The server is the actual authority when that save
  // happens (extending is capped at the project's own end date; shrinking is capped at the
  // latest submitted/approved time entry on the assignment).
  const extendDrag = useRef<{ assignmentId: string; startX: number; baseIndex: number } | null>(null);
  const [extendPreview, setExtendPreview] = useState<{ assignmentId: string; toIndex: number } | null>(null);
  const [pendingEndDates, setPendingEndDates] = useState<Record<string, string>>({});

  function effectiveEndDate(a: PlanAssignmentRow): string {
    return pendingEndDates[a.id] ?? a.endDate;
  }

  function onExtendPointerDown(e: React.PointerEvent, assignmentId: string, baseIndex: number) {
    e.preventDefault();
    // setPointerCapture can throw if the browser has no active pointer session for this id
    // (observed with scripted/synthetic pointer events during testing) — falling back to
    // uncaptured event delivery is a reasonable degradation rather than losing the whole drag.
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // no-op — see comment above
    }
    extendDrag.current = { assignmentId, startX: e.clientX, baseIndex };
    setExtendPreview({ assignmentId, toIndex: baseIndex });
  }
  function onExtendPointerMove(e: React.PointerEvent) {
    const drag = extendDrag.current;
    if (!drag) return;
    const weeksMoved = Math.round((e.clientX - drag.startX) / COLUMN_WIDTH_PX);
    const toIndex = Math.min(weeks.length - 1, Math.max(0, drag.baseIndex + weeksMoved));
    setExtendPreview({ assignmentId: drag.assignmentId, toIndex });
  }
  function onExtendPointerUp() {
    const drag = extendDrag.current;
    extendDrag.current = null;
    const preview = extendPreview;
    setExtendPreview(null);
    if (!drag || !preview || preview.toIndex === drag.baseIndex) return;

    const newEndDate = weekEndKey(weeks[preview.toIndex].key);
    setPendingEndDates((prev) => ({ ...prev, [drag.assignmentId]: newEndDate }));
  }

  const initial = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of initialCells) map[cellKey(c.assignmentId, c.taskId, c.weekStartDate)] = c.hours;
    return map;
  }, [initialCells]);
  const [cells, setCells] = useState(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const assignmentById = useMemo(() => {
    const m = new Map<string, PlanAssignmentRow>();
    for (const r of resources) for (const a of r.assignments) m.set(a.id, a);
    return m;
  }, [resources]);

  function cellValue(assignmentId: string, taskId: string | null, weekKey: string): number {
    return cells[cellKey(assignmentId, taskId, weekKey)] ?? 0;
  }
  function setCellValue(assignmentId: string, taskId: string | null, weekKey: string, value: number) {
    const k = cellKey(assignmentId, taskId, weekKey);
    setCells((prev) => ({ ...prev, [k]: value }));
    setDirty((prev) => new Set(prev).add(k));
  }

  // Sum of a person's task cells for a week (the task-mode total for that assignment/week).
  function taskWeekSum(a: PlanAssignmentRow, weekKey: string): number {
    return a.tasks.reduce((s, t) => s + cellValue(a.id, t.id, weekKey), 0);
  }
  // A week is "task-mode" as soon as any of the assignment's tasks has hours in it.
  function assignmentIsTaskMode(a: PlanAssignmentRow, weekKey: string): boolean {
    return a.tasks.some((t) => cellValue(a.id, t.id, weekKey) > 0);
  }
  // Effective planned hours for an assignment in a week — task rollup if task-mode, else the
  // assignment-level cell. This is what capacity totals and reports sum to.
  function assignmentWeekTotal(a: PlanAssignmentRow, weekKey: string): number {
    return assignmentIsTaskMode(a, weekKey) ? taskWeekSum(a, weekKey) : cellValue(a.id, null, weekKey);
  }
  function resourceWeekTotal(resource: PlanResourceRow, weekKey: string): number {
    return resource.assignments.reduce((sum, a) => sum + assignmentWeekTotal(a, weekKey), 0);
  }

  const pendingEndDateCount = Object.keys(pendingEndDates).length;

  function handleSave() {
    if (dirty.size === 0 && pendingEndDateCount === 0) {
      toast.info("Nothing to save.");
      return;
    }

    // Warn when a week that had an assignment-level total is being replaced by task hours whose
    // sum differs — a deliberate convert, but surfaced so it isn't a silent change.
    const convertedPairs = new Set<string>();
    for (const key of dirty) {
      const [assignmentId, taskIdRaw, weekKey] = key.split("|");
      if (taskIdRaw) convertedPairs.add(`${assignmentId}::${weekKey}`);
    }
    let mismatch = 0;
    for (const pair of convertedPairs) {
      const [assignmentId, weekKey] = pair.split("::");
      const a = assignmentById.get(assignmentId);
      if (!a || !assignmentIsTaskMode(a, weekKey)) continue;
      const wasLevel = initial[cellKey(assignmentId, null, weekKey)] ?? 0;
      if (wasLevel > 0 && Math.abs(wasLevel - taskWeekSum(a, weekKey)) > 0.001) mismatch++;
    }

    startTransition(async () => {
      // End-date changes first — an hour cell in a newly-extended week would otherwise fail the
      // server's "within the assignment's window" check, since that window hasn't moved yet.
      for (const [assignmentId, endDate] of Object.entries(pendingEndDates)) {
        const result = await updateAssignmentEndDateAction({ assignmentId, endDate });
        if (result.error) {
          toast.error(result.error);
          return;
        }
      }
      if (dirty.size > 0) {
        const cellsToSave: PlanCell[] = [...dirty].map((key) => {
          const [assignmentId, taskIdRaw, weekStartDate] = key.split("|");
          const taskId = taskIdRaw || null;
          return { assignmentId, taskId, weekStartDate, hours: cellValue(assignmentId, taskId, weekStartDate) };
        });
        const result = await savePlanAction(cellsToSave);
        if (result.error) {
          toast.error(result.error);
          return;
        }
      }
      if (mismatch > 0) {
        toast.warning(`${mismatch} week${mismatch === 1 ? "" : "s"} converted to task-level hours with a different total than the assignment-level number they replaced.`);
      }
      toast.success("Plan saved.");
      setDirty(new Set());
      setPendingEndDates({});
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground bg-muted/50">
              <th
                className="p-2 sticky left-0 bg-muted/50 z-10 relative"
                style={{ width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}
              >
                Resource / Assignment / Task
                <div
                  onPointerDown={onResizePointerDown}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onResizePointerUp}
                  className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50"
                  title="Drag to resize"
                />
              </th>
              {weeks.map((w) => {
                const holidays = holidaysInWeek(w.key);
                return (
                  <th
                    key={w.key}
                    className={cn("p-2 w-20 text-center font-medium", weekBorderClass(w.key), holidays.length > 0 && "bg-muted/70")}
                  >
                    {w.key === todayWeekKey && (
                      <div className="mb-1 flex justify-center">
                        <CurrentWeekBadge weekStartDate={w.key} />
                      </div>
                    )}
                    {w.label}
                    {holidays.length > 0 && (
                      <div
                        className="truncate text-[9px] font-normal normal-case text-muted-foreground"
                        title={`Albanian public holiday: ${holidays.join(", ")}`}
                      >
                        🇦🇱 {holidays.length > 1 ? `${holidays.length} holidays` : "holiday"}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const isOpen = expanded[r.userId] ?? false;
              return (
                <Fragment key={r.userId}>
                  <tr className="border-t bg-card">
                    <td
                      className="p-2 sticky left-0 bg-card z-10"
                      style={{ width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}
                    >
                      <button
                        type="button"
                        className="flex items-center gap-1.5 text-left w-full"
                        onClick={() => setExpanded((prev) => ({ ...prev, [r.userId]: !isOpen }))}
                      >
                        <span className={cn("transition-transform text-muted-foreground text-xs shrink-0", isOpen && "rotate-90")}>
                          ▸
                        </span>
                        <span className="font-medium truncate">{r.userName}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {r.role}
                        </Badge>
                      </button>
                    </td>
                    {weeks.map((w) => {
                      const total = resourceWeekTotal(r, w.key);
                      return (
                        <td
                          key={w.key}
                          className={cn("p-2 text-center tabular-nums", capacityTone(total), weekBorderClass(w.key))}
                        >
                          {total > 0 ? total : "—"}
                        </td>
                      );
                    })}
                  </tr>
                  {isOpen &&
                    r.assignments.map((a) => {
                      const isAssignmentOpen = expanded[a.id] ?? false;
                      const hasTasks = a.tasks.length > 0;
                      const hasPendingEndDate = a.id in pendingEndDates;
                      // effectiveA reflects a not-yet-saved drag change immediately, so newly
                      // extended/shrunk weeks flip between editable and blocked right away
                      // instead of only after the next Save + page refresh.
                      const effectiveA: PlanAssignmentRow = { ...a, endDate: effectiveEndDate(a) };
                      // Last visible week this assignment is currently editable for — that's
                      // where the extend handle attaches. -1 if none of the visible weeks are
                      // in-window at all.
                      let lastInWindowIdx = -1;
                      weeks.forEach((w, i) => {
                        if (weekInAssignmentWindow(effectiveA, w.key)) lastInWindowIdx = i;
                      });
                      const showHandle = canManage && lastInWindowIdx >= 0;
                      const preview = extendPreview?.assignmentId === a.id ? extendPreview : null;

                      return (
                        <Fragment key={a.id}>
                          <tr className="border-t">
                            <td
                              className="p-2 pl-8 sticky left-0 bg-background z-10"
                              style={{ width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}
                            >
                              <div className="flex items-start gap-1.5">
                                {hasTasks ? (
                                  <button
                                    type="button"
                                    className="mt-0.5 shrink-0 text-muted-foreground text-xs"
                                    onClick={() => setExpanded((prev) => ({ ...prev, [a.id]: !isAssignmentOpen }))}
                                    title={isAssignmentOpen ? "Collapse tasks" : "Expand to plan by task"}
                                  >
                                    <span className={cn("inline-block transition-transform", isAssignmentOpen && "rotate-90")}>▸</span>
                                  </button>
                                ) : (
                                  <span className="w-3 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="truncate" title={a.label}>
                                    {a.label}
                                  </div>
                                  {a.allocatedHours !== null && (
                                    <div className="text-xs text-muted-foreground">cap {a.allocatedHours}h</div>
                                  )}
                                  {hasTasks && !isAssignmentOpen && (
                                    <div className="text-[10px] text-muted-foreground">
                                      {a.tasks.length} task{a.tasks.length === 1 ? "" : "s"} · expand to plan by task
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            {weeks.map((w, i) => {
                              const windowOk = weekInAssignmentWindow(effectiveA, w.key);
                              const taskMode = assignmentIsTaskMode(a, w.key);
                              const levelValue = cellValue(a.id, null, w.key);
                              const displayValue = taskMode ? taskWeekSum(a, w.key) : levelValue;
                              // While dragging this assignment's handle: cells between the old
                              // boundary and the drag preview flip meaning depending on direction.
                              const pendingAdd = preview && preview.toIndex > lastInWindowIdx && i > lastInWindowIdx && i <= preview.toIndex;
                              const pendingRemove = preview && preview.toIndex < lastInWindowIdx && i > preview.toIndex && i <= lastInWindowIdx;
                              const handle =
                                showHandle && i === lastInWindowIdx ? (
                                  <div
                                    onPointerDown={(e) => onExtendPointerDown(e, a.id, i)}
                                    onPointerMove={onExtendPointerMove}
                                    onPointerUp={onExtendPointerUp}
                                    className={cn(
                                      "absolute top-0 right-0 h-full w-2 cursor-ew-resize touch-none hover:bg-primary/40 active:bg-primary/60 z-10",
                                      hasPendingEndDate && "bg-primary/50"
                                    )}
                                    title={
                                      hasPendingEndDate
                                        ? `Unsaved: now ends ${effectiveA.endDate} — click Save plan to apply, or keep dragging to adjust.`
                                        : "Drag to move this assignment's end date — right to extend, left to shrink. Doesn't take effect until you Save plan."
                                    }
                                  />
                                ) : null;

                              // Assignment-level editable cell — only when the week isn't already
                              // broken down by task (task cells win; edit those instead).
                              if (canManage && windowOk && !taskMode) {
                                return (
                                  <td key={w.key} className={cn("p-1 relative", weekBorderClass(w.key))}>
                                    <Input
                                      type="number"
                                      step="any"
                                      min="0"
                                      className={cn("h-8 text-center", pendingRemove && "border-destructive bg-destructive/10")}
                                      value={levelValue || ""}
                                      onChange={(e) => setCellValue(a.id, null, w.key, Number(e.target.value) || 0)}
                                    />
                                    {handle}
                                  </td>
                                );
                              }
                              const blocked = canManage && !windowOk;
                              return (
                                <td key={w.key} className={cn("p-1 relative", weekBorderClass(w.key))}>
                                  <div
                                    className={cn(
                                      "h-8 flex items-center justify-center text-center tabular-nums",
                                      taskMode && "italic text-muted-foreground",
                                      pendingAdd ? "rounded bg-primary/20 text-primary" : blocked && "rounded bg-muted/50 text-muted-foreground"
                                    )}
                                    title={
                                      taskMode
                                        ? "Planned by task — expand the assignment to edit the breakdown"
                                        : blocked
                                          ? `Outside this assignment's window (${effectiveA.startDate} – ${effectiveA.endDate})`
                                          : undefined
                                    }
                                  >
                                    {displayValue || "—"}
                                  </div>
                                  {handle}
                                </td>
                              );
                            })}
                          </tr>

                          {isAssignmentOpen &&
                            a.tasks.map((task) => (
                              <tr key={`${a.id}-${task.id}`} className="border-t bg-muted/20">
                                <td
                                  className="p-2 pl-14 sticky left-0 bg-background z-10"
                                  style={{ width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}
                                >
                                  <div className="truncate text-xs" title={task.name}>
                                    {task.name}
                                  </div>
                                  {task.estimatedHours !== null && (
                                    <div className="text-[10px] text-muted-foreground">est {task.estimatedHours}h</div>
                                  )}
                                </td>
                                {weeks.map((w) => {
                                  const windowOk = weekInAssignmentWindow(effectiveA, w.key);
                                  const value = cellValue(a.id, task.id, w.key);
                                  if (canManage && windowOk) {
                                    return (
                                      <td key={w.key} className={cn("p-1", weekBorderClass(w.key))}>
                                        <Input
                                          type="number"
                                          step="any"
                                          min="0"
                                          className="h-8 text-center"
                                          value={value || ""}
                                          onChange={(e) => setCellValue(a.id, task.id, w.key, Number(e.target.value) || 0)}
                                        />
                                      </td>
                                    );
                                  }
                                  const blocked = canManage && !windowOk;
                                  return (
                                    <td key={w.key} className={cn("p-1", weekBorderClass(w.key))}>
                                      <div
                                        className={cn(
                                          "h-8 flex items-center justify-center text-center tabular-nums",
                                          blocked && "rounded bg-muted/50 text-muted-foreground"
                                        )}
                                      >
                                        {value || "—"}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  {isOpen && r.assignments.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={weeks.length + 1} className="p-2 pl-8 text-xs text-muted-foreground">
                        No assignments.
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {resources.length === 0 && (
              <tr>
                <td colSpan={weeks.length + 1} className="p-6 text-center text-sm text-muted-foreground">
                  No assignments to plan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave} disabled={pending || (dirty.size === 0 && pendingEndDateCount === 0)}>
            {pending ? "Saving..." : "Save plan"}
          </Button>
          {(dirty.size > 0 || pendingEndDateCount > 0) && (
            <span className="text-xs text-muted-foreground">
              Unsaved changes
              {pendingEndDateCount > 0 ? ` (including ${pendingEndDateCount} assignment date change${pendingEndDateCount === 1 ? "" : "s"})` : ""}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-400" /> Under 40h
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-emerald-500" /> Exactly 40h
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500" /> Over 40h
        </span>
      </div>
    </div>
  );
}
