"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon, ListIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPublicHoliday } from "@/lib/holidays";
import { cn } from "@/lib/utils";

export type CalLeaveType = "VACATION" | "SICK" | "PATERNITY" | "MATERNITY";
export type CalLeave = {
  userId: string;
  userName: string;
  type: CalLeaveType;
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
  tentative?: boolean; // pending (not yet approved)
};

// Literal Tailwind classes (never build these dynamically — Tailwind must see them to compile).
const TYPE_DOT: Record<CalLeaveType, string> = {
  VACATION: "bg-amber-500",
  SICK: "bg-rose-500",
  PATERNITY: "bg-sky-500",
  MATERNITY: "bg-violet-500",
};
const TYPE_BAR: Record<CalLeaveType, string> = {
  VACATION: "bg-amber-400",
  SICK: "bg-rose-400",
  PATERNITY: "bg-sky-400",
  MATERNITY: "bg-violet-400",
};
const TYPE_CHIP: Record<CalLeaveType, string> = {
  VACATION: "bg-amber-100 text-amber-900 border-amber-300",
  SICK: "bg-rose-100 text-rose-900 border-rose-300",
  PATERNITY: "bg-sky-100 text-sky-900 border-sky-300",
  MATERNITY: "bg-violet-100 text-violet-900 border-violet-300",
};
const TYPE_LABEL: Record<CalLeaveType, string> = {
  VACATION: "Vacation",
  SICK: "Sick",
  PATERNITY: "Paternity",
  MATERNITY: "Maternity",
};

const firstName = (name: string) => name.split(" ")[0];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AbsenceCalendar({ leave }: { leave: CalLeave[] }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [view, setView] = useState<"month" | "timeline">("month");

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);

  // Who is out on a given yyyy-MM-dd — string comparison keeps it timezone-proof (ISO dates sort
  // lexicographically), so no Date-parsing drift between day cells and stored leave ranges.
  const outOn = useMemo(() => {
    return (dayStr: string) => leave.filter((l) => l.startDate <= dayStr && dayStr <= l.endDate);
  }, [leave]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Previous month">
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span className="min-w-[9rem] text-center font-medium">{format(cursor, "MMMM yyyy")}</span>
          <Button variant="ghost" size="sm" onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Next month">
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(startOfMonth(new Date()))}>
            Today
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Legend />
          <div className="flex rounded-md border overflow-hidden">
            <button
              type="button"
              onClick={() => setView("month")}
              className={cn("flex items-center gap-1 px-2.5 py-1 text-xs", view === "month" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <CalendarDaysIcon className="size-3.5" /> Month
            </button>
            <button
              type="button"
              onClick={() => setView("timeline")}
              className={cn("flex items-center gap-1 px-2.5 py-1 text-xs border-l", view === "timeline" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <ListIcon className="size-3.5" /> Timeline
            </button>
          </div>
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid monthStart={monthStart} monthEnd={monthEnd} outOn={outOn} />
      ) : (
        <Timeline monthStart={monthStart} monthEnd={monthEnd} leave={leave} outOn={outOn} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden md:flex items-center gap-2.5 text-[11px] text-muted-foreground">
      {(Object.keys(TYPE_DOT) as CalLeaveType[]).map((t) => (
        <span key={t} className="flex items-center gap-1">
          <span className={cn("size-2 rounded-full", TYPE_DOT[t])} />
          {TYPE_LABEL[t]}
        </span>
      ))}
    </div>
  );
}

function MonthGrid({
  monthStart,
  monthEnd,
  outOn,
}: {
  monthStart: Date;
  monthEnd: Date;
  outOn: (dayStr: string) => CalLeave[];
}) {
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[42rem]">
        <div className="grid grid-cols-7 border-t border-l rounded-t-md overflow-hidden">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-r border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l">
          {days.map((d) => {
            const dayStr = format(d, "yyyy-MM-dd");
            const inMonth = isSameMonth(d, monthStart);
            const weekend = isWeekend(d);
            const holiday = getPublicHoliday(d);
            const people = outOn(dayStr);
            const shown = people.slice(0, 3);
            const extra = people.length - shown.length;
            return (
              <div
                key={dayStr}
                className={cn(
                  "border-r border-b min-h-[5.5rem] p-1.5 flex flex-col gap-1",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  weekend && inMonth && "bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      isToday(d) && "flex items-center justify-center size-5 rounded-full bg-primary text-primary-foreground font-medium",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                  {holiday && (
                    <span className="truncate max-w-[5.5rem] text-[10px] text-rose-600" title={holiday}>
                      🇦🇱 {holiday}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  {shown.map((p, i) => (
                    <span
                      key={`${p.userId}-${p.type}-${i}`}
                      title={`${p.userName} — ${TYPE_LABEL[p.type]}${p.tentative ? " (pending)" : ""}`}
                      className={cn(
                        "flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-none truncate",
                        TYPE_CHIP[p.type],
                        p.tentative && "opacity-60 border-dashed",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full shrink-0", TYPE_DOT[p.type])} />
                      <span className="truncate">{firstName(p.userName)}</span>
                    </span>
                  ))}
                  {extra > 0 && <span className="text-[10px] text-muted-foreground pl-1">+{extra} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Timeline({
  monthStart,
  monthEnd,
  leave,
  outOn,
}: {
  monthStart: Date;
  monthEnd: Date;
  leave: CalLeave[];
  outOn: (dayStr: string) => CalLeave[];
}) {
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const monthStartStr = format(monthStart, "yyyy-MM-dd");
  const monthEndStr = format(monthEnd, "yyyy-MM-dd");

  // People with any leave overlapping this month, sorted by name.
  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of leave) {
      if (l.startDate <= monthEndStr && l.endDate >= monthStartStr) map.set(l.userId, l.userName);
    }
    return [...map.entries()].map(([userId, userName]) => ({ userId, userName })).sort((a, b) => a.userName.localeCompare(b.userName));
  }, [leave, monthStartStr, monthEndStr]);

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">No time off scheduled in {format(monthStart, "MMMM")}.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* header row: day numbers */}
        <div className="flex">
          <div className="w-32 shrink-0" />
          {days.map((d) => (
            <div
              key={format(d, "yyyy-MM-dd")}
              className={cn(
                "w-6 shrink-0 text-center text-[10px] tabular-nums py-1",
                isWeekend(d) && "bg-muted/40",
                isToday(d) && "font-bold text-primary",
              )}
            >
              {format(d, "d")}
            </div>
          ))}
        </div>
        {people.map((person) => (
          <div key={person.userId} className="flex items-center border-t">
            <div className="w-32 shrink-0 truncate pr-2 text-sm font-medium py-1.5" title={person.userName}>
              {person.userName}
            </div>
            {days.map((d) => {
              const dayStr = format(d, "yyyy-MM-dd");
              const entry = outOn(dayStr).find((l) => l.userId === person.userId);
              const holiday = getPublicHoliday(d);
              return (
                <div
                  key={dayStr}
                  className={cn("w-6 h-6 shrink-0 border-l first:border-l-0", isWeekend(d) && !entry && "bg-muted/40")}
                  title={entry ? `${person.userName} — ${TYPE_LABEL[entry.type]}${entry.tentative ? " (pending)" : ""}, ${format(d, "MMM d")}` : holiday ? holiday : undefined}
                >
                  {entry ? (
                    <div className={cn("w-full h-full", TYPE_BAR[entry.type], entry.tentative && "opacity-50")} />
                  ) : holiday ? (
                    <div className="w-full h-full flex items-center justify-center text-[9px] text-rose-500">•</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
