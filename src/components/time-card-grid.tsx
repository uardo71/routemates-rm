"use client";

import { useMemo } from "react";
import { addDays, format } from "date-fns";
import { cn } from "@/lib/utils";

export type TimeCardGridEntry = {
  id: string;
  date: string;
  hours: number;
  taskName: string | null;
  description: string;
  /** Whether this day's hours have been billed on an invoice. Only used when highlightUnbilled is on. */
  billed?: boolean;
};

/** Read-only day-by-day breakdown (one row per task, Mon–Sun columns, a Notes column) shared by
 *  the approvals detail dialog and any other "view this TimeCard's week" surface. When
 *  highlightUnbilled is set, days whose hours are not yet on an invoice are tinted amber. */
export function TimeCardGrid({
  weekStartDate,
  entries,
  totalHours,
  highlightUnbilled = false,
}: {
  weekStartDate: string;
  entries: TimeCardGridEntry[];
  totalHours: number;
  highlightUnbilled?: boolean;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStartDate), i)), [weekStartDate]);

  const taskRows = useMemo(() => {
    const byTask = new Map<string, { taskName: string | null; entries: TimeCardGridEntry[] }>();
    for (const e of entries) {
      const key = e.taskName ?? "_none";
      if (!byTask.has(key)) byTask.set(key, { taskName: e.taskName, entries: [] });
      byTask.get(key)!.entries.push(e);
    }
    return [...byTask.values()];
  }, [entries]);

  function entryFor(rowEntries: TimeCardGridEntry[], date: string): TimeCardGridEntry | null {
    return rowEntries.find((x) => x.date === date) ?? null;
  }

  return (
    <div className="flex flex-col gap-2">
      {highlightUnbilled && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block size-3 rounded-sm bg-amber-500/15 ring-1 ring-amber-500/40" />
          Amber days are approved but not yet on an invoice.
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground bg-muted/50">
            <th className="p-2 min-w-28">Task</th>
            {days.map((d) => (
              <th key={d.toISOString()} className="p-2 w-14 text-center border-l font-medium">
                {format(d, "EEE")}
                <div className="text-[11px] font-normal">{format(d, "M/d")}</div>
              </th>
            ))}
            <th className="p-2 w-14 text-center border-l">Sum</th>
            <th className="p-2 min-w-56 text-left border-l">Notes</th>
          </tr>
        </thead>
        <tbody>
          {taskRows.map((row) => {
            const rowSum = row.entries.reduce((s, e) => s + e.hours, 0);
            const rowNotes = row.entries.filter((e) => e.description.trim().length > 0);
            return (
              <tr key={row.taskName ?? "_none"} className="border-t align-top">
                <td className="p-2">{row.taskName ?? "—"}</td>
                {days.map((d) => {
                  const date = format(d, "yyyy-MM-dd");
                  const e = entryFor(row.entries, date);
                  const unbilled = highlightUnbilled && e != null && e.billed === false;
                  const cellTitle = unbilled
                    ? "Not yet billed" + (e?.description ? " — " + e.description : "")
                    : e?.description || undefined;
                  return (
                    <td
                      key={date}
                      className={cn("p-2 text-center tabular-nums border-l relative", unbilled && "bg-amber-500/15 font-semibold text-amber-700 dark:text-amber-400")}
                      title={cellTitle}
                    >
                      {e ? e.hours : "—"}
                      {e?.description && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary/60" />}
                    </td>
                  );
                })}
                <td className="p-2 text-center font-medium tabular-nums border-l">{rowSum}</td>
                <td className="p-2 text-xs text-muted-foreground border-l">
                  {rowNotes.length === 0 ? (
                    "—"
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {rowNotes.map((e) => (
                        <div key={e.id}>
                          <span className="font-medium text-foreground">{format(new Date(e.date), "EEE")}:</span> {e.description}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          <tr className="border-t font-medium bg-muted/30">
            <td className="p-2">Total</td>
            {days.map((d) => {
              const date = format(d, "yyyy-MM-dd");
              const total = entries.filter((e) => e.date === date).reduce((s, e) => s + e.hours, 0);
              return (
                <td key={date} className="p-2 text-center tabular-nums border-l">
                  {total || "—"}
                </td>
              );
            })}
            <td className="p-2 text-center tabular-nums border-l">{totalHours}</td>
            <td className="border-l" />
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}
