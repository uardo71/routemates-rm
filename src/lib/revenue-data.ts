import "server-only";
import type { ProjectBillingType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/permissions";
import { computeProjectRevenue } from "@/lib/revenue";

export type RevenueRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  billingType: ProjectBillingType;
  currency: string;
  contractValue: number;
  budgetHours: number;
  plannedHours: number;
  approvedHours: number;
  unplannedHours: number;
  forecastRevenue: number;
  earnedRevenue: number;
  recognizedRevenue: number;
  cost: number;
  margin: number;
  /** Projected cost of the whole plan (planned hours × current cost rate). */
  forecastCost: number;
  /** Projected margin if the plan is delivered (forecast revenue − forecast cost). */
  forecastMargin: number;
  /** Time-phased forecast revenue for the next 4 quarters (index-aligned to quarterLabels). */
  quarterly: number[];
  /** Time-phased forecast revenue for the next 12 months (index-aligned to monthKeys/monthLabels). */
  monthly: number[];
};

// Internal / non-revenue projects: pure cost (overhead), shown separately with no margin.
export type OverheadRow = {
  projectId: string;
  projectName: string;
  clientName: string;
  billingType: ProjectBillingType;
  currency: string;
  isInternal: boolean;
  plannedHours: number;
  approvedHours: number;
  cost: number;
};

export type CompanyRevenue = {
  rows: RevenueRow[];
  overhead: OverheadRow[];
  quarterLabels: string[];
  /** Month buckets for the next 12 months, e.g. "2026-08". */
  monthKeys: string[];
  /** Display labels for the month buckets, e.g. "Aug '26". */
  monthLabels: string[];
  companyCurrency: string;
};

/** Assemble per-project revenue/forecast/cost/margin for every project the user can see, plus the
 *  overhead (internal) projects and the forward quarterly forecast. Single source of truth shared by
 *  the Revenue report and the owner Command Center. */
export async function computeCompanyRevenue(user: SessionUser): Promise<CompanyRevenue> {
  const projectIds = await visibleProjectIds(user);
  const where =
    projectIds === "ALL" ? { companyId: user.companyId } : { companyId: user.companyId, id: { in: projectIds } };

  const [projects, company] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        client: { select: { name: true } },
        milestones: { select: { id: true, salesPrice: true, budgetHours: true, status: true, billable: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }),
  ]);

  const milestoneIds = projects.flatMap((p) => p.milestones.map((m) => m.id));
  const assignments = milestoneIds.length
    ? await prisma.assignment.findMany({
        where: { milestoneId: { in: milestoneIds } },
        select: { id: true, milestoneId: true, costRate: true, user: { select: { employment: { select: { costRate: true } } } } },
      })
    : [];
  const assignmentIds = assignments.map((a) => a.id);

  const [apprByMs, costEntries, planByAsg, planDetail, adjByMs] = await Promise.all([
    milestoneIds.length
      ? prisma.timeEntry.groupBy({
          by: ["milestoneId"],
          where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
          _sum: { hours: true },
        })
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
    assignmentIds.length
      ? prisma.assignmentPlan.findMany({ where: { assignmentId: { in: assignmentIds } }, select: { assignmentId: true, weekStartDate: true, hours: true } })
      : Promise.resolve([]),
    milestoneIds.length
      ? prisma.milestoneAdjustment.groupBy({ by: ["milestoneId"], where: { milestoneId: { in: milestoneIds } }, _sum: { amount: true } })
      : Promise.resolve([]),
  ]);

  const companyCurrency = company?.currency ?? "USD";
  const apprMsMap = new Map(apprByMs.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
  const adjByMsMap = new Map(adjByMs.map((x) => [x.milestoneId, Number(x._sum.amount ?? 0)]));
  const costByMs = new Map<string, number>();
  for (const e of costEntries) {
    const rate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
    costByMs.set(e.milestoneId, (costByMs.get(e.milestoneId) ?? 0) + Number(e.hours) * rate);
  }
  const planAsgMap = new Map(planByAsg.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
  const currentRateByAsg = new Map(assignments.map((a) => [a.id, Number(a.user.employment?.costRate ?? 0)]));
  const asgByMs = new Map<string, { id: string; costRate: number }[]>();
  for (const a of assignments) {
    const arr = asgByMs.get(a.milestoneId) ?? [];
    arr.push({ id: a.id, costRate: Number(a.costRate) });
    asgByMs.set(a.milestoneId, arr);
  }

  const recognizedInvoices = await prisma.invoice.findMany({
    where: { companyId: user.companyId, status: { in: ["ISSUED", "RECONCILED", "PAID"] } },
    select: { projectId: true, type: true, lines: { select: { amount: true } } },
  });
  const invoicedByProject = new Map<string, number>();
  for (const inv of recognizedInvoices) {
    if (!inv.projectId) continue;
    const net = inv.lines.reduce((s, l) => s + Number(l.amount), 0) * (inv.type === "CREDIT_NOTE" ? -1 : 1);
    invoicedByProject.set(inv.projectId, (invoicedByProject.get(inv.projectId) ?? 0) + net);
  }

  const overheadProjectIds = new Set(
    projects
      .filter((p) => p.isInternal || (!p.milestones.some((m) => m.billable) && Number(p.contractValue ?? p.budgetAmount ?? 0) <= 0))
      .map((p) => p.id),
  );

  const msMeta = new Map<string, { salesPrice: number; billable: boolean; projectId: string; billingType: ProjectBillingType }>();
  const projContract = new Map<string, number>();
  for (const p of projects) {
    projContract.set(p.id, Number(p.contractValue ?? p.budgetAmount ?? 0));
    for (const ms of p.milestones) msMeta.set(ms.id, { salesPrice: Number(ms.salesPrice), billable: ms.billable, projectId: p.id, billingType: p.billingType });
  }
  const asgMilestone = new Map(assignments.map((a) => [a.id, a.milestoneId]));

  const now = new Date();
  const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Forward periods for the time-phased forecast: 4 quarters and 12 months from the current period.
  const baseQ = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const quarters = Array.from({ length: 4 }, (_, i) => {
    const start = new Date(baseQ.getFullYear(), baseQ.getMonth() + i * 3, 1);
    const end = new Date(baseQ.getFullYear(), baseQ.getMonth() + i * 3 + 3, 1);
    return { start, end, label: `Q${Math.floor(start.getMonth() / 3) + 1} '${String(start.getFullYear()).slice(2)}` };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    return {
      start,
      end,
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTH_ABBR[start.getMonth()]} '${String(start.getFullYear()).slice(2)}`,
    };
  });

  // Total planned hours per fixed-price project (period-independent — used to spread contract value).
  const fpTotalPlannedByProj = new Map<string, number>();
  for (const a of assignments) {
    const msId = asgMilestone.get(a.id);
    const meta = msId ? msMeta.get(msId) : undefined;
    if (!meta || meta.billingType !== "FIXED_PRICE" || overheadProjectIds.has(meta.projectId)) continue;
    fpTotalPlannedByProj.set(meta.projectId, (fpTotalPlannedByProj.get(meta.projectId) ?? 0) + (planAsgMap.get(a.id) ?? 0));
  }

  // Time-phase the forecast across an arbitrary set of periods. T&M/Retainer: Σ planned hours in the
  // period × rate. Fixed price: contract value spread across periods in proportion to each period's
  // planned-hours share of the project's total planned hours.
  function phase(periods: { start: Date; end: Date }[]): Map<string, number[]> {
    const n = periods.length;
    const idx = (d: Date) => periods.findIndex((q) => d >= q.start && d < q.end);
    const byProj = new Map<string, number[]>();
    const fpPlanned = new Map<string, number[]>();
    for (const pr of planDetail) {
      const msId = asgMilestone.get(pr.assignmentId);
      const meta = msId ? msMeta.get(msId) : undefined;
      if (!meta || overheadProjectIds.has(meta.projectId)) continue;
      const qi = idx(pr.weekStartDate);
      if (qi < 0) continue;
      const hours = Number(pr.hours);
      if (meta.billingType === "FIXED_PRICE") {
        const arr = fpPlanned.get(meta.projectId) ?? new Array(n).fill(0);
        arr[qi] += hours;
        fpPlanned.set(meta.projectId, arr);
      } else if (meta.billable) {
        const arr = byProj.get(meta.projectId) ?? new Array(n).fill(0);
        arr[qi] += hours * meta.salesPrice;
        byProj.set(meta.projectId, arr);
      }
    }
    for (const [projId, arr] of fpPlanned) {
      const total = fpTotalPlannedByProj.get(projId) ?? 0;
      if (total <= 0) continue;
      const cv = projContract.get(projId) ?? 0;
      const out = byProj.get(projId) ?? new Array(n).fill(0);
      for (let i = 0; i < n; i++) out[i] += (cv * arr[i]) / total;
      byProj.set(projId, out);
    }
    return byProj;
  }

  const quarterlyByProj = phase(quarters);
  const monthlyByProj = phase(months);

  const rows: RevenueRow[] = [];
  const overhead: OverheadRow[] = [];
  for (const p of projects) {
    const milestoneInputs = p.milestones.map((m) => {
      const asgs = asgByMs.get(m.id) ?? [];
      const plannedHours = asgs.reduce((s, a) => s + (planAsgMap.get(a.id) ?? 0), 0);
      return {
        salesPrice: Number(m.salesPrice),
        budgetHours: m.budgetHours ? Number(m.budgetHours) : 0,
        status: m.status,
        adjustment: adjByMsMap.get(m.id) ?? 0,
        approvedHours: apprMsMap.get(m.id) ?? 0,
        plannedHours,
        billable: m.billable,
      };
    });

    let cost = 0;
    let forecastCost = 0;
    for (const m of p.milestones) {
      cost += costByMs.get(m.id) ?? 0;
      for (const a of asgByMs.get(m.id) ?? []) forecastCost += (planAsgMap.get(a.id) ?? 0) * (currentRateByAsg.get(a.id) ?? 0);
    }

    const budgetHours =
      p.budgetHours != null ? Number(p.budgetHours) : milestoneInputs.reduce((s, m) => s + m.budgetHours, 0);
    const contractValue = Number(p.contractValue ?? p.budgetAmount ?? 0);
    const plannedHours = Math.round(milestoneInputs.reduce((s, m) => s + m.plannedHours, 0) * 100) / 100;
    const approvedHours = Math.round(milestoneInputs.reduce((s, m) => s + m.approvedHours, 0) * 100) / 100;

    if (overheadProjectIds.has(p.id)) {
      overhead.push({
        projectId: p.id,
        projectName: p.name,
        clientName: p.client.name,
        billingType: p.billingType,
        currency: companyCurrency,
        isInternal: p.isInternal,
        plannedHours,
        approvedHours,
        cost: Math.round(cost * 100) / 100,
      });
      continue;
    }

    const rev = computeProjectRevenue({
      billingType: p.billingType,
      contractValue,
      budgetHours,
      cost,
      forecastCost,
      milestones: milestoneInputs,
    });

    rows.push({
      projectId: p.id,
      projectName: p.name,
      clientName: p.client.name,
      billingType: p.billingType,
      currency: companyCurrency,
      contractValue,
      budgetHours,
      ...rev,
      recognizedRevenue: Math.round((invoicedByProject.get(p.id) ?? 0) * 100) / 100,
      quarterly: (quarterlyByProj.get(p.id) ?? [0, 0, 0, 0]).map((v) => Math.round(v * 100) / 100),
      monthly: (monthlyByProj.get(p.id) ?? new Array(12).fill(0)).map((v) => Math.round(v * 100) / 100),
    });
  }

  return {
    rows,
    overhead,
    quarterLabels: quarters.map((q) => q.label),
    monthKeys: months.map((mo) => mo.key),
    monthLabels: months.map((mo) => mo.label),
    companyCurrency,
  };
}
