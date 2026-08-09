import {
  FolderKanbanIcon,
  CheckSquareIcon,
  ClockIcon,
  ReceiptIcon,
  AlertTriangleIcon,
  BriefcaseIcon,
} from "lucide-react";
import { addDays } from "date-fns";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { startOfWeek } from "@/lib/week";
import { formatMoney } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireUser();
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 6);

  const isManager = user.role === "ADMIN" || user.role === "PM";
  const isFinance = user.role === "ADMIN" || user.role === "FINANCE";
  const isStaff = user.role === "EMPLOYEE" || user.role === "CONTRACTOR";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {isStaff && <StaffStats userId={user.id} weekStart={weekStart} weekEnd={weekEnd} />}
      {isManager && <ManagerStats userId={user.id} isAdmin={user.role === "ADMIN"} companyId={user.companyId} />}
      {isFinance && <FinanceStats companyId={user.companyId} />}
    </div>
  );
}

async function StaffStats({
  userId,
  weekStart,
  weekEnd,
}: {
  userId: string;
  weekStart: Date;
  weekEnd: Date;
}) {
  const [hoursAgg, activeAssignments, cardsThisWeek, awaitingSubmission] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { userId, date: { gte: weekStart, lte: weekEnd } },
      _sum: { hours: true },
    }),
    prisma.assignment.count({ where: { userId, status: "ACTIVE", milestone: { timeEntryOpen: true } } }),
    prisma.timeCard.findMany({ where: { userId, weekStartDate: weekStart }, select: { status: true } }),
    // Not scoped to the current week — a draft/rejected line from any past week still needs
    // submitting, and should keep nudging the user until it's dealt with, not silently drop off
    // the dashboard the moment the calendar rolls into a new week.
    prisma.timeCard.count({ where: { userId, status: { in: ["DRAFT", "REJECTED"] } } }),
  ]);

  const submitted = cardsThisWeek.filter((c) => c.status === "SUBMITTED").length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard
        label="Hours logged this week"
        value={Number(hoursAgg._sum.hours ?? 0)}
        icon={ClockIcon}
        sublabel={cardsThisWeek.length === 0 ? "Not started" : `${submitted} submitted`}
      />
      <StatCard label="Active assignments" value={activeAssignments} icon={BriefcaseIcon} />
      <StatCard
        label="Lines awaiting submission"
        value={awaitingSubmission}
        icon={CheckSquareIcon}
        tone={awaitingSubmission > 0 ? "warning" : "default"}
      />
    </div>
  );
}

async function ManagerStats({
  userId,
  isAdmin,
  companyId,
}: {
  userId: string;
  isAdmin: boolean;
  companyId: string;
}) {
  const projectScope = isAdmin ? { companyId } : { companyId, managerId: userId };

  const [projectCount, pendingApprovals, milestones] = await Promise.all([
    prisma.project.count({ where: { ...projectScope, status: "ACTIVE" } }),
    prisma.timeCard.count({
      where: { status: "SUBMITTED", ...(isAdmin ? {} : { approverId: userId }) },
    }),
    prisma.milestone.findMany({
      where: { project: projectScope, budgetHours: { not: null } },
      select: { id: true, budgetHours: true },
    }),
  ]);

  const hoursByMilestone = await prisma.timeEntry.groupBy({
    by: ["milestoneId"],
    where: { milestoneId: { in: milestones.map((m) => m.id) }, timeCard: { status: "APPROVED" } },
    _sum: { hours: true },
  });
  const usedMap = new Map(hoursByMilestone.map((h) => [h.milestoneId, Number(h._sum.hours ?? 0)]));
  const nearBudget = milestones.filter((m) => {
    const cap = Number(m.budgetHours);
    if (!cap) return false;
    return (usedMap.get(m.id) ?? 0) / cap >= 0.8;
  }).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label={isAdmin ? "Active projects" : "Your active projects"} value={projectCount} icon={FolderKanbanIcon} />
      <StatCard
        label="Pending approvals"
        value={pendingApprovals}
        icon={CheckSquareIcon}
        tone={pendingApprovals > 0 ? "warning" : "default"}
      />
      <StatCard
        label="Milestones near budget"
        value={nearBudget}
        icon={AlertTriangleIcon}
        tone={nearBudget > 0 ? "warning" : "default"}
        sublabel="80%+ of hours used"
      />
    </div>
  );
}

async function FinanceStats({ companyId }: { companyId: string }) {
  const [company, openInvoices, needsReconcile] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    prisma.invoice.findMany({
      where: { companyId, status: { in: ["DRAFT", "ISSUED", "RECONCILED"] } },
      include: { lines: true },
    }),
    prisma.invoice.count({ where: { companyId, status: "ISSUED", fiscalNumber: null } }),
  ]);

  const openValue = openInvoices.reduce(
    (sum, inv) => sum + inv.lines.reduce((s, l) => s + Number(l.amount), 0),
    0
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="Open invoices" value={openInvoices.length} icon={ReceiptIcon} />
      <StatCard label="Open invoice value" value={formatMoney(openValue, company.currency)} icon={ReceiptIcon} />
      <StatCard
        label="Needs reconciliation"
        value={needsReconcile}
        icon={AlertTriangleIcon}
        tone={needsReconcile > 0 ? "warning" : "default"}
      />
    </div>
  );
}
