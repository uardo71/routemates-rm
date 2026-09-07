import { addWeeks, format } from "date-fns";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STAFF_ONLY } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { startOfWeek, parseDateParam, toDateParam } from "@/lib/week";
import { parseList } from "@/lib/utils";
import { WeekJump } from "@/components/week-jump";
import { PlannerFilters } from "./planner-filters";
import { loadCapacity, toCapacityCells } from "@/lib/capacity-data";
import { PlannerGrid, type PlanAssignmentRow, type PlanCellInit, type PlanResourceRow } from "./planner-grid";

const WEEKS_VISIBLE = 8;

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; projects?: string; roles?: string }>;
}) {
  const { start, projects: projectsParam, roles: rolesParam } = await searchParams;
  const user = await requirePermission("planning:view");

  const timelineStart = parseDateParam(start);
  const weeks = Array.from({ length: WEEKS_VISIBLE }, (_, i) => addWeeks(timelineStart, i));
  const timelineEnd = addWeeks(timelineStart, WEEKS_VISIBLE);

  const isAdmin = user.role === "ADMIN";
  const canManage = isAdmin || user.role === "PM";

  const selectedProjectIds = parseList(projectsParam ?? null);
  const selectedRoles = parseList(rolesParam ?? null);

  // Every active person shows up here, not just people who already have an assignment — you
  // can't plan someone with nothing assigned yet, but you still need to see that they exist (a
  // role filter narrows this list; a project filter only narrows which assignments show under
  // each person, not who's listed at all).
  const [allUsers, assignments, projects] = await Promise.all([
    prisma.user.findMany({
      where: {
        companyId: user.companyId,
        active: true,
        // Portal (CUSTOMER) accounts are not staff — never resources on the grid.
        ...STAFF_ONLY,
        ...(selectedRoles.length > 0 ? { role: { in: selectedRoles as never[] } } : {}),
      },
      orderBy: { name: "asc" },
    }),
    // A PM plans capacity for the whole company, not just people on projects they personally
    // manage — matching proxy time entry's scope. What differs by project is only whether an
    // entered/submitted line auto-approves, not who's visible here or who can be planned for.
    prisma.assignment.findMany({
      where: {
        status: { not: "CLOSED" },
        milestone: {
          project: {
            companyId: user.companyId,
            ...(selectedProjectIds.length > 0 ? { id: { in: selectedProjectIds } } : {}),
          },
        },
      },
      include: {
        user: true,
        milestone: {
          include: {
            project: { include: { client: true } },
            tasks: { select: { id: true, name: true, assigneeId: true, estimatedHours: true }, orderBy: { createdAt: "asc" } },
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.project.findMany({
      where: {
        companyId: user.companyId,
        milestones: { some: { assignments: { some: { status: { not: "CLOSED" } } } } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const assignmentIds = assignments.map((a) => a.id);
  const planEntries = await prisma.assignmentPlan.findMany({
    where: {
      assignmentId: { in: assignmentIds },
      weekStartDate: { gte: timelineStart, lt: timelineEnd },
    },
  });

  const initialCells: PlanCellInit[] = planEntries.map((p) => ({
    assignmentId: p.assignmentId,
    taskId: p.taskId,
    weekStartDate: toDateParam(p.weekStartDate),
    hours: Number(p.hours),
  }));

  const allowedUserIds = new Set(allUsers.map((u) => u.id));
  const resourcesMap = new Map<string, PlanResourceRow>();
  for (const u of allUsers) {
    resourcesMap.set(u.id, { userId: u.id, userName: u.name, role: u.role, assignments: [] });
  }
  for (const a of assignments) {
    if (!allowedUserIds.has(a.userId)) continue; // excluded by the role filter
    const row: PlanAssignmentRow = {
      id: a.id,
      label: `${a.milestone.project.name} — ${a.milestone.name}`,
      allocatedHours: a.allocatedHours ? Number(a.allocatedHours) : null,
      startDate: toDateParam(a.startDate),
      endDate: toDateParam(a.endDate),
      // Only this person's tasks on the milestone are plannable under their assignment.
      tasks: a.milestone.tasks
        .filter((t) => t.assigneeId === a.userId)
        .map((t) => ({ id: t.id, name: t.name, estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null })),
    };
    resourcesMap.get(a.userId)!.assignments.push(row);
  }
  const resources = [...resourcesMap.values()].sort((a, b) => a.userName.localeCompare(b.userName));

  // Real available hours per person per week: contracted capacity minus public holidays and
  // approved leave. Without this the grid coloured everyone against a flat 40h, which is wrong
  // every holiday week and all through August.
  const weekKeys = weeks.map((w) => toDateParam(startOfWeek(w)));
  const capacity = toCapacityCells(
    await loadCapacity(user.companyId, allUsers.map((u) => u.id), weekKeys, timelineStart, timelineEnd),
  );

  const prevStart = toDateParam(addWeeks(timelineStart, -WEEKS_VISIBLE));
  const nextStart = toDateParam(addWeeks(timelineStart, WEEKS_VISIBLE));
  const qs = (s: string) => {
    const params = new URLSearchParams();
    params.set("start", s);
    if (selectedProjectIds.length > 0) params.set("projects", selectedProjectIds.join(","));
    if (selectedRoles.length > 0) params.set("roles", selectedRoles.join(","));
    return `/planning?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Resource planner</h1>
          <p className="text-sm text-muted-foreground">
            Enter planned hours per assignment per week. This drives the revenue forecast until it&apos;s charged as
            actual time.
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
          <WeekJump
            currentDate={toDateParam(timelineStart)}
            basePath="/planning"
            dateParam="start"
            extraParams={{ projects: projectsParam, roles: rolesParam }}
          />
          <Link href={`/planning/availability?start=${toDateParam(timelineStart)}`} className="text-muted-foreground hover:underline">
            Availability →
          </Link>
        </div>
      </div>

      <PlannerFilters projects={projects} currentProjects={selectedProjectIds} currentRoles={selectedRoles} />

      <PlannerGrid
        // Remount the grid whenever the visible range or filters change. PlannerGrid seeds its
        // editable cells from `initialCells` via useState(initial) — a value only read at mount —
        // so without a changing key, a soft navigation (Prev/Next / date jump / filter change) would
        // reuse the same instance and keep the previous range's stale cells, showing the newly loaded
        // range as empty until a hard refresh. (Same trap the Time grid's WeekGrid hit.)
        key={`${toDateParam(timelineStart)}|${selectedProjectIds.join(",")}|${selectedRoles.join(",")}`}
        weeks={weeks.map((w) => ({ key: toDateParam(startOfWeek(w)), label: format(w, "MMM d") }))}
        resources={resources}
        initialCells={initialCells}
        capacity={capacity}
        canManage={canManage}
        todayWeekKey={toDateParam(startOfWeek(new Date()))}
      />
    </div>
  );
}
