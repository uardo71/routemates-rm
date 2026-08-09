import Link from "next/link";
import { notFound } from "next/navigation";
import { addWeeks, format, getISOWeek } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeekJump } from "@/components/week-jump";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { parseDateParam, startOfWeek, toDateParam } from "@/lib/week";
import { ActualsGrid, type ActualsCellInit, type ActualsResourceRow, type WeekColumn } from "./actuals-grid";

const WEEKS_VISIBLE = 8;

export default async function ScheduledVsActualsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const user = await requireUser();
  // Same audience as Planning (which is already company-wide for PMs, not scoped to projects they
  // personally manage) — a PM needs this exact company-wide oversight just as much as an Admin
  // does, not a narrower slice.
  if (!can(user, "planning:view")) notFound();

  const { start } = await searchParams;
  const timelineStart = parseDateParam(start);
  const timelineEnd = addWeeks(timelineStart, WEEKS_VISIBLE);

  const [plans, entries] = await Promise.all([
    prisma.assignmentPlan.findMany({
      where: {
        weekStartDate: { gte: timelineStart, lt: timelineEnd },
        assignment: { milestone: { project: { companyId: user.companyId } } },
      },
      include: { assignment: { include: { user: true, milestone: { include: { project: true } } } } },
    }),
    // Only entries whose card was actually submitted (not still DRAFT) count as "done" — a draft
    // in progress isn't yet a real signal either way.
    prisma.timeEntry.findMany({
      where: {
        date: { gte: timelineStart, lt: timelineEnd },
        timeCard: { status: { not: "DRAFT" } },
        assignment: { milestone: { project: { companyId: user.companyId } } },
      },
      include: { assignment: { include: { user: true, milestone: { include: { project: true } } } } },
    }),
  ]);

  type AssignmentInfo = { id: string; label: string; userId: string; userName: string; role: string };
  const assignmentsById = new Map<string, AssignmentInfo>();
  const cellTotals = new Map<string, { planned: number; actual: number }>();

  function ensureAssignment(a: { id: string; user: { id: string; name: string; role: string }; milestone: { name: string; project: { name: string } } }) {
    if (!assignmentsById.has(a.id)) {
      assignmentsById.set(a.id, {
        id: a.id,
        label: `${a.milestone.project.name} — ${a.milestone.name}`,
        userId: a.user.id,
        userName: a.user.name,
        role: a.user.role,
      });
    }
  }

  for (const p of plans) {
    ensureAssignment(p.assignment);
    const weekKey = toDateParam(p.weekStartDate);
    const key = `${p.assignmentId}|${weekKey}`;
    const existing = cellTotals.get(key) ?? { planned: 0, actual: 0 };
    existing.planned += Number(p.hours);
    cellTotals.set(key, existing);
  }
  for (const e of entries) {
    ensureAssignment(e.assignment);
    const weekKey = toDateParam(startOfWeek(e.date));
    const key = `${e.assignmentId}|${weekKey}`;
    const existing = cellTotals.get(key) ?? { planned: 0, actual: 0 };
    existing.actual += Number(e.hours);
    cellTotals.set(key, existing);
  }

  const cells: ActualsCellInit[] = [...cellTotals.entries()].map(([key, totals]) => {
    const [assignmentId, weekStartDate] = key.split("|");
    return { assignmentId, weekStartDate, ...totals };
  });

  const resourcesMap = new Map<string, ActualsResourceRow>();
  for (const a of assignmentsById.values()) {
    if (!resourcesMap.has(a.userId)) {
      resourcesMap.set(a.userId, { userId: a.userId, userName: a.userName, role: a.role, assignments: [] });
    }
    resourcesMap.get(a.userId)!.assignments.push({ id: a.id, label: a.label });
  }
  const resources = [...resourcesMap.values()].sort((a, b) => a.userName.localeCompare(b.userName));

  const weekDates = Array.from({ length: WEEKS_VISIBLE }, (_, i) => addWeeks(timelineStart, i));
  const weeks: WeekColumn[] = weekDates.map((w) => ({
    key: toDateParam(startOfWeek(w)),
    weekNumber: getISOWeek(w),
    dateLabel: format(w, "MMM d"),
  }));

  const prevStart = toDateParam(addWeeks(timelineStart, -WEEKS_VISIBLE));
  const nextStart = toDateParam(addWeeks(timelineStart, WEEKS_VISIBLE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scheduled vs actuals</h1>
          <p className="text-sm text-muted-foreground">
            What PMs have planned per assignment per week, compared against what&apos;s actually been submitted.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`/admin/scheduled-vs-actuals?start=${prevStart}`} className="hover:underline">
            ← Prev
          </Link>
          <span className="font-medium">
            {format(timelineStart, "MMM d")} – {format(addWeeks(timelineStart, WEEKS_VISIBLE - 1), "MMM d, yyyy")}
          </span>
          <Link href={`/admin/scheduled-vs-actuals?start=${nextStart}`} className="hover:underline">
            Next →
          </Link>
          <WeekJump currentDate={toDateParam(timelineStart)} basePath="/admin/scheduled-vs-actuals" dateParam="start" extraParams={{}} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By resource / week</CardTitle>
        </CardHeader>
        <CardContent>
          <ActualsGrid weeks={weeks} resources={resources} cells={cells} todayWeekKey={toDateParam(startOfWeek(new Date()))} />
        </CardContent>
      </Card>
    </div>
  );
}
