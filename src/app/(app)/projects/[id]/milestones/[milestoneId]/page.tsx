import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HourProgress } from "@/components/hour-progress";
import { LinkButton } from "@/components/link-button";
import { prisma } from "@/lib/prisma";
import { can, canManageMilestone, canViewMilestoneRates, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { AssignmentStatusSelect } from "./assignment-status-select";
import { MilestoneStatusSelect } from "./milestone-status-select";
import { TimeEntryOpenToggle } from "./time-entry-open-toggle";
import { BillMilestoneForm } from "./bill-milestone-form";
import { TaskRow } from "./task-row";

export default async function MilestoneDetailPage({
  params,
}: {
  params: Promise<{ id: string; milestoneId: string }>;
}) {
  const { id: projectId, milestoneId } = await params;
  const user = await requirePermission("projects:view");

  const projectIds = await visibleProjectIds(user);
  if (projectIds !== "ALL" && !projectIds.includes(projectId)) notFound();

  const milestone = await prisma.milestone.findFirst({
    where: { id: milestoneId, projectId, project: { companyId: user.companyId } },
    include: {
      project: { include: { client: true, company: true } },
      assignments: { include: { user: true }, orderBy: { createdAt: "asc" } },
      tasks: { include: { assignee: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!milestone) notFound();

  const [canManage, canViewRates] = await Promise.all([
    canManageMilestone(user, milestone.id),
    canViewMilestoneRates(user, milestone.id),
  ]);
  // Assignment cost rate is derived from an individual's salary — unlike milestone-level sales
  // price/budget (which PMs need to run their project), it's HR-sensitive and Admin/Finance-only.
  const canViewCostRate = can(user, "rates:view:any");

  const [hoursByAssignment, hoursByTask] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ["assignmentId"],
      where: { milestoneId: milestone.id, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
    }),
    prisma.timeEntry.groupBy({
      by: ["taskId"],
      where: { milestoneId: milestone.id, taskId: { not: null }, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
    }),
  ]);
  const usedByAssignment = new Map(hoursByAssignment.map((h) => [h.assignmentId, Number(h._sum.hours ?? 0)]));
  const usedByTask = new Map(hoursByTask.map((h) => [h.taskId as string, Number(h._sum.hours ?? 0)]));
  const totalUsed = [...usedByAssignment.values()].reduce((a, b) => a + b, 0);

  // Reference figure only — a milestone/role can have several people at different cost rates
  // (salary differences, contractors), so this is summed bottom-up from actual assignments
  // rather than driving the manually-set "Budgeted cost" above.
  const impliedCost = milestone.assignments.reduce(
    (sum, a) => sum + Number(a.costRate) * (a.allocatedHours ? Number(a.allocatedHours) : 0),
    0
  );
  const staffedAssignments = milestone.assignments.filter((a) => a.allocatedHours !== null).length;

  const priceLabel = milestone.project.billingType === "FIXED_PRICE" ? "Sales price (fixed)" : "Sales price / hr";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:underline">
          ← {milestone.project.name}
        </Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-2xl font-semibold">{milestone.name}</h1>
          <div className="flex items-center gap-2">
            {canManage && <TimeEntryOpenToggle milestoneId={milestone.id} open={milestone.timeEntryOpen} />}
            {canManage ? (
              <MilestoneStatusSelect milestoneId={milestone.id} status={milestone.status} />
            ) : (
              <Badge variant="secondary">{milestone.status}</Badge>
            )}
            {canManage && (
              <LinkButton href={`/projects/${projectId}/milestones/${milestone.id}/edit`} variant="outline" size="sm">
                Edit
              </LinkButton>
            )}
          </div>
        </div>
        {milestone.description && <p className="text-sm text-muted-foreground mt-1">{milestone.description}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Client</div>
            <div>{milestone.project.client.name}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Billable</div>
            <div>{milestone.billable ? "Yes" : "No"}</div>
          </div>
          {canViewRates && (
            <div>
              <div className="text-muted-foreground">{priceLabel}</div>
              <div>{formatMoney(milestone.salesPrice, milestone.project.company.currency)}</div>
            </div>
          )}
          {canViewRates && (
            <div>
              <div className="text-muted-foreground">Budgeted cost</div>
              <div>{formatMoney(milestone.cost, milestone.project.company.currency)}</div>
              <div className="text-xs text-muted-foreground">
                {staffedAssignments > 0
                  ? `${formatMoney(impliedCost, "EUR")} implied from ${staffedAssignments} assignment${staffedAssignments === 1 ? "" : "s"}`
                  : "No staffed assignments yet"}
              </div>
            </div>
          )}
          <div className="col-span-2 sm:col-span-4">
            <HourProgress
              used={totalUsed}
              cap={milestone.budgetHours ? Number(milestone.budgetHours) : null}
              label="Hours logged"
            />
          </div>
          {can(user, "invoices:manage") &&
            milestone.project.billingType === "FIXED_PRICE" &&
            milestone.billable &&
            milestone.status === "COMPLETE" && (
              <div className="col-span-2 sm:col-span-4">
                <BillMilestoneForm
                  milestoneId={milestone.id}
                  amount={milestone.salesPrice.toString()}
                  currency={milestone.project.company.currency}
                />
              </div>
            )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Assignments</CardTitle>
          {canManage && (
            <LinkButton
              href={`/projects/${projectId}/milestones/${milestone.id}/assignments/new`}
              variant="outline"
              size="sm"
            >
              New assignment
            </LinkButton>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                {canViewCostRate && <TableHead>Cost rate</TableHead>}
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestone.assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.user.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.user.role}</Badge>
                  </TableCell>
                  {canViewCostRate && <TableCell>{formatMoney(a.costRate, "EUR")}/hr</TableCell>}
                  <TableCell>
                    <HourProgress
                      used={usedByAssignment.get(a.id) ?? 0}
                      cap={a.allocatedHours ? Number(a.allocatedHours) : null}
                    />
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <AssignmentStatusSelect assignmentId={a.id} status={a.status} />
                    ) : (
                      <Badge variant="secondary">{a.status}</Badge>
                    )}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      <Link
                        href={`/projects/${projectId}/milestones/${milestone.id}/assignments/${a.id}/edit`}
                        className="text-sm text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {milestone.assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground">
                    No one assigned yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tasks</CardTitle>
          {canManage && (
            <div className="flex items-center gap-2">
              <LinkButton
                href={`/projects/${projectId}/milestones/${milestone.id}/tasks/copy`}
                variant="outline"
                size="sm"
              >
                Copy from milestone
              </LinkButton>
              <LinkButton
                href={`/projects/${projectId}/milestones/${milestone.id}/tasks/new`}
                variant="outline"
                size="sm"
              >
                New task
              </LinkButton>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Due</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {milestone.tasks.map((t) =>
                canManage ? (
                  <TaskRow
                    key={t.id}
                    task={{
                      id: t.id,
                      name: t.name,
                      assigneeId: t.assigneeId,
                      assigneeName: t.assignee?.name ?? null,
                      estimatedHours: t.estimatedHours?.toString() ?? null,
                      dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
                      status: t.status,
                    }}
                    members={milestone.assignments.map((a) => ({ id: a.user.id, name: a.user.name }))}
                    usedHours={usedByTask.get(t.id) ?? 0}
                    editHref={`/projects/${projectId}/milestones/${milestone.id}/tasks/${t.id}/edit`}
                  />
                ) : (
                  <TableRow key={t.id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell>{t.assignee?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.status.replaceAll("_", " ")}</Badge>
                    </TableCell>
                    <TableCell>
                      <HourProgress
                        used={usedByTask.get(t.id) ?? 0}
                        cap={t.estimatedHours ? Number(t.estimatedHours) : null}
                      />
                    </TableCell>
                    <TableCell>{t.dueDate ? t.dueDate.toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                )
              )}
              {milestone.tasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground">
                    No tasks yet — time can be logged directly against the milestone.
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
