import type { ReactNode } from "react";
import Link from "next/link";
import { addDays, format, startOfMonth } from "date-fns";
import {
  FolderKanbanIcon,
  CheckSquareIcon,
  ClockIcon,
  ReceiptIcon,
  AlertTriangleIcon,
  BriefcaseIcon,
  UsersIcon,
  BanknoteIcon,
  TrendingUpIcon,
  ScaleIcon,
  PlaneIcon,
  WalletIcon,
} from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InitialsAvatar } from "@/components/initials-avatar";
import { HourProgress } from "@/components/hour-progress";
import { DonutChart, DONUT_COLORS } from "@/components/charts/donut-chart";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can, STAFF_ONLY } from "@/lib/permissions";
import { startOfWeek, toDateParam } from "@/lib/week";
import { formatMoney, formatNumber } from "@/lib/format";
import { loadExternalCost } from "@/lib/external-cost";
import { computeProjectRevenue } from "@/lib/revenue";

export default async function DashboardPage() {
  const user = await requireUser();
  const isManager = user.role === "ADMIN" || user.role === "PM";
  const canReports = can(user, "reports:view"); // Admin + Finance — financial sections
  const isStaff = !isManager && !canReports;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {isStaff ? "Your week at a glance." : "Company health — delivery, revenue, and what needs attention."}
        </p>
      </div>
      {isStaff ? (
        <StaffDashboard userId={user.id} />
      ) : (
        <ManagerDashboard userId={user.id} isAdmin={user.role === "ADMIN"} companyId={user.companyId} canReports={canReports} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Staff — an individual's own week.
// ---------------------------------------------------------------------------------------------
async function StaffDashboard({ userId }: { userId: string }) {
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 6);
  const eightWeeksAgo = addDays(weekStart, -7 * 7);

  const [hoursAgg, activeAssignments, cardsThisWeek, awaitingSubmission, recentEntries] = await Promise.all([
    prisma.timeEntry.aggregate({ where: { userId, date: { gte: weekStart, lte: weekEnd } }, _sum: { hours: true } }),
    prisma.assignment.count({ where: { userId, status: "ACTIVE", milestone: { timeEntryOpen: true } } }),
    prisma.timeCard.findMany({ where: { userId, weekStartDate: weekStart }, select: { status: true } }),
    prisma.timeCard.count({ where: { userId, status: { in: ["DRAFT", "REJECTED"] } } }),
    prisma.timeEntry.findMany({
      where: { userId, date: { gte: eightWeeksAgo, lte: weekEnd }, timeCard: { status: { not: "DRAFT" } } },
      select: { date: true, hours: true },
    }),
  ]);
  const submitted = cardsThisWeek.filter((c) => c.status === "SUBMITTED").length;

  // Weekly hours over the last 8 weeks.
  const byWeek = new Map<string, number>();
  for (const e of recentEntries) {
    const key = toDateParam(startOfWeek(e.date));
    byWeek.set(key, (byWeek.get(key) ?? 0) + Number(e.hours));
  }
  const weekBars = Array.from({ length: 8 }, (_, i) => {
    const ws = addDays(weekStart, -7 * (7 - i));
    return { label: format(ws, "MMM d"), value: Math.round((byWeek.get(toDateParam(ws)) ?? 0) * 10) / 10 };
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Hours logged this week" value={Number(hoursAgg._sum.hours ?? 0)} icon={ClockIcon} sublabel={cardsThisWeek.length === 0 ? "Not started" : `${submitted} submitted`} />
        <StatCard label="Active assignments" value={activeAssignments} icon={BriefcaseIcon} />
        <StatCard label="Lines awaiting submission" value={awaitingSubmission} icon={CheckSquareIcon} tone={awaitingSubmission > 0 ? "warning" : "default"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your hours — last 8 weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <MiniBarChart data={weekBars} height={120} valueFormatter={(v) => `${v}h`} />
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Manager / Finance — company overview.
// ---------------------------------------------------------------------------------------------
async function ManagerDashboard({
  userId,
  isAdmin,
  companyId,
  canReports,
}: {
  userId: string;
  isAdmin: boolean;
  companyId: string;
  canReports: boolean;
}) {
  const projectScope = isAdmin ? { companyId } : { companyId, managerId: userId };
  const today = new Date();
  const todayStr = toDateParam(today);
  const in30 = toDateParam(addDays(today, 30));

  const [company, projects, activePeople, pendingApprovals, upcomingLeave] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { currency: true } }),
    prisma.project.findMany({
      where: projectScope,
      include: {
        client: { select: { name: true } },
        milestones: { select: { id: true, salesPrice: true, budgetHours: true, cost: true, status: true, billable: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.count({ where: { companyId, active: true, ...STAFF_ONLY } }),
    prisma.timeCard.count({ where: { status: "SUBMITTED", ...(isAdmin ? {} : { approverId: userId }) } }),
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", user: { companyId }, startDate: { lte: addDays(today, 30) }, endDate: { gte: today } },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: "asc" },
      take: 8,
    }),
  ]);
  const currency = company.currency;

  const milestoneIds = projects.flatMap((p) => p.milestones.map((m) => m.id));
  const assignments = milestoneIds.length
    ? await prisma.assignment.findMany({
        where: { milestoneId: { in: milestoneIds } },
        select: { id: true, milestoneId: true, costRate: true, user: { select: { employment: { select: { costRate: true } } } } },
      })
    : [];
  const assignmentIds = assignments.map((a) => a.id);

  const [apprByMs, costEntries, planByAsg] = await Promise.all([
    milestoneIds.length
      ? prisma.timeEntry.groupBy({ by: ["milestoneId"], where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } }, _sum: { hours: true } })
      : Promise.resolve([]),
    milestoneIds.length
      ? prisma.timeEntry.findMany({
          where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
          select: { milestoneId: true, hours: true, costRate: true, assignment: { select: { costRate: true } } },
        })
      : Promise.resolve([]),
    assignmentIds.length
      ? prisma.assignmentPlan.groupBy({ by: ["assignmentId"], where: { assignmentId: { in: assignmentIds } }, _sum: { hours: true } })
      : Promise.resolve([]),
  ]);

  const apprMsMap = new Map(apprByMs.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
  const costByMs = new Map<string, number>();
  for (const e of costEntries) {
    const rate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
    costByMs.set(e.milestoneId, (costByMs.get(e.milestoneId) ?? 0) + Number(e.hours) * rate);
  }
  const planAsgMap = new Map(planByAsg.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
  const currentRateByAsg = new Map(assignments.map((a) => [a.id, Number(a.user.employment?.costRate ?? 0)]));
  const asgByMs = new Map<string, string[]>();
  for (const a of assignments) {
    const arr = asgByMs.get(a.milestoneId) ?? [];
    arr.push(a.id);
    asgByMs.set(a.milestoneId, arr);
  }

  // Per-project revenue + a few delivery aggregates.
  type ProjRow = { id: string; name: string; client: string; earned: number; margin: number; approvedHours: number; budgetHours: number; internal: boolean };
  const projRows: ProjRow[] = [];
  const totals = { earned: 0, forecast: 0, margin: 0, forecastMargin: 0, cost: 0, overhead: 0 };
  let activeProjects = 0;
  let nearBudget = 0;
  const hoursByProject: { name: string; value: number }[] = [];
  let billableHours = 0;
  let internalHours = 0;

  // Subcontractor bills attributed to these projects, in the reporting currency — company margin
  // has to carry them the same way the Revenue report does.
  const { byProject: externalByProject } = await loadExternalCost(companyId, currency, projects.map((p) => p.id));

  for (const p of projects) {
    if (p.status === "ACTIVE") activeProjects++;
    const internal =
      p.isInternal || (!p.milestones.some((m) => m.billable) && Number(p.contractValue ?? p.budgetAmount ?? 0) <= 0);

    let projHours = 0;
    let cost = 0;
    let forecastCost = 0;
    const milestoneInputs = p.milestones.map((m) => {
      const approvedHours = apprMsMap.get(m.id) ?? 0;
      const plannedHours = (asgByMs.get(m.id) ?? []).reduce((s, aId) => s + (planAsgMap.get(aId) ?? 0), 0);
      cost += costByMs.get(m.id) ?? 0;
      for (const aId of asgByMs.get(m.id) ?? []) forecastCost += (planAsgMap.get(aId) ?? 0) * (currentRateByAsg.get(aId) ?? 0);
      projHours += approvedHours;
      if (m.billable) billableHours += approvedHours;
      else internalHours += approvedHours;
      const cap = m.budgetHours ? Number(m.budgetHours) : 0;
      if (cap > 0 && approvedHours / cap >= 0.8) nearBudget++;
      return { salesPrice: Number(m.salesPrice), budgetHours: cap, status: m.status, approvedHours, plannedHours, billable: m.billable };
    });

    const budgetHours = p.budgetHours != null ? Number(p.budgetHours) : milestoneInputs.reduce((s, m) => s + m.budgetHours, 0);
    if (projHours > 0) hoursByProject.push({ name: p.name, value: Math.round(projHours * 10) / 10 });

    if (internal) {
      totals.overhead += Math.round(cost * 100) / 100;
      continue;
    }
    const rev = computeProjectRevenue({
      billingType: p.billingType,
      contractValue: Number(p.contractValue ?? p.budgetAmount ?? 0),
      budgetHours,
      internalCost: cost,
      // Partner bills booked to this project — margin here must not ignore them either.
      externalCost: externalByProject.get(p.id) ?? 0,
      forecastCost,
      milestones: milestoneInputs,
    });
    totals.earned += rev.earnedRevenue;
    totals.forecast += rev.forecastRevenue;
    totals.margin += rev.margin;
    totals.forecastMargin += rev.forecastMargin;
    totals.cost += rev.totalCost;
    projRows.push({ id: p.id, name: p.name, client: p.client.name, earned: rev.earnedRevenue, margin: rev.margin, approvedHours: rev.approvedHours, budgetHours, internal });
  }

  const operatingMargin = totals.margin - totals.overhead;
  const marginPct = totals.earned > 0 ? (totals.margin / totals.earned) * 100 : null;

  // ---- Invoices: open value, needs-reconcile, recognized last 6 months ----
  const invoices = canReports
    ? await prisma.invoice.findMany({
        where: { companyId },
        select: { status: true, type: true, issueDate: true, fiscalNumber: true, projectId: true, lines: { select: { amount: true } } },
      })
    : [];
  const invTotal = (lines: { amount: unknown }[]) => lines.reduce((s, l) => s + Number(l.amount), 0);
  let openValue = 0;
  let openCount = 0;
  let needsReconcile = 0;
  const months = Array.from({ length: 6 }, (_, i) => startOfMonth(new Date(today.getFullYear(), today.getMonth() - (5 - i), 1)));
  const invByMonth = new Map(months.map((mo) => [format(mo, "yyyy-MM"), 0]));
  for (const inv of invoices) {
    const net = invTotal(inv.lines);
    if (inv.status === "DRAFT" || inv.status === "ISSUED" || inv.status === "RECONCILED") {
      openValue += net;
      openCount++;
    }
    if (inv.status === "ISSUED" && !inv.fiscalNumber) needsReconcile++;
    if (inv.status === "ISSUED" || inv.status === "RECONCILED" || inv.status === "PAID") {
      const key = format(startOfMonth(inv.issueDate), "yyyy-MM");
      if (invByMonth.has(key)) invByMonth.set(key, invByMonth.get(key)! + net * (inv.type === "CREDIT_NOTE" ? -1 : 1));
    }
  }
  const invoicedBars = months.map((mo) => ({ label: format(mo, "MMM"), value: Math.round((invByMonth.get(format(mo, "yyyy-MM")) ?? 0) * 100) / 100 }));

  // ---- Forecast by quarter (billable planned hours × rate; overhead excluded) ----
  const quarters = Array.from({ length: 4 }, (_, i) => {
    const base = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + i * 3, 1);
    return { start: base, end: new Date(base.getFullYear(), base.getMonth() + 3, 1), label: `Q${Math.floor(base.getMonth() / 3) + 1} '${String(base.getFullYear()).slice(2)}` };
  });
  const forecastBars = quarters.map((q) => ({ label: q.label, value: 0 }));
  if (canReports && assignmentIds.length) {
    const planDetail = await prisma.assignmentPlan.findMany({ where: { assignmentId: { in: assignmentIds } }, select: { assignmentId: true, weekStartDate: true, hours: true } });
    const msMeta = new Map<string, { salesPrice: number; billable: boolean; internal: boolean }>();
    for (const p of projects) {
      const internal = p.isInternal || (!p.milestones.some((m) => m.billable) && Number(p.contractValue ?? p.budgetAmount ?? 0) <= 0);
      for (const m of p.milestones) msMeta.set(m.id, { salesPrice: Number(m.salesPrice), billable: m.billable, internal });
    }
    const asgMs = new Map(assignments.map((a) => [a.id, a.milestoneId]));
    for (const pr of planDetail) {
      const meta = msMeta.get(asgMs.get(pr.assignmentId) ?? "");
      if (!meta || meta.internal || !meta.billable) continue;
      const qi = quarters.findIndex((q) => pr.weekStartDate >= q.start && pr.weekStartDate < q.end);
      if (qi < 0) continue;
      forecastBars[qi].value += Number(pr.hours) * meta.salesPrice;
    }
    forecastBars.forEach((b) => (b.value = Math.round(b.value * 100) / 100));
  }

  const donutHours = topSegments(hoursByProject, 5);
  const mixDonut = [
    { label: "Billable", value: Math.round(billableHours * 10) / 10, colorClass: DONUT_COLORS[2] },
    { label: "Internal / overhead", value: Math.round(internalHours * 10) / 10, colorClass: DONUT_COLORS[3] },
  ];
  const topProjects = [...projRows].sort((a, b) => b.earned - a.earned).slice(0, 6);
  const m = (v: number) => formatMoney(v, currency);

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Active projects" value={activeProjects} icon={FolderKanbanIcon} sublabel={`${projects.length} total`} />
        <StatCard label="People" value={activePeople} icon={UsersIcon} sublabel="active" />
        <StatCard label="Pending approvals" value={pendingApprovals} icon={CheckSquareIcon} tone={pendingApprovals > 0 ? "warning" : "default"} />
        {canReports ? (
          <>
            <StatCard label="Earned revenue" value={m(totals.earned)} icon={BanknoteIcon} sublabel="approved to date" />
            <StatCard label="Gross margin" value={m(totals.margin)} icon={ScaleIcon} sublabel={marginPct != null ? `${formatNumber(marginPct)}% margin` : "—"} tone={totals.margin < 0 ? "destructive" : "default"} />
            <StatCard label="Open invoices" value={m(openValue)} icon={ReceiptIcon} sublabel={`${openCount} open${needsReconcile > 0 ? ` · ${needsReconcile} to reconcile` : ""}`} tone={needsReconcile > 0 ? "warning" : "default"} />
          </>
        ) : (
          <>
            <StatCard label="Milestones near budget" value={nearBudget} icon={AlertTriangleIcon} tone={nearBudget > 0 ? "warning" : "default"} sublabel="80%+ hours used" />
            <StatCard label="Hours logged" value={formatNumber(billableHours + internalHours)} icon={ClockIcon} sublabel="approved, all projects" />
            <StatCard label="People off (30d)" value={new Set(upcomingLeave.map((l) => l.userId)).size} icon={PlaneIcon} />
          </>
        )}
      </div>

      {/* Financial view (Admin / Finance): operating margin band + forecast/invoiced charts */}
      {canReports && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Forecast revenue" value={m(totals.forecast)} icon={TrendingUpIcon} sublabel="from current plan" />
            <StatCard label="Forecast margin" value={m(totals.forecastMargin)} icon={TrendingUpIcon} sublabel="if plan delivered" tone={totals.forecastMargin < 0 ? "destructive" : "default"} />
            <StatCard label="Internal / overhead" value={m(totals.overhead)} icon={WalletIcon} sublabel="non-billable cost" tone={totals.overhead > 0 ? "warning" : "default"} />
            <StatCard label="Operating margin" value={m(operatingMargin)} icon={ScaleIcon} sublabel="gross − overhead" tone={operatingMargin < 0 ? "destructive" : "default"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Forecast by quarter</CardTitle>
                <Link href="/revenue" className="text-xs text-muted-foreground hover:underline">Revenue →</Link>
              </CardHeader>
              <CardContent>
                {forecastBars.some((b) => b.value > 0) ? <MiniBarChart data={forecastBars} height={130} valueFormatter={m} /> : <Empty>No planned billable work in the next 4 quarters.</Empty>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Invoiced — last 6 months</CardTitle>
                <Link href="/invoices" className="text-xs text-muted-foreground hover:underline">Invoices →</Link>
              </CardHeader>
              <CardContent>
                {invoicedBars.some((b) => b.value !== 0) ? <MiniBarChart data={invoicedBars} height={130} valueFormatter={m} /> : <Empty>No invoices issued yet.</Empty>}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Delivery mix donuts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hours by project</CardTitle>
            <p className="text-xs text-muted-foreground">Approved time, top projects.</p>
          </CardHeader>
          <CardContent>
            {donutHours.some((s) => s.value > 0) ? (
              <DonutChart segments={donutHours} centerLabel={`${formatNumber(billableHours + internalHours)}h`} centerSublabel="logged" />
            ) : (
              <Empty>No approved time yet.</Empty>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billable vs internal</CardTitle>
            <p className="text-xs text-muted-foreground">Where approved hours go.</p>
          </CardHeader>
          <CardContent>
            {billableHours + internalHours > 0 ? (
              <DonutChart segments={mixDonut} centerLabel={`${billableHours + internalHours > 0 ? Math.round((billableHours / (billableHours + internalHours)) * 100) : 0}%`} centerSublabel="billable" />
            ) : (
              <Empty>No approved time yet.</Empty>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top projects + who's out */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Top projects</CardTitle>
            <Link href="/projects" className="text-xs text-muted-foreground hover:underline">All projects →</Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {topProjects.length === 0 && <Empty>No client projects yet.</Empty>}
            {topProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-3 rounded-md hover:bg-muted/50 p-1.5 -m-1.5">
                <InitialsAvatar name={p.client} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    {canReports && <span className="tabular-nums text-sm shrink-0">{m(p.earned)}</span>}
                  </div>
                  <div className="mt-1">
                    <HourProgress used={p.approvedHours} cap={p.budgetHours || null} />
                  </div>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Who&apos;s out</CardTitle>
            <Link href="/vacations" className="text-xs text-muted-foreground hover:underline">Vacations →</Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {upcomingLeave.length === 0 && <Empty>Nobody scheduled off in the next 30 days.</Empty>}
            {upcomingLeave.map((l) => {
              const out = toDateParam(l.startDate) <= todayStr && todayStr <= toDateParam(l.endDate);
              return (
                <div key={l.id} className="flex items-center gap-2.5 text-sm">
                  <InitialsAvatar name={l.user.name} className="size-7 text-[11px]" />
                  <span className="font-medium truncate">{l.user.name}</span>
                  <Badge variant={out ? "default" : "secondary"} className="ml-auto shrink-0">
                    {out ? "out now" : format(l.startDate, "MMM d")}
                  </Badge>
                </div>
              );
            })}
            {upcomingLeave.length > 0 && <p className="text-[11px] text-muted-foreground">Out now or starting within 30 days · {in30.slice(5)}</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground py-4 text-center">{children}</p>;
}

/** Top N segments by value + an "Others" bucket, colored from the shared donut palette. */
function topSegments(rows: { name: string; value: number }[], n: number) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n).reduce((s, r) => s + r.value, 0);
  const segs = top.map((r, i) => ({ label: r.name, value: r.value, colorClass: DONUT_COLORS[i % DONUT_COLORS.length] }));
  if (rest > 0) segs.push({ label: "Others", value: Math.round(rest * 10) / 10, colorClass: DONUT_COLORS[5] });
  return segs;
}
