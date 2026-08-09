import { addWeeks, format } from "date-fns";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { startOfWeek, parseDateParam, toDateParam } from "@/lib/week";
import { WeekJump } from "@/components/week-jump";
import { PlannerFilters } from "./planner-filters";
import { PlannerGrid, type PlanAssignmentRow, type PlanCellInit, type PlanResourceRow } from "./planner-grid";

const WEEKS_VISIBLE = 8;

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; project?: string; role?: string }>;
}) {
  const { start, project, role } = await searchParams;
  const user = await requirePermission("planning:view");

  const timelineStart = parseDateParam(start);
  const weeks = Array.from({ length: WEEKS_VISIBLE }, (_, i) => addWeeks(timelineStart, i));
  const timelineEnd = addWeeks(timelineStart, WEEKS_VISIBLE);

  const isAdmin = user.role === "ADMIN";
  const canManage = isAdmin || user.role === "PM";

  // A PM plans capacity for the whole company, not just people on projects they personally
  // manage — matching proxy time entry's scope. What differs by project is only whether an
  // entered/submitted line auto-approves, not who's visible here or who can be planned for.
  const [assignments, projects] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        status: { not: "CLOSED" },
        milestone: {
          project: {
            companyId: user.companyId,
            ...(project ? { id: project } : {}),
          },
        },
        ...(role ? { user: { role: role as never } } : {}),
      },
      include: {
        user: true,
        milestone: { include: { project: { include: { client: true } } } },
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
    weekStartDate: toDateParam(p.weekStartDate),
    hours: Number(p.hours),
  }));

  const resourcesMap = new Map<string, PlanResourceRow>();
  for (const a of assignments) {
    if (!resourcesMap.has(a.userId)) {
      resourcesMap.set(a.userId, { userId: a.userId, userName: a.user.name, role: a.user.role, assignments: [] });
    }
    const row: PlanAssignmentRow = {
      id: a.id,
      label: `${a.milestone.project.name} — ${a.milestone.name}`,
      allocatedHours: a.allocatedHours ? Number(a.allocatedHours) : null,
    };
    resourcesMap.get(a.userId)!.assignments.push(row);
  }
  const resources = [...resourcesMap.values()].sort((a, b) => a.userName.localeCompare(b.userName));

  const prevStart = toDateParam(addWeeks(timelineStart, -WEEKS_VISIBLE));
  const nextStart = toDateParam(addWeeks(timelineStart, WEEKS_VISIBLE));
  const qs = (s: string) => {
    const params = new URLSearchParams();
    params.set("start", s);
    if (project) params.set("project", project);
    if (role) params.set("role", role);
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
            extraParams={{ project, role }}
          />
        </div>
      </div>

      <PlannerFilters projects={projects} currentProject={project} currentRole={role} />

      <PlannerGrid
        weeks={weeks.map((w) => ({ key: toDateParam(startOfWeek(w)), label: format(w, "MMM d") }))}
        resources={resources}
        initialCells={initialCells}
        canManage={canManage}
        todayWeekKey={toDateParam(startOfWeek(new Date()))}
      />
    </div>
  );
}
