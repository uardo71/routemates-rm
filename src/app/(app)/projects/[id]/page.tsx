import Link from "next/link";
import { notFound } from "next/navigation";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import {
  UsersIcon,
  FolderKanbanIcon,
  ClockIcon,
  ReceiptIcon,
  Building2Icon,
  UserIcon,
  CalendarIcon,
  WalletIcon,
  TagIcon,
  FileTextIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusStamp, type StampTone } from "@/components/status-stamp";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HourProgress } from "@/components/hour-progress";
import { LinkButton } from "@/components/link-button";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { InfoField } from "@/components/info-field";
import { DonutChart, DONUT_COLORS } from "@/components/charts/donut-chart";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { can, canManageProject, visibleProjectIds } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DocumentsCard, type DocRow } from "@/components/documents-card";
import { TimeEntriesTable } from "./time-entries-table";
import { UatCard, PhasePill, type UatState, type UatEventItem } from "./uat-card";
import { uploadProjectDocumentAction, deleteProjectDocumentAction } from "../actions";

type Tone = "secondary" | "default" | "outline" | "destructive";
const PROJECT_STATUS_STAMP: Record<string, { tone: StampTone; dashed?: boolean }> = {
  PLANNED: { tone: "neutral", dashed: true },
  ACTIVE: { tone: "brass" },
  ON_HOLD: { tone: "amber" },
  COMPLETED: { tone: "green" },
  CANCELLED: { tone: "rust" },
};
const MILESTONE_STATUS_TONE: Record<string, Tone> = {
  PLANNED: "secondary",
  ACTIVE: "default",
  COMPLETE: "outline",
  INVOICED: "secondary",
};
const ASSIGNMENT_STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "default",
  PAUSED: "secondary",
  CLOSED: "outline",
};
const INVOICE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "secondary",
  ISSUED: "default",
  RECONCILED: "outline",
  PAID: "outline",
  VOID: "destructive",
};

const PROJECT_TABS = ["overview", "milestones", "assignments", "time", "invoices", "uat"] as const;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  // Which tab to open on — lets drill-in pages (a milestone, an assignment) link back to the exact
  // tab you came from via `?tab=…`, instead of always dumping you on Overview.
  const { tab } = await searchParams;
  const activeTab = (PROJECT_TABS as readonly string[]).includes(tab ?? "") ? (tab as string) : "overview";
  const user = await requirePermission("projects:view");

  const projectIds = await visibleProjectIds(user);
  if (projectIds !== "ALL" && !projectIds.includes(id)) notFound();

  const project = await prisma.project.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      client: true,
      manager: true,
      company: true,
      milestones: {
        include: {
          _count: { select: { assignments: true, tasks: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      // Present only when this project was created by converting a won Opportunity — drives the
      // "View opportunity" link and the contract-terms (discount / PO / SoW) block below.
      opportunity: { select: { id: true, name: true } },
      uatRecordedBy: { select: { name: true } },
      uatEvents: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" } },
      documents: { orderBy: { uploadedAt: "desc" } },
    },
  });
  if (!project) notFound();

  const canManage = await canManageProject(user, project.id);
  // Sales price / monetary value is rate-sensitive — hidden from users who can't view rates
  // (e.g. an assignee viewing a project they're staffed on but don't manage).
  const canViewRates = can(user, "rates:view:any") || canManage;
  const milestoneIds = project.milestones.map((m) => m.id);

  const [hoursByMilestone, assignments, hoursByAssignment, invoices, timeCards] = await Promise.all([
    prisma.timeEntry.groupBy({
      by: ["milestoneId"],
      where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
    }),
    prisma.assignment.findMany({
      where: { milestoneId: { in: milestoneIds } },
      include: { user: true, milestone: true },
      orderBy: [{ milestone: { name: "asc" } }, { user: { name: "asc" } }],
    }),
    prisma.timeEntry.groupBy({
      by: ["assignmentId"],
      where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
      _sum: { hours: true },
      _max: { date: true },
    }),
    prisma.invoice.findMany({
      // Match invoices tied to this project either directly (manual / self-billed invoices carry
      // projectId but no milestone lines) or via a milestone-linked line (time-based invoices).
      where: { OR: [{ projectId: project.id }, { lines: { some: { milestoneId: { in: milestoneIds } } } }] },
      include: { lines: true },
      orderBy: { issueDate: "desc" },
    }),
    prisma.timeCard.findMany({
      where: { milestoneId: { in: milestoneIds } },
      include: {
        user: true,
        submittedBy: true,
        milestone: true,
        entries: { include: { task: true }, orderBy: { date: "asc" } },
      },
      orderBy: [{ weekStartDate: "desc" }, { createdAt: "desc" }],
    }),
  ]);

  const usedHoursMap = new Map(hoursByMilestone.map((h) => [h.milestoneId, Number(h._sum.hours ?? 0)]));
  const usedByAssignment = new Map(hoursByAssignment.map((h) => [h.assignmentId, Number(h._sum.hours ?? 0)]));

  // Planned (AssignmentPlan) hours rolled up per milestone, so the project surfaces what the
  // resource planner has scheduled against each milestone's budget — and makes over-planning
  // (planned > budget hours) visible here rather than only in the planner.
  const planAssignmentIds = assignments.map((a) => a.id);
  const plannedByAssignment = planAssignmentIds.length
    ? await prisma.assignmentPlan.groupBy({
        by: ["assignmentId"],
        where: { assignmentId: { in: planAssignmentIds } },
        _sum: { hours: true },
      })
    : [];
  const plannedAsgMap = new Map(plannedByAssignment.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
  const plannedByMilestone = new Map<string, number>();
  for (const a of assignments) {
    plannedByMilestone.set(a.milestoneId, (plannedByMilestone.get(a.milestoneId) ?? 0) + (plannedAsgMap.get(a.id) ?? 0));
  }

  const allocatedHours = project.milestones.reduce((sum, m) => sum + Number(m.budgetHours ?? 0), 0);
  const projectBudgetHours = project.budgetHours ? Number(project.budgetHours) : null;
  const assignmentsCount = project.milestones.reduce((sum, m) => sum + m._count.assignments, 0);
  const teamSize = new Set(assignments.map((a) => a.userId)).size;
  const totalLoggedHours = [...usedHoursMap.values()].reduce((sum, h) => sum + h, 0);
  const activeMilestonesCount = project.milestones.filter((m) => m.status === "ACTIVE").length;
  const invoicedTotal = invoices.reduce((sum, inv) => sum + inv.lines.reduce((s, l) => s + Number(l.amount), 0), 0);
  const openInvoicesCount = invoices.filter((inv) => inv.status !== "PAID" && inv.status !== "VOID").length;
  const daysRemaining = project.endDate ? differenceInCalendarDays(project.endDate, new Date()) : null;
  const hoursNearOrOverBudget = projectBudgetHours !== null && projectBudgetHours > 0 && totalLoggedHours / projectBudgetHours >= 0.8;

  // Contract terms carried over from a won opportunity. `contractValue` is the net (post-discount)
  // figure; back-compute the list total + discount amount for display so the negotiated discount is
  // visible on the project, not just baked silently into the budget.
  const contractNet = project.contractValue != null ? Number(project.contractValue) : null;
  const discountVal = project.discountValue != null ? Number(project.discountValue) : null;
  let listTotal: number | null = null;
  let discountAmount = 0;
  if (contractNet != null && project.discountType && discountVal != null && discountVal > 0) {
    if (project.discountType === "ABSOLUTE") {
      discountAmount = discountVal;
      listTotal = contractNet + discountVal;
    } else {
      listTotal = discountVal < 100 ? contractNet / (1 - discountVal / 100) : contractNet;
      discountAmount = listTotal - contractNet;
    }
  }
  const hasContractTerms =
    project.opportunity != null ||
    contractNet != null ||
    project.discountType != null ||
    !!project.poNumber ||
    !!project.sowNumber;

  const uatState: UatState = {
    status: project.uatStatus,
    acceptedDate: project.uatAcceptedDate ? project.uatAcceptedDate.toISOString().slice(0, 10) : null,
    signatory: project.uatSignatory,
    notes: project.uatNotes,
    recordedByName: project.uatRecordedBy?.name ?? null,
    recordedAt: project.uatRecordedAt ? format(project.uatRecordedAt, "MMM d, yyyy") : null,
  };
  const uatEvents: UatEventItem[] = project.uatEvents.map((e) => ({
    id: e.id,
    status: e.status,
    note: e.note,
    actorName: e.actor.name,
    at: format(e.createdAt, "MMM d, yyyy 'at' HH:mm"),
  }));
  const projectDocRows: DocRow[] = project.documents.map((d) => ({
    id: d.id,
    kind: d.kind,
    fileName: d.fileName,
    originalName: d.originalName,
  }));

  const weeklyHoursMap = new Map<string, number>();
  for (const tc of timeCards) {
    const key = tc.weekStartDate.toISOString().slice(0, 10);
    const hours = tc.entries.reduce((s, e) => s + Number(e.hours), 0);
    weeklyHoursMap.set(key, (weeklyHoursMap.get(key) ?? 0) + hours);
  }
  const weeklyHoursData = [...weeklyHoursMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([week, hours]) => ({ label: format(parseISO(week), "MMM d"), value: Math.round(hours * 10) / 10 }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <InitialsAvatar name={project.client.name} className="size-11 text-sm" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              <StatusStamp label={project.status.replaceAll("_", " ")} {...(PROJECT_STATUS_STAMP[project.status] ?? { tone: "neutral" })} />
              <Badge variant="outline">{project.billingType.replaceAll("_", " ")}</Badge>
              {project.uatStatus !== "NOT_STARTED" && <PhasePill status={project.uatStatus} />}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {project.number && <span className="font-mono text-foreground">{project.number}</span>}
              {project.number && " · "}
              {project.client.name} · Managed by {project.manager?.name ?? "unassigned"}
              {project.endDate &&
                ` · ${daysRemaining !== null && daysRemaining >= 0 ? `${daysRemaining}d left` : "Ended"} (${format(project.endDate, "MMM d, yyyy")})`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {project.opportunity && (
            <LinkButton href={`/opportunities/${project.opportunity.id}`} variant="outline" size="sm">
              View opportunity
            </LinkButton>
          )}
          {canManage && (
            <LinkButton href={`/projects/${project.id}/edit`} variant="outline" size="sm">
              Edit
            </LinkButton>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Milestones"
          value={project.milestones.length}
          icon={FolderKanbanIcon}
          sublabel={`${activeMilestonesCount} active`}
        />
        <StatCard label="Team" value={teamSize} icon={UsersIcon} sublabel={`${assignmentsCount} assignment${assignmentsCount === 1 ? "" : "s"}`} />
        <StatCard
          label="Hours logged"
          value={totalLoggedHours}
          icon={ClockIcon}
          tone={hoursNearOrOverBudget ? "warning" : "default"}
          sublabel={projectBudgetHours !== null ? `of ${projectBudgetHours}h budgeted` : `${allocatedHours}h allocated`}
        />
        <StatCard
          label="Invoiced"
          value={formatMoney(invoicedTotal, project.company.currency)}
          icon={ReceiptIcon}
          sublabel={`${invoices.length} invoice${invoices.length === 1 ? "" : "s"}${openInvoicesCount > 0 ? ` · ${openInvoicesCount} open` : ""}`}
        />
      </div>

      <Tabs defaultValue={activeTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="milestones">Milestones ({project.milestones.length})</TabsTrigger>
          <TabsTrigger value="assignments">Assignments ({assignmentsCount})</TabsTrigger>
          <TabsTrigger value="time">Time entries ({timeCards.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="uat">UAT</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-6 pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Information</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
                  <InfoField icon={Building2Icon} label="Client" value={project.client.name} />
                  <InfoField icon={UserIcon} label="Manager" value={project.manager?.name ?? "—"} />
                  <InfoField icon={CalendarIcon} label="Start date" value={project.startDate ? format(project.startDate, "MMM d, yyyy") : "—"} />
                  <InfoField icon={CalendarIcon} label="End date" value={project.endDate ? format(project.endDate, "MMM d, yyyy") : "—"} />
                  <InfoField icon={ReceiptIcon} label="Billing type" value={project.billingType.replaceAll("_", " ")} />
                  <InfoField
                    icon={WalletIcon}
                    label="Budget pool"
                    value={project.budgetAmount ? formatMoney(project.budgetAmount, project.company.currency) : "—"}
                  />
                </div>
                {hasContractTerms && (
                  <div className="border-t pt-4 flex flex-col gap-4">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Contract{project.opportunity ? " (from opportunity)" : ""}
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
                      {listTotal != null && (
                        <InfoField icon={WalletIcon} label="List total" value={formatMoney(listTotal, project.company.currency)} />
                      )}
                      {discountAmount > 0 && (
                        <InfoField
                          icon={TagIcon}
                          label="Discount"
                          value={`−${formatMoney(discountAmount, project.company.currency)}${
                            project.discountType === "PERCENT" ? ` (${discountVal}%)` : ""
                          }`}
                        />
                      )}
                      {contractNet != null && (
                        <InfoField icon={WalletIcon} label="Contract value" value={formatMoney(contractNet, project.company.currency)} />
                      )}
                      {project.poNumber && <InfoField icon={FileTextIcon} label="PO number" value={project.poNumber} />}
                      {project.sowNumber && <InfoField icon={FileTextIcon} label="SoW number" value={project.sowNumber} />}
                    </div>
                  </div>
                )}
                {projectBudgetHours !== null && (
                  <div className="border-t pt-4">
                    <HourProgress used={allocatedHours} cap={projectBudgetHours} label="Allocated to milestones" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Logged hours by milestone</CardTitle>
                <p className="text-xs text-muted-foreground">Share of hours logged so far — not budget consumption.</p>
              </CardHeader>
              <CardContent>
                {project.milestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No milestones yet.</p>
                ) : (
                  <DonutChart
                    centerLabel={`${totalLoggedHours}h`}
                    centerSublabel="logged"
                    segments={project.milestones.map((m, i) => ({
                      label: m.name,
                      value: usedHoursMap.get(m.id) ?? 0,
                      colorClass: DONUT_COLORS[i % DONUT_COLORS.length],
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="milestones" className="pt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Milestones</CardTitle>
              {canManage && (
                <LinkButton href={`/projects/${project.id}/milestones/new`} variant="outline" size="sm">
                  New milestone
                </LinkButton>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Billable</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead className="text-right">Planned</TableHead>
                    {canViewRates && <TableHead className="text-right">Sales price</TableHead>}
                    {canViewRates && <TableHead className="text-right">Value</TableHead>}
                    <TableHead>People / Tasks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.milestones.map((m, i) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${project.id}/milestones/${m.id}`}
                          className="flex items-center gap-2.5 font-medium hover:underline"
                        >
                          <span className={cn("size-2 shrink-0 rounded-full", DONUT_COLORS[i % DONUT_COLORS.length].replaceAll("fill-", "bg-"))} />
                          {m.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={MILESTONE_STATUS_TONE[m.status] ?? "secondary"}>{m.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.billable ? "outline" : "secondary"}>{m.billable ? "Billable" : "Internal"}</Badge>
                      </TableCell>
                      <TableCell>
                        <HourProgress
                          used={usedHoursMap.get(m.id) ?? 0}
                          cap={m.budgetHours ? Number(m.budgetHours) : null}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        {(() => {
                          const planned = plannedByMilestone.get(m.id) ?? 0;
                          const budget = m.budgetHours ? Number(m.budgetHours) : null;
                          const over = budget !== null && planned > budget;
                          return (
                            <span className={cn(over && "text-destructive font-medium")} title={over ? "Planned exceeds this milestone's budget hours" : undefined}>
                              {formatNumber(planned)}h{budget !== null ? ` / ${formatNumber(budget)}h` : ""}
                            </span>
                          );
                        })()}
                      </TableCell>
                      {canViewRates && (
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {(() => {
                            // Per-hour figure: the billed rate for T&M/Retainer, or the effective rate
                            // (lump sum ÷ budget hours) for fixed price — so it never just repeats Value.
                            const bh = m.budgetHours ? Number(m.budgetHours) : null;
                            const rate =
                              project.billingType === "FIXED_PRICE"
                                ? bh
                                  ? Number(m.salesPrice) / bh
                                  : null
                                : Number(m.salesPrice);
                            return rate != null
                              ? `${formatMoney(rate, project.company.currency)}/h`
                              : formatMoney(m.salesPrice, project.company.currency);
                          })()}
                        </TableCell>
                      )}
                      {canViewRates && (
                        <TableCell className="text-right tabular-nums whitespace-nowrap">
                          {project.billingType === "FIXED_PRICE"
                            ? formatMoney(m.salesPrice, project.company.currency)
                            : m.budgetHours
                              ? formatMoney(Number(m.salesPrice) * Number(m.budgetHours), project.company.currency)
                              : `${formatMoney(m.salesPrice, project.company.currency)}/h`}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground">
                        {m._count.assignments} people · {m._count.tasks} tasks
                      </TableCell>
                    </TableRow>
                  ))}
                  {project.milestones.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canViewRates ? 8 : 6} className="text-center text-muted-foreground">
                        No milestones yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assignments" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Milestone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Allocated</TableHead>
                    <TableHead>Logged</TableHead>
                    <TableHead>Billable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${project.id}/milestones/${a.milestoneId}/assignments/${a.id}/edit?tab=assignments`}
                          className="flex items-center gap-2.5 font-medium hover:underline"
                        >
                          <InitialsAvatar name={a.user.name} className="size-6 text-[10px]" />
                          {a.user.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/projects/${project.id}/milestones/${a.milestoneId}`} className="hover:underline">
                          {a.milestone.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ASSIGNMENT_STATUS_TONE[a.status] ?? "secondary"}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{a.startDate ? format(a.startDate, "MMM d, yyyy") : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{a.endDate ? format(a.endDate, "MMM d, yyyy") : "—"}</TableCell>
                      <TableCell>{a.allocatedHours ? `${a.allocatedHours}h` : "—"}</TableCell>
                      <TableCell>{usedByAssignment.get(a.id) ?? 0}h</TableCell>
                      <TableCell>
                        <Badge variant={a.milestone.billable ? "outline" : "secondary"}>{a.milestone.billable ? "Billable" : "Internal"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {assignments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No assignments yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="time" className="flex flex-col gap-6 pt-4">
          {weeklyHoursData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Hours logged per week</CardTitle>
              </CardHeader>
              <CardContent>
                <MiniBarChart data={weeklyHoursData} valueFormatter={(v) => `${v}h`} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Time entries</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeEntriesTable
                cards={timeCards.map((tc) => ({
                  id: tc.id,
                  userName: tc.user.name,
                  milestoneName: tc.milestone.name,
                  weekStartDate: tc.weekStartDate.toISOString().slice(0, 10),
                  status: tc.status,
                  totalHours: tc.entries.reduce((s, e) => s + Number(e.hours), 0),
                  submittedAt: tc.submittedAt ? tc.submittedAt.toISOString() : null,
                  submittedByName: tc.submittedBy?.name ?? null,
                  decidedAt: tc.decidedAt ? tc.decidedAt.toISOString() : null,
                  comment: tc.comment,
                  entries: tc.entries.map((e) => ({
                    id: e.id,
                    date: e.date.toISOString().slice(0, 10),
                    hours: Number(e.hours),
                    taskName: e.task?.name ?? null,
                    description: e.description ?? "",
                  })),
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Period</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                          {inv.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={INVOICE_STATUS_TONE[inv.status] ?? "secondary"}>{inv.status}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{format(inv.issueDate, "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.periodStart && inv.periodEnd
                          ? `${format(inv.periodStart, "MMM d")} – ${format(inv.periodEnd, "MMM d, yyyy")}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {invoices.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No invoices yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="uat" className="pt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            <UatCard projectId={project.id} canManage={canManage} uat={uatState} events={uatEvents} />
            <DocumentsCard
              title="UAT / acceptance documents"
              documents={projectDocRows}
              kinds={[
                { value: "UAT_ACCEPTANCE", label: "Signed acceptance" },
                { value: "OTHER", label: "Other" },
              ]}
              canManage={canManage}
              uploadAction={uploadProjectDocumentAction.bind(null, project.id)}
              deleteAction={deleteProjectDocumentAction}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
