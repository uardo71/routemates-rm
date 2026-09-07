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
import { DonutChart } from "@/components/charts/donut-chart";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { loadExternalCost } from "@/lib/external-cost";
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
// Visual language for the Milestones overview: label, donut/dot fill, and a very light row tint per
// status. ABSORBED is a *derived* state (whole value moved onto another deal), not a DB status.
type MsDisplayStatus = "PLANNED" | "ACTIVE" | "COMPLETE" | "INVOICED" | "ABSORBED";
const MS_STATUS_ORDER: MsDisplayStatus[] = ["ACTIVE", "PLANNED", "COMPLETE", "INVOICED", "ABSORBED"];
const MS_STATUS_LABEL: Record<MsDisplayStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "In progress",
  COMPLETE: "Completed",
  INVOICED: "Invoiced",
  ABSORBED: "Absorbed",
};
const MS_STATUS_FILL: Record<MsDisplayStatus, string> = {
  PLANNED: "fill-amber-500 dark:fill-amber-400",
  ACTIVE: "fill-blue-500 dark:fill-blue-400",
  COMPLETE: "fill-emerald-500 dark:fill-emerald-400",
  INVOICED: "fill-cyan-500 dark:fill-cyan-400",
  ABSORBED: "fill-violet-500 dark:fill-violet-400",
};
const MS_STATUS_DOT: Record<MsDisplayStatus, string> = {
  PLANNED: "bg-amber-500 dark:bg-amber-400",
  ACTIVE: "bg-blue-500 dark:bg-blue-400",
  COMPLETE: "bg-emerald-500 dark:bg-emerald-400",
  INVOICED: "bg-cyan-500 dark:bg-cyan-400",
  ABSORBED: "bg-violet-500 dark:bg-violet-400",
};
// Whole-row tint by status so the Milestones table reads at a glance. A left accent border plus a
// light fill (kept subtle enough that the row text stays legible in both themes).
const MS_STATUS_ROW: Record<MsDisplayStatus, string> = {
  PLANNED: "bg-amber-500/[0.07] border-l-2 border-l-amber-500 hover:bg-amber-500/[0.12]",
  ACTIVE: "bg-blue-500/[0.07] border-l-2 border-l-blue-500 hover:bg-blue-500/[0.12]",
  COMPLETE: "bg-emerald-500/[0.08] border-l-2 border-l-emerald-500 hover:bg-emerald-500/[0.13]",
  INVOICED: "bg-cyan-500/[0.08] border-l-2 border-l-cyan-500 hover:bg-cyan-500/[0.13]",
  ABSORBED: "bg-violet-500/[0.1] border-l-2 border-l-violet-500 hover:bg-violet-500/[0.15]",
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

  // Subcontractor bills booked to this project. Cost data, so it follows the same gate as rates —
  // filtered in the query, not hidden in the component.
  const externalBills = canViewRates
    ? (await loadExternalCost(user.companyId, project.company.currency, [project.id])).bills
    : [];
  const externalTotal =
    Math.round(externalBills.reduce((s, b) => s + (b.baseAmount ?? 0), 0) * 100) / 100;
  const externalUnconverted = externalBills.filter((b) => b.baseAmount === null).length;
  const msNameById = new Map(project.milestones.map((m) => [m.id, m.name]));
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

  // Milestone value adjustments (money removed/absorbed) → effective value per milestone, plus a
  // "fully absorbed" flag when the whole value was taken out and moved onto another deal. Drives the
  // overview status donut, the Milestones-tab highlights, and the effective-value column.
  const msAdjustments = milestoneIds.length
    ? await prisma.milestoneAdjustment.findMany({
        where: { milestoneId: { in: milestoneIds } },
        select: { milestoneId: true, amount: true, opportunity: { select: { id: true, number: true, name: true } } },
      })
    : [];
  const adjByMs = new Map<string, number>();
  const absorbedOppByMs = new Map<string, { id: string; number: string | null; name: string }>();
  for (const a of msAdjustments) {
    const amt = Number(a.amount);
    adjByMs.set(a.milestoneId, (adjByMs.get(a.milestoneId) ?? 0) + amt);
    if (amt < 0 && a.opportunity && !absorbedOppByMs.has(a.milestoneId)) absorbedOppByMs.set(a.milestoneId, a.opportunity);
  }
  type ProjMilestone = (typeof project.milestones)[number];
  const baseValueOf = (m: ProjMilestone) =>
    project.billingType === "FIXED_PRICE" ? Number(m.salesPrice) : Number(m.salesPrice) * Number(m.budgetHours ?? 0);
  const effValueOf = (m: ProjMilestone) => baseValueOf(m) + (adjByMs.get(m.id) ?? 0);
  const isFullyAbsorbed = (m: ProjMilestone) => {
    const base = baseValueOf(m);
    return base > 0 && (adjByMs.get(m.id) ?? 0) < 0 && effValueOf(m) <= 0.005;
  };
  const displayStatus = (m: ProjMilestone): MsDisplayStatus =>
    isFullyAbsorbed(m) && m.status !== "COMPLETE" && m.status !== "INVOICED" ? "ABSORBED" : (m.status as MsDisplayStatus);

  // Status distribution for the overview donut + the highlight strip. Sized by value for rate-viewers
  // (money is the reality the owner cares about), by milestone count otherwise (keeps rates hidden).
  const statusCount = new Map<MsDisplayStatus, number>();
  const statusValue = new Map<MsDisplayStatus, number>();
  for (const m of project.milestones) {
    const st = displayStatus(m);
    statusCount.set(st, (statusCount.get(st) ?? 0) + 1);
    // Sized by EFFECTIVE value: an absorbed milestone's worth has moved onto another deal, so it
    // contributes 0 here and the total reflects the project's real remaining value (not the pre-
    // adjustment scope).
    statusValue.set(st, (statusValue.get(st) ?? 0) + effValueOf(m));
  }
  const totalMsValue = Math.round([...statusValue.values()].reduce((a, b) => a + b, 0) * 100) / 100;
  // Absorbed milestones hold €0 effective value (moved onto another deal) so they don't appear in the
  // value donut — surface their count + the value that moved out as a caption instead.
  const absorbedCount = statusCount.get("ABSORBED") ?? 0;
  const absorbedValueOut =
    Math.round(
      project.milestones.filter((m) => displayStatus(m) === "ABSORBED").reduce((s, m) => s + baseValueOf(m), 0) * 100,
    ) / 100;

  // Round the roll-up: summing per-milestone budget hours (often repeating-decimal even-splits)
  // otherwise surfaces float noise like 2959.999999999999h.
  const allocatedHours = Math.round(project.milestones.reduce((sum, m) => sum + Number(m.budgetHours ?? 0), 0) * 100) / 100;
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
                <CardTitle>Milestones by status</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {canViewRates ? "Share of milestone value by delivery status." : "Milestones grouped by delivery status."}
                </p>
              </CardHeader>
              <CardContent>
                {project.milestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No milestones yet.</p>
                ) : (
                  <DonutChart
                    centerLabel={
                      canViewRates
                        ? formatMoney(totalMsValue, project.company.currency)
                        : String(project.milestones.length)
                    }
                    centerSublabel={canViewRates ? "total value" : "milestones"}
                    segments={MS_STATUS_ORDER.filter((s) =>
                      (canViewRates ? statusValue.get(s) ?? 0 : statusCount.get(s) ?? 0) > 0,
                    ).map((s) => ({
                      label: `${MS_STATUS_LABEL[s]} · ${statusCount.get(s) ?? 0}`,
                      value: canViewRates ? statusValue.get(s) ?? 0 : statusCount.get(s) ?? 0,
                      colorClass: MS_STATUS_FILL[s],
                    }))}
                  />
                )}
                {absorbedCount > 0 && (
                  <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-full bg-violet-500 dark:bg-violet-400" />
                    <span>
                      {absorbedCount} milestone{absorbedCount === 1 ? "" : "s"} absorbed
                      {canViewRates ? ` · ${formatMoney(absorbedValueOut, project.company.currency)} moved to other deals` : ""} — excluded from total
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {canViewRates && externalBills.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Building2Icon className="size-4 text-muted-foreground" />
                  External costs
                  <span className="font-normal text-muted-foreground">({externalBills.length})</span>
                  <span className="ml-auto font-mono text-sm">
                    {formatMoney(externalTotal, project.company.currency)}
                  </span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Vendor bills attributed to this project. Both to-pay and paid count toward margin — a committed
                  bill is a real cost.
                  {externalUnconverted > 0 && (
                    <span className="ml-1 text-amber-600">
                      {externalUnconverted} bill{externalUnconverted === 1 ? "" : "s"} excluded from the total (no exchange rate).
                    </span>
                  )}
                </p>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Milestone</TableHead>
                      <TableHead>Invoice date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {externalBills.map((b) => (
                      <TableRow key={b.id} className="group/row">
                        <TableCell>
                          <Link href={`/vendors/${b.id}`} className="font-medium group-hover/row:underline">
                            {b.vendorName}
                          </Link>
                          {b.invoiceNumber && (
                            <div className="text-[11px] text-muted-foreground tabular-nums">{b.invoiceNumber}</div>
                          )}
                        </TableCell>
                        <TableCell className="max-w-64 truncate text-muted-foreground">{b.description ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {b.milestoneId ? (msNameById.get(b.milestoneId) ?? "—") : <span className="opacity-50">project-level</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {b.invoiceDate ? format(parseISO(b.invoiceDate), "MMM d, yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={b.status === "PAID" ? "secondary" : "outline"}>
                            {b.status === "PAID" ? "Paid" : "To pay"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatMoney(b.amount, b.currency)}
                          {b.baseAmount === null && (
                            <div className="text-[10px] font-normal text-amber-600">no rate</div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2">
                      <TableCell colSpan={5} className="text-right font-medium">
                        Total external cost ({project.company.currency})
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {formatMoney(externalTotal, project.company.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
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
            <CardContent className="flex flex-col gap-4">
              {project.milestones.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {MS_STATUS_ORDER.filter((s) => (statusCount.get(s) ?? 0) > 0).map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1 text-xs font-medium"
                    >
                      <span className={cn("size-2 rounded-full", MS_STATUS_DOT[s])} />
                      {MS_STATUS_LABEL[s]}
                      <span className="tabular-nums text-muted-foreground">{statusCount.get(s) ?? 0}</span>
                    </span>
                  ))}
                </div>
              )}
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
                  {project.milestones.map((m) => {
                    const st = displayStatus(m);
                    const absorbedOpp = absorbedOppByMs.get(m.id);
                    return (
                    <TableRow key={m.id} className={MS_STATUS_ROW[st]}>
                      <TableCell>
                        <Link
                          href={`/projects/${project.id}/milestones/${m.id}`}
                          className="flex items-center gap-2.5 font-medium hover:underline"
                        >
                          <span className={cn("size-2 shrink-0 rounded-full", MS_STATUS_DOT[st])} />
                          {m.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={st === "ABSORBED" ? "outline" : MILESTONE_STATUS_TONE[m.status] ?? "secondary"} className={cn(st === "ABSORBED" && "border-violet-400/60 bg-violet-500/10 text-violet-600 dark:text-violet-300")}>
                            {MS_STATUS_LABEL[st]}
                          </Badge>
                          {st === "ABSORBED" && absorbedOpp && (
                            <Link href={`/opportunities/${absorbedOpp.id}`} className="font-mono text-[11px] text-primary hover:underline">
                              → {absorbedOpp.number ?? absorbedOpp.name}
                            </Link>
                          )}
                        </div>
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
                          {(() => {
                            if (project.billingType !== "FIXED_PRICE" && !m.budgetHours) {
                              return `${formatMoney(m.salesPrice, project.company.currency)}/h`;
                            }
                            const base = baseValueOf(m);
                            const eff = effValueOf(m);
                            const adjusted = Math.abs(eff - base) > 0.005;
                            if (!adjusted) return formatMoney(base, project.company.currency);
                            return (
                              <span className="flex flex-col items-end leading-tight">
                                <span className="text-xs text-muted-foreground line-through">{formatMoney(base, project.company.currency)}</span>
                                <span className={cn(eff <= 0.005 && "text-violet-600 dark:text-violet-300")}>{formatMoney(eff, project.company.currency)}</span>
                              </span>
                            );
                          })()}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground">
                        {m._count.assignments} people · {m._count.tasks} tasks
                      </TableCell>
                    </TableRow>
                    );
                  })}
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
