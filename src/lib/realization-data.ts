import "server-only";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/permissions";
import { realizationMetrics, effectiveBillRate } from "@/lib/revenue";

export type ConsultantRow = {
  userId: string;
  userName: string;
  workedHours: number;
  billableHours: number;
  billedHours: number;
  realizationPct: number;
  effectiveHourlyRate: number;
  cost: number;
  revenue: number;
  margin: number;
};

export type RealizationPeriodMeta = { key: string; label: string };

// The selectable periods for the per-consultant view (index 0 is the default).
function periodRanges(now: Date): { key: string; label: string; from: Date; to: Date }[] {
  const y = now.getFullYear();
  const mo = now.getMonth();
  const nextMonth = new Date(y, mo + 1, 1);
  const qStart = new Date(y, Math.floor(mo / 3) * 3, 1);
  const nextQ = new Date(y, Math.floor(mo / 3) * 3 + 3, 1);
  return [
    { key: "month", label: "This month", from: new Date(y, mo, 1), to: nextMonth },
    { key: "quarter", label: "This quarter", from: qStart, to: nextQ },
    { key: "year", label: "This year", from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) },
    { key: "last12", label: "Last 12 months", from: new Date(y, mo - 11, 1), to: nextMonth },
    { key: "all", label: "All time", from: new Date(2000, 0, 1), to: new Date(9999, 0, 1) },
  ];
}

/** Per-consultant realization for each selectable period, over the projects the user can see. Every
 *  aggregate comes from APPROVED time entries only; bill/cost use the frozen per-entry rate with the
 *  assignment snapshot as fallback. Callers MUST gate on `rates:view:any` before invoking this — it
 *  exposes cost/margin/rate. */
export async function computeConsultantRealization(
  user: SessionUser,
): Promise<{ periods: RealizationPeriodMeta[]; byPeriod: Record<string, ConsultantRow[]> }> {
  const projectIds = await visibleProjectIds(user);
  const projectWhere = projectIds === "ALL" ? { companyId: user.companyId } : { companyId: user.companyId, id: { in: projectIds } };

  const entries = await prisma.timeEntry.findMany({
    where: { timeCard: { status: "APPROVED" }, milestone: { project: projectWhere } },
    select: {
      userId: true,
      date: true,
      hours: true,
      costRate: true,
      billRate: true,
      invoiceLineId: true,
      user: { select: { name: true } },
      milestone: {
        select: { billable: true, salesPrice: true, budgetHours: true, project: { select: { billingType: true } } },
      },
      assignment: { select: { costRate: true, billRate: true } },
    },
  });

  const ranges = periodRanges(new Date());
  const byPeriod: Record<string, ConsultantRow[]> = {};

  for (const range of ranges) {
    // Accumulate raw hours/cost/revenue per user for this period, then derive metrics purely.
    type Acc = { name: string; worked: number; billable: number; billed: number; cost: number; revenue: number };
    const acc = new Map<string, Acc>();
    for (const e of entries) {
      if (e.date < range.from || e.date >= range.to) continue;
      const hours = Number(e.hours);
      const costRate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
      const billRate = effectiveBillRate({
        entryBillRate: e.billRate == null ? null : Number(e.billRate),
        assignmentBillRate: e.assignment.billRate == null ? null : Number(e.assignment.billRate),
        milestoneSalesPrice: Number(e.milestone.salesPrice),
        milestoneBudgetHours: e.milestone.budgetHours == null ? null : Number(e.milestone.budgetHours),
        billingType: e.milestone.project.billingType,
      });
      const a = acc.get(e.userId) ?? { name: e.user.name, worked: 0, billable: 0, billed: 0, cost: 0, revenue: 0 };
      a.worked += hours;
      if (e.milestone.billable) a.billable += hours;
      a.cost += hours * costRate;
      if (e.invoiceLineId) {
        a.billed += hours;
        a.revenue += hours * billRate;
      }
      acc.set(e.userId, a);
    }
    byPeriod[range.key] = [...acc.entries()]
      .map(([userId, a]) => {
        const r = realizationMetrics({ workedHours: a.worked, billableHours: a.billable, billedHours: a.billed, revenue: a.revenue });
        const cost = Math.round(a.cost * 100) / 100;
        const revenue = Math.round(a.revenue * 100) / 100;
        return {
          userId,
          userName: a.name,
          workedHours: r.workedHours,
          billableHours: r.billableHours,
          billedHours: r.billedHours,
          realizationPct: r.realizationPct,
          effectiveHourlyRate: r.effectiveHourlyRate,
          cost,
          revenue,
          margin: Math.round((revenue - cost) * 100) / 100,
        };
      })
      .sort((x, y) => y.revenue - x.revenue || y.workedHours - x.workedHours);
  }

  return { periods: ranges.map((r) => ({ key: r.key, label: r.label })), byPeriod };
}
