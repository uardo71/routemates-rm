"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CurrentWeekBadge } from "@/components/current-week-badge";
import { cn } from "@/lib/utils";

export type ActualsAssignmentRow = { id: string; label: string };
export type ActualsResourceRow = { userId: string; userName: string; role: string; assignments: ActualsAssignmentRow[] };
export type ActualsCellInit = { assignmentId: string; weekStartDate: string; planned: number; actual: number };
export type WeekColumn = { key: string; weekNumber: number; dateLabel: string };

// Severity ranking is deliberate, per explicit user direction: no planning at all is worse than a
// plan that simply wasn't submitted against, because it signals the PM never scheduled the work in
// the first place (a process gap) rather than a resource just not having logged time yet against a
// real plan (a compliance gap, one step less severe). Every row here is already a real, active
// assignment (that's how it made it into this grid), so a week with nothing planned is still a
// real gap even if nothing was logged either — always flagged, never silently blank.
function statusTone(planned: number, actual: number): string {
  if (planned === 0) return "bg-rose-600/25 text-rose-800 dark:text-rose-300 font-semibold"; // no planning — worst
  if (actual === 0) return "bg-red-500/20 text-red-700 dark:text-red-400 font-semibold"; // no TC — bad
  if (actual < planned) return "bg-amber-400/25 text-amber-800 dark:text-amber-300 font-semibold"; // partial — half bad
  return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold"; // matches/exceeds — good
}

function Cell({ planned, actual, todayCol }: { planned: number; actual: number; todayCol: boolean }) {
  return (
    <td
      className={cn("p-2 text-center tabular-nums", statusTone(planned, actual), todayCol ? "border-l-2 border-l-primary" : "border-l")}
      title={`Planned: ${planned}h · Actual: ${actual}h`}
    >
      <div className="flex flex-col items-center leading-tight text-base">
        <span>
          <span className="text-xs font-normal opacity-60">P</span> {planned}
        </span>
        <span>
          <span className="text-xs font-normal opacity-60">A</span> {actual}
        </span>
      </div>
    </td>
  );
}

export function ActualsGrid({
  weeks,
  resources,
  cells,
  todayWeekKey,
}: {
  weeks: WeekColumn[];
  resources: ActualsResourceRow[];
  cells: ActualsCellInit[];
  todayWeekKey: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const cellMap = useMemo(() => {
    const map = new Map<string, { planned: number; actual: number }>();
    for (const c of cells) map.set(`${c.assignmentId}|${c.weekStartDate}`, { planned: c.planned, actual: c.actual });
    return map;
  }, [cells]);

  function cellFor(assignmentId: string, weekKey: string) {
    return cellMap.get(`${assignmentId}|${weekKey}`) ?? { planned: 0, actual: 0 };
  }
  function resourceWeekTotals(resource: ActualsResourceRow, weekKey: string) {
    const totals = resource.assignments.reduce(
      (acc, a) => {
        const c = cellFor(a.id, weekKey);
        acc.planned += c.planned;
        acc.actual += c.actual;
        return acc;
      },
      { planned: 0, actual: 0 }
    );
    // Round the rollup too, so summing per-assignment cells can't reintroduce float noise.
    return { planned: Math.round(totals.planned * 100) / 100, actual: Math.round(totals.actual * 100) / 100 };
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-muted-foreground bg-muted/50">
              <th className="p-2 sticky left-0 bg-muted/50 z-10 min-w-56">Resource / Assignment</th>
              {weeks.map((w) => (
                <th
                  key={w.key}
                  className={cn("p-2 w-28 text-center font-medium", w.key === todayWeekKey ? "border-l-2 border-l-primary" : "border-l")}
                >
                  {w.key === todayWeekKey && (
                    <div className="mb-1 flex justify-center">
                      <CurrentWeekBadge weekStartDate={w.key} />
                    </div>
                  )}
                  Wk {w.weekNumber}
                  <div className="text-[11px] font-normal">{w.dateLabel}</div>
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
                    <td className="p-2 sticky left-0 bg-card z-10 min-w-56">
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
                      const totals = resourceWeekTotals(r, w.key);
                      return <Cell key={w.key} planned={totals.planned} actual={totals.actual} todayCol={w.key === todayWeekKey} />;
                    })}
                  </tr>
                  {isOpen &&
                    r.assignments.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="p-2 pl-8 sticky left-0 bg-background z-10 min-w-56">
                          <div className="truncate" title={a.label}>
                            {a.label}
                          </div>
                        </td>
                        {weeks.map((w) => {
                          const c = cellFor(a.id, w.key);
                          return <Cell key={w.key} planned={c.planned} actual={c.actual} todayCol={w.key === todayWeekKey} />;
                        })}
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
                  No scheduled or actual hours in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span className="text-foreground font-medium">
          <span className="font-semibold">P</span> = Planned · <span className="font-semibold">A</span> = Actual (submitted)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-600" /> No planning
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-red-500" /> Not submitted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-400" /> Partial
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-emerald-500" /> Matches
        </span>
      </div>
    </div>
  );
}
