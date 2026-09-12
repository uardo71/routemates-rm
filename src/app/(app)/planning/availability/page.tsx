import { addWeeks, format } from "date-fns";
import { BackLink } from "@/components/back-link";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { startOfWeek, parseDateParam, toDateParam } from "@/lib/week";
import { parseList } from "@/lib/utils";
import { WeekJump } from "@/components/week-jump";
import { loadCapacity, capacityKey } from "@/lib/capacity-data";
import { freeHours, bookingStatus } from "@/lib/capacity";
import { AvailabilityFilters } from "./availability-filters";
import { AvailabilityTable, type AvailabilityRow } from "./availability-table";

const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 26;

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; weeks?: string; roles?: string; minFree?: string }>;
}) {
  const { start, weeks: weeksParam, roles: rolesParam, minFree: minFreeParam } = await searchParams;
  const user = await requirePermission("planning:view");

  const timelineStart = parseDateParam(start);
  const weeksVisible = Math.min(MAX_WEEKS, Math.max(1, Number(weeksParam) || DEFAULT_WEEKS));
  const timelineEnd = addWeeks(timelineStart, weeksVisible);
  const weeks = Array.from({ length: weeksVisible }, (_, i) => addWeeks(timelineStart, i));
  const weekKeys = weeks.map((w) => toDateParam(startOfWeek(w)));

  const selectedRoles = parseList(rolesParam ?? null);
  const minFree = Math.max(0, Number(minFreeParam) || 0);

  const people = await prisma.user.findMany({
    where: {
      companyId: user.companyId,
      active: true,
      role: { not: "CUSTOMER" }, // portal accounts aren't staff and have no capacity
      ...(selectedRoles.length > 0 ? { role: { in: selectedRoles as never[] } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  // Planned hours for the range, per assignment/task/week. An assignment's effective weekly total
  // is the task rollup when any task carries hours, else the assignment-level cell — the same rule
  // the planner grid uses, so the two screens can never disagree about how booked someone is.
  const plans = await prisma.assignmentPlan.findMany({
    where: {
      weekStartDate: { gte: timelineStart, lt: timelineEnd },
      assignment: { user: { companyId: user.companyId }, status: { not: "CLOSED" } },
    },
    select: { assignmentId: true, taskId: true, weekStartDate: true, hours: true, assignment: { select: { userId: true } } },
  });

  const assignmentWeek = new Map<string, { userId: string; level: number; taskSum: number }>();
  for (const p of plans) {
    const key = `${p.assignmentId}|${toDateParam(p.weekStartDate)}`;
    const entry = assignmentWeek.get(key) ?? { userId: p.assignment.userId, level: 0, taskSum: 0 };
    if (p.taskId) entry.taskSum += Number(p.hours);
    else entry.level += Number(p.hours);
    assignmentWeek.set(key, entry);
  }
  const bookedByUserWeek = new Map<string, number>();
  for (const [key, entry] of assignmentWeek) {
    const weekKey = key.split("|")[1];
    const effective = entry.taskSum > 0 ? entry.taskSum : entry.level;
    const k = capacityKey(entry.userId, weekKey);
    bookedByUserWeek.set(k, (bookedByUserWeek.get(k) ?? 0) + effective);
  }

  const capacity = await loadCapacity(user.companyId, people.map((p) => p.id), weekKeys, timelineStart, timelineEnd);

  const rows: AvailabilityRow[] = people.map((p) => {
    const cells = weekKeys.map((weekKey) => {
      const cap = capacity.get(capacityKey(p.id, weekKey));
      const available = cap?.available ?? 0;
      const booked = Math.round((bookedByUserWeek.get(capacityKey(p.id, weekKey)) ?? 0) * 100) / 100;
      return {
        weekKey,
        booked,
        available,
        free: freeHours(booked, available),
        status: bookingStatus(booked, available),
        holiday: cap?.holiday ?? 0,
        leave: cap?.leave ?? 0,
        gross: cap?.gross ?? 0,
      };
    });
    return {
      userId: p.id,
      userName: p.name,
      role: p.role,
      cells,
      totalFree: Math.round(cells.reduce((s, c) => s + c.free, 0) * 100) / 100,
    };
  });

  // "At least N free hours" keeps anyone with that much spare in ANY visible week — the question is
  // "who has a gap I could fill", not "who is idle the whole quarter".
  const filtered = minFree > 0 ? rows.filter((r) => r.cells.some((c) => c.free >= minFree)) : rows;

  const qs = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { start: toDateParam(timelineStart), weeks: String(weeksVisible), roles: selectedRoles.join(","), minFree: minFree > 0 ? String(minFree) : "", ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/planning/availability?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/planning" label="Planning" />
      <div className="flex flex-wrap items-center justify-between gap-3 -mt-3">
        <div>
          <h1 className="text-2xl font-semibold">Availability</h1>
          <p className="text-sm text-muted-foreground">
            Free hours per person per week, across every project — capacity minus public holidays,
            approved leave and what&apos;s already planned. The bench view.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={qs({ start: toDateParam(addWeeks(timelineStart, -weeksVisible)) })} className="hover:underline">← Prev</Link>
          <span className="font-medium">
            {format(timelineStart, "MMM d")} – {format(addWeeks(timelineStart, weeksVisible - 1), "MMM d, yyyy")}
          </span>
          <Link href={qs({ start: toDateParam(addWeeks(timelineStart, weeksVisible)) })} className="hover:underline">Next →</Link>
          <WeekJump
            currentDate={toDateParam(timelineStart)}
            basePath="/planning/availability"
            dateParam="start"
            extraParams={{ weeks: String(weeksVisible), roles: rolesParam, minFree: minFreeParam }}
          />
          <Link href="/planning" className="text-muted-foreground hover:underline">Planner →</Link>
        </div>
      </div>

      <AvailabilityFilters
        currentRoles={selectedRoles}
        currentWeeks={weeksVisible}
        currentMinFree={minFree}
        maxWeeks={MAX_WEEKS}
      />

      <AvailabilityTable
        rows={filtered}
        totalPeople={rows.length}
        weeks={weeks.map((w) => ({ key: toDateParam(startOfWeek(w)), label: format(w, "MMM d") }))}
        todayWeekKey={toDateParam(startOfWeek(new Date()))}
        minFree={minFree}
      />
    </div>
  );
}
