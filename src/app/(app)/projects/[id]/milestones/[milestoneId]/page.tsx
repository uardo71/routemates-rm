import Link from "next/link";
import { notFound } from "next/navigation";
import { ClockIcon, UsersIcon, CheckSquareIcon, WalletIcon, Building2Icon, ReceiptIcon, LockIcon, CheckCircle2Icon, ArrowLeftRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HourProgress } from "@/components/hour-progress";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { InfoField } from "@/components/info-field";
import { DonutChart, DONUT_COLORS } from "@/components/charts/donut-chart";
import { prisma } from "@/lib/prisma";
import { can, canManageMilestone, canManageProject, canViewMilestoneRates, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { AssignmentStatusSelect } from "./assignment-status-select";
import { MilestoneStatusSelect } from "./milestone-status-select";
import { TimeEntryOpenToggle } from "./time-entry-open-toggle";
import { TaskRow } from "./task-row";
import { ReallocateHoursForm } from "../../reallocate-hours-form";
import { MilestoneAdjustments, type AdjustmentRow, type OppOption } from "./milestone-adjustments";

type Tone = "secondary" | "default" | "outline" | "destructive";
const ASSIGNMENT_STATUS_TONE: Record<string, Tone> = { ACTIVE: "default", PAUSED: "secondary", CLOSED: "outline" };
const TASK_STATUS_TONE: Record<string, Tone> = { TODO: "secondary", IN_PROGRESS: "default", DONE: "outline" };

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
      adjustments: { include: { opportunity: { select: { id: true, number: true, name: true } }, createdBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
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

  const [hoursByAssignment, hoursByTask, siblingMilestones, reallocations] = await Promise.all([
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
    prisma.milestone.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    prisma.milestoneReallocation.findMany({
      where: { OR: [{ fromMilestoneId: milestone.id }, { toMilestoneId: milestone.id }] },
      include: { fromMilestone: true, toMilestone: true, byUser: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  // Milestone "value": lump sum for fixed price, rate × budget hours for T&M/retainer. Adjustments
  // (money removed/absorbed) apply on top → effective value used for the project's remaining budget.
  const baseValue = milestone.project.billingType === "FIXED_PRICE"
    ? Number(milestone.salesPrice)
    : Number(milestone.salesPrice) * Number(milestone.budgetHours ?? 0);
  const adjustmentRows: AdjustmentRow[] = milestone.adjustments.map((a) => ({
    id: a.id, amount: Number(a.amount), reason: a.reason,
    opportunity: a.opportunity ? { id: a.opportunity.id, number: a.opportunity.number, name: a.opportunity.name } : null,
    byName: a.createdBy.name, at: a.createdAt.toLocaleDateString(),
  }));
  const oppOptions: OppOption[] = canManage
    ? (await prisma.opportunity.findMany({ where: { companyId: user.companyId }, orderBy: { updatedAt: "desc" }, select: { id: true, number: true, name: true } }))
        .map((o) => ({ id: o.id, label: `${o.number ? `${o.number} · ` : ""}${o.name}` }))
    : [];
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
  const doneTasks = milestone.tasks.filter((t) => t.status === "DONE").length;
  const canReallocate = (await canManageProject(user, projectId)) && siblingMilestones.length >= 2;

  const priceLabel = milestone.project.billingType === "FIXED_PRICE" ? "Sales price (fixed)" : "Sales price / hr";

  // "Fully absorbed" = the milestone's entire value was taken out via negative adjustments (effective
  // value collapsed to ~0). Its worth now lives on another opportunity/deal, so we flag it distinctly
  // rather than leaving it looking like an unstarted PLANNED milestone.
  const adjTotal = adjustmentRows.reduce((s, a) => s + a.amount, 0);
  const effectiveValue = baseValue + adjTotal;
  const fullyAbsorbed = baseValue > 0 && adjTotal < 0 && effectiveValue <= 0.005;
  const absorbedInto = fullyAbsorbed ? adjustmentRows.find((a) => a.opportunity && a.amount < 0)?.opportunity ?? null : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${projectId}?tab=milestones`} className="text-sm text-muted-foreground hover:underline">
          ← {milestone.project.name}
        </Link>
        <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={milestone.project.client.name} className="size-10" />
            <h1 className="text-2xl font-semibold">{milestone.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {fullyAbsorbed && (
              <Badge variant="outline" className="border-primary/50 bg-primary/10 text-primary gap-1">
                <ArrowLeftRightIcon className="size-3" />
                Value absorbed{absorbedInto ? ` → ${absorbedInto.number ?? absorbedInto.name}` : ""}
              </Badge>
            )}
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
        {milestone.completedAt && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-emerald-300/60 bg-emerald-500/5 px-3 py-2 text-sm">
            <CheckCircle2Icon className="size-4 mt-0.5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-medium">Completed &amp; locked</span>
              <span className="text-muted-foreground"> · {milestone.completedAt.toLocaleDateString()} · full value recognized, </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground"><LockIcon className="size-3" /> time entry locked</span>
              {milestone.completionNote && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{milestone.completionNote}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Hours logged"
          value={totalUsed}
          icon={ClockIcon}
          tone={milestone.budgetHours && totalUsed / Number(milestone.budgetHours) >= 0.8 ? "warning" : "default"}
          sublabel={milestone.budgetHours ? `of ${milestone.budgetHours}h budgeted` : "no cap"}
        />
        <StatCard
          label="Team"
          value={milestone.assignments.length}
          icon={UsersIcon}
          sublabel={`${staffedAssignments} staffed`}
        />
        <StatCard
          label="Tasks"
          value={`${doneTasks}/${milestone.tasks.length}`}
          icon={CheckSquareIcon}
          sublabel={milestone.tasks.length > 0 ? "done" : "none yet"}
        />
        {canViewRates ? (
          <StatCard
            label={priceLabel}
            value={formatMoney(milestone.salesPrice, milestone.project.company.currency)}
            icon={WalletIcon}
          />
        ) : (
          <StatCard label="Billable" value={milestone.billable ? "Yes" : "No"} icon={ReceiptIcon} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Information</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
              <InfoField icon={Building2Icon} label="Client" value={milestone.project.client.name} />
              <InfoField icon={ReceiptIcon} label="Billable" value={milestone.billable ? "Yes" : "No"} />
              {canViewRates && (
                <InfoField
                  icon={WalletIcon}
                  label="Budgeted cost"
                  value={
                    <>
                      {formatMoney(milestone.cost, milestone.project.company.currency)}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {staffedAssignments > 0
                          ? `${formatMoney(impliedCost, "EUR")} implied from ${staffedAssignments} assignment${staffedAssignments === 1 ? "" : "s"}`
                          : "No staffed assignments yet"}
                      </span>
                    </>
                  }
                />
              )}
            </div>
            <div className="border-t pt-4">
              <HourProgress
                used={totalUsed}
                cap={milestone.budgetHours ? Number(milestone.budgetHours) : null}
                label="Hours logged"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Hours by assignee</CardTitle>
          </CardHeader>
          <CardContent>
            {milestone.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one assigned yet.</p>
            ) : totalUsed === 0 ? (
              <p className="text-sm text-muted-foreground">No approved hours logged yet.</p>
            ) : (
              <DonutChart
                centerLabel={`${totalUsed}h`}
                centerSublabel="logged"
                segments={milestone.assignments.map((a, i) => ({
                  label: a.user.name,
                  value: usedByAssignment.get(a.id) ?? 0,
                  colorClass: DONUT_COLORS[i % DONUT_COLORS.length],
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {canViewRates && (
        <MilestoneAdjustments
          milestoneId={milestone.id}
          currency={milestone.project.company.currency}
          baseValue={baseValue}
          adjustments={adjustmentRows}
          opportunities={oppOptions}
          canManage={canManage}
        />
      )}

      {canReallocate && (
        <Card>
          <CardHeader>
            <CardTitle>Reallocate hours with another milestone</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ReallocateHoursForm milestones={siblingMilestones} />
            {reallocations.length > 0 && (
              <div className="flex flex-col gap-3 text-sm border-t pt-4">
                {reallocations.map((r) => (
                  <div key={r.id} className="flex items-start gap-2.5">
                    <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="text-muted-foreground">
                      <span className="font-medium text-foreground">{r.byUser.name}</span> moved{" "}
                      <span className="font-medium text-foreground">{r.hours.toString()}h</span> from{" "}
                      <span className="font-medium text-foreground">{r.fromMilestone.name}</span> to{" "}
                      <span className="font-medium text-foreground">{r.toMilestone.name}</span> (
                      {r.hoursReceived.toString()}h received, {formatMoney(r.costMoved, milestone.project.company.currency)} cost moved)
                      {r.reason ? ` — "${r.reason}"` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  <TableCell>
                    <div className="flex items-center gap-2.5 font-medium">
                      <InitialsAvatar name={a.user.name} className="size-6 text-[10px]" />
                      {a.user.name}
                    </div>
                  </TableCell>
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
                      <Badge variant={ASSIGNMENT_STATUS_TONE[a.status] ?? "secondary"}>{a.status}</Badge>
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
                      <Badge variant={TASK_STATUS_TONE[t.status] ?? "secondary"}>{t.status.replaceAll("_", " ")}</Badge>
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
