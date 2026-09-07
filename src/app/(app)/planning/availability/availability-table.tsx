"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BookingStatus } from "@/lib/capacity";

export type AvailabilityCell = {
  weekKey: string;
  booked: number;
  available: number;
  free: number;
  status: BookingStatus;
  holiday: number;
  leave: number;
  gross: number;
};

export type AvailabilityRow = {
  userId: string;
  userName: string;
  role: string;
  cells: AvailabilityCell[];
  totalFree: number;
};

/** Free hours are the headline here, so the scale runs the other way from the planner: a big
 *  number is a person on the bench, not a problem. */
function freeTone(cell: AvailabilityCell): string {
  if (cell.available <= 0) return "text-muted-foreground/50"; // nothing to give: holiday week or on leave
  if (cell.status === "OVER") return "bg-red-500/15 text-red-700 dark:text-red-400 font-semibold";
  if (cell.free <= 0) return "text-muted-foreground";
  if (cell.free >= cell.available) return "bg-sky-500/20 text-sky-800 dark:text-sky-300 font-semibold"; // fully free
  return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
}

function cellTitle(name: string, cell: AvailabilityCell): string {
  const parts = [`${name} · week of ${cell.weekKey}`, `${cell.booked}h booked of ${cell.available}h available`];
  const deductions: string[] = [];
  if (cell.holiday > 0) deductions.push(`−${cell.holiday}h public holiday`);
  if (cell.leave > 0) deductions.push(`−${cell.leave}h approved leave`);
  parts.push(deductions.length > 0 ? `${cell.gross}h contracted ${deductions.join(" ")}` : `${cell.gross}h contracted week`);
  if (cell.status === "OVER") parts.push(`Over-allocated by ${Math.round((cell.booked - cell.available) * 100) / 100}h.`);
  return parts.join(" · ");
}

export function AvailabilityTable({
  rows,
  totalPeople,
  weeks,
  todayWeekKey,
  minFree,
}: {
  rows: AvailabilityRow[];
  totalPeople: number;
  weeks: { key: string; label: string }[];
  todayWeekKey?: string;
  minFree: number;
}) {
  const weekBorder = (key: string) => (key === todayWeekKey ? "border-l-2 border-l-primary" : "border-l");
  // Company bench per week — how many hours the business has spare in total.
  const companyFree = weeks.map((w) => {
    const idx = rows[0]?.cells.findIndex((c) => c.weekKey === w.key) ?? -1;
    if (idx < 0) return 0;
    return Math.round(rows.reduce((s, r) => s + (r.cells[idx]?.free ?? 0), 0) * 100) / 100;
  });
  const grandTotal = Math.round(companyFree.reduce((s, v) => s + v, 0) * 100) / 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              <th className="p-2 text-left sticky left-0 bg-muted/50 z-10 min-w-52">Person</th>
              {weeks.map((w) => (
                <th key={w.key} className={cn("p-2 w-20 text-center font-medium", weekBorder(w.key))}>
                  {w.label}
                </th>
              ))}
              <th className="p-2 w-24 text-center border-l-2">Free total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-t hover:bg-muted/30">
                <td className="p-2 sticky left-0 bg-card z-10">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{r.userName}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{r.role}</Badge>
                  </div>
                </td>
                {r.cells.map((c) => (
                  <td
                    key={c.weekKey}
                    className={cn("p-2 text-center tabular-nums", freeTone(c), weekBorder(c.weekKey))}
                    title={cellTitle(r.userName, c)}
                  >
                    {c.available <= 0 ? (
                      <span title="No capacity this week">{c.leave > 0 ? "leave" : "hol."}</span>
                    ) : c.status === "OVER" ? (
                      `+${Math.round((c.booked - c.available) * 100) / 100}`
                    ) : c.free > 0 ? (
                      c.free
                    ) : (
                      "—"
                    )}
                  </td>
                ))}
                <td className="p-2 text-center tabular-nums font-medium border-l-2">{r.totalFree}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="border-t">
                <td colSpan={weeks.length + 2} className="p-8 text-center text-muted-foreground">
                  {totalPeople === 0 ? "No people match this filter." : `Nobody has ${minFree}+ free hours in any of these weeks.`}
                </td>
              </tr>
            )}
            {rows.length > 0 && (
              <tr className="border-t-2 bg-muted/40 font-medium">
                <td className="p-2 sticky left-0 bg-muted/40 z-10">Company bench</td>
                {weeks.map((w, i) => (
                  <td key={w.key} className={cn("p-2 text-center tabular-nums", weekBorder(w.key))}>
                    {companyFree[i] > 0 ? companyFree[i] : "—"}
                  </td>
                ))}
                <td className="p-2 text-center tabular-nums border-l-2">{grandTotal}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span>
          {rows.length} of {totalPeople} {totalPeople === 1 ? "person" : "people"}
          {minFree > 0 && <> with {minFree}+ free hours in a week</>}
        </span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-sky-500/20" /> fully free</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-sky-500/10" /> partly free</span>
        <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm bg-red-500/15" /> over-allocated (hours shown as +over)</span>
        <span>&ldquo;leave&rdquo; / &ldquo;hol.&rdquo; = no capacity that week</span>
      </div>
    </div>
  );
}
