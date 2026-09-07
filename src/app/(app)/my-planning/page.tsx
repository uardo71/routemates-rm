import { addWeeks, format } from "date-fns";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { startOfWeek, parseDateParam, toDateParam } from "@/lib/week";
import { WeekJump } from "@/components/week-jump";
import { loadCapacity, toCapacityCells } from "@/lib/capacity-data";
import { PlannerGrid, type PlanAssignmentRow, type PlanCellInit, type PlanResourceRow } from "../planning/planner-grid";

const WEEKS_VISIBLE = 8;

// A read-only mirror of /planning, scoped to just the signed-in user — everyone gets this
// (no planning:view gate), since it's how an individual sees what their PM has scheduled for
// them, not a management tool. canManage is always false on the grid: no edits, no drag handles.
export default async function MyPlanningPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  const user = await requireUser();

  const timelineStart = parseDateParam(start);
  const weeks = Array.from({ length: WEEKS_VISIBLE }, (_, i) => addWeeks(timelineStart, i));
  const timelineEnd = addWeeks(timelineStart, WEEKS_VISIBLE);

  const assignments = await prisma.assignment.findMany({
    where: { userId: user.id, status: { not: "CLOSED" } },
    include: {
      milestone: {
        include: {
          project: { include: { client: true } },
          tasks: { select: { id: true, name: true, assigneeId: true, estimatedHours: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: { startDate: "asc" },
  });

  const assignmentIds = assignments.map((a) => a.id);
  const planEntries = await prisma.assignmentPlan.findMany({
    where: { assignmentId: { in: assignmentIds }, weekStartDate: { gte: timelineStart, lt: timelineEnd } },
  });
  const initialCells: PlanCellInit[] = planEntries.map((p) => ({
    assignmentId: p.assignmentId,
    taskId: p.taskId,
    weekStartDate: toDateParam(p.weekStartDate),
    hours: Number(p.hours),
  }));

  const rows: PlanAssignmentRow[] = assignments.map((a) => ({
    id: a.id,
    label: `${a.milestone.project.name} — ${a.milestone.name}`,
    allocatedHours: a.allocatedHours ? Number(a.allocatedHours) : null,
    startDate: toDateParam(a.startDate),
    endDate: toDateParam(a.endDate),
    tasks: a.milestone.tasks
      .filter((t) => t.assigneeId === user.id)
      .map((t) => ({ id: t.id, name: t.name, estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null })),
  }));
  const resources: PlanResourceRow[] = [{ userId: user.id, userName: "My schedule", role: user.role, assignments: rows }];

  // Same real capacity the Resource planner uses, so my own week reads honestly during a holiday
  // week or while I'm on approved leave.
  const capacity = toCapacityCells(
    await loadCapacity(
      user.companyId,
      [user.id],
      weeks.map((w) => toDateParam(startOfWeek(w))),
      timelineStart,
      timelineEnd,
    ),
  );

  const prevStart = toDateParam(addWeeks(timelineStart, -WEEKS_VISIBLE));
  const nextStart = toDateParam(addWeeks(timelineStart, WEEKS_VISIBLE));
  const qs = (s: string) => `/my-planning?start=${s}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My planning</h1>
          <p className="text-sm text-muted-foreground">
            What you&apos;re scheduled to work on — read-only. Ask your PM to update it in Planning.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={qs(prevStart)} className="hover:underline">
            ← Prev
          </Link>
          <span className="font-medium">
            {format(timelineStart, "MMM d")} – {format(addWeeks(timelineStart, WEEKS_VISIBLE - 1), "MMM d, yyyy")}
          </span>
          <Link href={qs(nextStart)} className="hover:underline">
            Next →
          </Link>
          <WeekJump currentDate={toDateParam(timelineStart)} basePath="/my-planning" dateParam="start" />
        </div>
      </div>

      <PlannerGrid
        // Remount on range change so the grid re-reads initialCells (its useState(initial) is only
        // read at mount) — otherwise a soft Prev/Next navigation shows the new range as empty until a
        // hard refresh. Same fix as /planning.
        key={toDateParam(timelineStart)}
        weeks={weeks.map((w) => ({ key: toDateParam(startOfWeek(w)), label: format(w, "MMM d") }))}
        resources={resources}
        initialCells={initialCells}
        capacity={capacity}
        canManage={false}
        todayWeekKey={toDateParam(startOfWeek(new Date()))}
      />
    </div>
  );
}
