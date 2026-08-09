"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrentWeekBadge } from "@/components/current-week-badge";
import { cn } from "@/lib/utils";
import { savePlanAction, type PlanCell } from "./actions";

const CAPACITY_PER_WEEK = 40;

export type PlanAssignmentRow = { id: string; label: string; allocatedHours: number | null };
export type PlanResourceRow = { userId: string; userName: string; role: string; assignments: PlanAssignmentRow[] };
export type PlanCellInit = { assignmentId: string; weekStartDate: string; hours: number };

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

  const initial = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const c of initialCells) {
      map[c.assignmentId] ??= {};
      map[c.assignmentId][c.weekStartDate] = c.hours;
    }
    return map;
  }, [initialCells]);
  const [cells, setCells] = useState(initial);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  function cellValue(assignmentId: string, weekKey: string): number {
    return cells[assignmentId]?.[weekKey] ?? 0;
  }

  function setCellValue(assignmentId: string, weekKey: string, value: number) {
    setCells((prev) => ({ ...prev, [assignmentId]: { ...prev[assignmentId], [weekKey]: value } }));
    setDirty((prev) => new Set(prev).add(`${assignmentId}|${weekKey}`));
  }

  function resourceWeekTotal(resource: PlanResourceRow, weekKey: string): number {
    return resource.assignments.reduce((sum, a) => sum + cellValue(a.id, weekKey), 0);
  }

  function handleSave() {
    if (dirty.size === 0) {
      toast.info("Nothing to save.");
      return;
    }
    const cellsToSave: PlanCell[] = [...dirty].map((key) => {
      const [assignmentId, weekStartDate] = key.split("|");
      return { assignmentId, weekStartDate, hours: cellValue(assignmentId, weekStartDate) };
    });
    startTransition(async () => {
      const result = await savePlanAction(cellsToSave);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Plan saved.");
        setDirty(new Set());
        router.refresh();
      }
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
                Resource / Assignment
                <div
                  onPointerDown={onResizePointerDown}
                  onPointerMove={onResizePointerMove}
                  onPointerUp={onResizePointerUp}
                  className="absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/50"
                  title="Drag to resize"
                />
              </th>
              {weeks.map((w) => (
                <th key={w.key} className={cn("p-2 w-20 text-center font-medium", weekBorderClass(w.key))}>
                  {w.key === todayWeekKey && (
                    <div className="mb-1 flex justify-center">
                      <CurrentWeekBadge weekStartDate={w.key} />
                    </div>
                  )}
                  {w.label}
                </th>
              ))}
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
                    r.assignments.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td
                          className="p-2 pl-8 sticky left-0 bg-background z-10"
                          style={{ width: labelWidth, minWidth: labelWidth, maxWidth: labelWidth }}
                        >
                          <div className="truncate" title={a.label}>
                            {a.label}
                          </div>
                          {a.allocatedHours !== null && (
                            <div className="text-xs text-muted-foreground">cap {a.allocatedHours}h</div>
                          )}
                        </td>
                        {weeks.map((w) => (
                          <td key={w.key} className={cn("p-1", weekBorderClass(w.key))}>
                            {canManage ? (
                              <Input
                                type="number"
                                step="0.5"
                                min="0"
                                className="h-8 text-center"
                                value={cellValue(a.id, w.key) || ""}
                                onChange={(e) => setCellValue(a.id, w.key, Number(e.target.value) || 0)}
                              />
                            ) : (
                              <div className="text-center tabular-nums">{cellValue(a.id, w.key) || "—"}</div>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
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
          <Button size="sm" onClick={handleSave} disabled={pending || dirty.size === 0}>
            {pending ? "Saving..." : "Save plan"}
          </Button>
          {dirty.size > 0 && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
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
