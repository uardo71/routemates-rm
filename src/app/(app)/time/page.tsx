import Link from "next/link";
import { addDays, format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parseDateParam, toDateParam } from "@/lib/week";
import { WeekJump } from "@/components/week-jump";
import { ResourceSelector } from "./resource-selector";
import { WeekGrid, type AssignmentOption, type GridCard } from "./week-grid";

async function loadWeekCards(targetUserId: string, weekStart: Date): Promise<GridCard[]> {
  const cards = await prisma.timeCard.findMany({
    where: { userId: targetUserId, weekStartDate: weekStart },
    include: { entries: true, approver: true },
    orderBy: { createdAt: "asc" },
  });

  return cards.map((c) => ({
    id: c.id,
    assignmentId: c.assignmentId,
    status: c.status,
    approverName: c.approver?.name ?? null,
    comment: c.comment,
    entries: c.entries.map((e) => ({
      taskId: e.taskId,
      date: toDateParam(e.date),
      hours: Number(e.hours),
      description: e.description ?? "",
    })),
  }));
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; resource?: string }>;
}) {
  const { week, resource } = await searchParams;
  const caller = await requireUser();
  const weekStart = parseDateParam(week);
  const weekEnd = addDays(weekStart, 6);
  const prevWeekStart = addDays(weekStart, -7);
  const prevWeekParam = toDateParam(prevWeekStart);
  const nextWeekParam = toDateParam(addDays(weekStart, 7));

  const canActAsOthers = caller.role === "ADMIN" || caller.role === "PM";

  // A PM can enter time for anyone in the company, not just people on projects they personally
  // manage — the difference shows up at Submit time (auto-approve vs. landing in the normal
  // queue for whoever actually manages that project), not in who's reachable here.
  let resources: { id: string; name: string }[] = [];
  if (canActAsOthers) {
    const all = await prisma.user.findMany({
      where: { companyId: caller.companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    resources =
      caller.role === "ADMIN" ? all : [{ id: caller.id, name: "Me" }, ...all.filter((u) => u.id !== caller.id)];
  }

  const targetUserId = canActAsOthers && resource ? resource : caller.id;
  const isOwnWeek = targetUserId === caller.id;
  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId: caller.companyId } });
  if (!targetUser) {
    return <div className="text-muted-foreground">Resource not found.</div>;
  }

  // All assignments (not just pickable ones) so past/locked entries against closed assignments still render a label.
  const allAssignments = await prisma.assignment.findMany({
    where: { userId: targetUserId },
    include: { milestone: { include: { project: true, tasks: true } } },
    orderBy: { createdAt: "asc" },
  });
  const assignmentIds = allAssignments.map((a) => a.id);
  const allTaskIds = allAssignments.flatMap((a) => a.milestone.tasks.map((t) => t.id));

  const [usedByAssignment, usedByTask, currentCards, prevCards] = await Promise.all([
    // Only APPROVED hours count as committed "actuals" against a cap — draft/submitted hours
    // are provisional and shouldn't make a line look over-budget before they're decided.
    prisma.timeEntry.groupBy({
      by: ["assignmentId"],
      where: { assignmentId: { in: assignmentIds }, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
    }),
    prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: { taskId: { in: allTaskIds }, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
    }),
    loadWeekCards(targetUserId, weekStart),
    loadWeekCards(targetUserId, prevWeekStart),
  ]);

  const totalUsedByAssignment = new Map(usedByAssignment.map((u) => [u.assignmentId, Number(u._sum.hours ?? 0)]));
  const totalUsedByTask = new Map(usedByTask.map((u) => [u.taskId as string, Number(u._sum.hours ?? 0)]));

  function buildOptions(): AssignmentOption[] {
    return allAssignments.map((a) => ({
      id: a.id,
      projectName: a.milestone.project.name,
      milestoneName: a.milestone.name,
      allocatedHours: a.allocatedHours ? Number(a.allocatedHours) : null,
      usedHours: totalUsedByAssignment.get(a.id) ?? 0,
      pickable:
        a.status === "ACTIVE" &&
        a.milestone.timeEntryOpen &&
        a.startDate <= weekEnd &&
        a.endDate >= weekStart,
      tasks: a.milestone.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        estimatedHours: t.estimatedHours ? Number(t.estimatedHours) : null,
        usedHours: totalUsedByTask.get(t.id) ?? 0,
      })),
    }));
  }

  // Reference list below the grid: only assignments whose date window actually covers the week
  // being viewed (an assignment must always have a start/end date).
  const assignmentsThisWeek = allAssignments.filter((a) => a.startDate <= weekEnd && a.endDate >= weekStart);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Time tracking</h1>
        <div className="flex items-center gap-3">
          {canActAsOthers && resources.length > 0 && (
            <ResourceSelector resources={resources} currentId={targetUserId} />
          )}
          <div className="flex items-center gap-3 text-sm">
            <Link href={`/time?week=${prevWeekParam}${resource ? `&resource=${resource}` : ""}`} className="hover:underline">
              ← Prev
            </Link>
            <span className="font-medium">
              {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
            </span>
            <Link href={`/time?week=${nextWeekParam}${resource ? `&resource=${resource}` : ""}`} className="hover:underline">
              Next →
            </Link>
            <WeekJump
              currentDate={toDateParam(weekStart)}
              basePath="/time"
              dateParam="week"
              extraParams={{ resource }}
            />
          </div>
        </div>
      </div>

      {!isOwnWeek && <p className="text-sm text-muted-foreground">Entering time on behalf of {targetUser.name}.</p>}

      <WeekGrid
        key={`${targetUserId}:${toDateParam(weekStart)}`}
        targetUserId={targetUserId}
        weekStart={toDateParam(weekStart)}
        assignments={buildOptions()}
        cards={currentCards}
        previousWeekCards={prevCards}
        isOwnWeek={isOwnWeek}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isOwnWeek ? "Your assignments" : `${targetUser.name}'s assignments`}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Milestone</TableHead>
                <TableHead>Allocated</TableHead>
                <TableHead>Approved hours</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignmentsThisWeek.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.milestone.project.name}</TableCell>
                  <TableCell>{a.milestone.name}</TableCell>
                  <TableCell>{a.allocatedHours ? `${a.allocatedHours}h` : "—"}</TableCell>
                  <TableCell>{totalUsedByAssignment.get(a.id) ?? 0}h</TableCell>
                  <TableCell>
                    {format(a.startDate, "MMM d")} – {format(a.endDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {assignmentsThisWeek.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No assignments cover this week.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
