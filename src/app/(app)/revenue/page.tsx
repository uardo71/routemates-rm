import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds } from "@/lib/permissions";
import { computeProjectRevenue } from "@/lib/revenue";
import { RevenueClient, type RevenueRow, type OverheadRow } from "./revenue-client";

export default async function RevenuePage() {
  const user = await requirePermission("reports:view");

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
    // Approved entries carry the historical cost rate frozen at approval (rate effective on the
    // worked date); fall back to the assignment snapshot for any entry that predates the backfill.
    milestoneIds.length
      ? prisma.timeEntry.findMany({
          where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
          select: { milestoneId: true, hours: true, costRate: true, assignment: { select: { costRate: true } } },
        })
      : Promise.resolve([]),
    assignmentIds.length
      ? prisma.assignmentPlan.groupBy({ by: ["assignmentId"], where: { assignmentId: { in: assignmentIds } }, _sum: { hours: true } })
      : Promise.resolve([]),
    // Detailed weekly plan rows for the time-phased (quarterly) forecast.
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
  // Actual cost per milestone = Σ approved hours × the entry's historical rate (or snapshot fallback).
  const costByMs = new Map<string, number>();
  for (const e of costEntries) {
    const rate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
    costByMs.set(e.milestoneId, (costByMs.get(e.milestoneId) ?? 0) + Number(e.hours) * rate);
  }
  const planAsgMap = new Map(planByAsg.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
  // Current cost rate per assignment (the person's live employment rate) — used to project the cost
  // of the planned hours for the forecast margin, a forward-looking figure (vs. actual cost, which
  // uses each entry's historical rate).
  const currentRateByAsg = new Map(assignments.map((a) => [a.id, Number(a.user.employment?.costRate ?? 0)]));
  const asgByMs = new Map<string, { id: string; costRate: number }[]>();
  for (const a of assignments) {
    const arr = asgByMs.get(a.milestoneId) ?? [];
    arr.push({ id: a.id, costRate: Number(a.costRate) });
    asgByMs.set(a.milestoneId, arr);
  }

  // Recognized revenue is driven by the invoice register: net of recognized (issued/reconciled/paid)
  // invoices per project, with credit notes subtracting.
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

  // A project is treated as internal/overhead (pure cost, no revenue) when it's flagged internal,
  // or it has no billable milestones and no contract value. Those are segregated below and never
  // shown with a (meaningless) per-project margin — their cost rolls into company overhead instead.
  const overheadProjectIds = new Set(
    projects
      .filter((p) => p.isInternal || (!p.milestones.some((m) => m.billable) && Number(p.contractValue ?? p.budgetAmount ?? 0) <= 0))
      .map((p) => p.id),
  );

  // ---- Time-phased forecast (quarterly, next 4 quarters) from the delivery plan ----
  // T&M/Retainer: revenue in a quarter = Σ planned hours falling in that quarter × milestone rate
  // (billable milestones only). Fixed-price: contract value is spread across quarters in proportion
  // to each quarter's planned-hours share of the project's total planned hours. Overhead projects
  // are excluded (no revenue).
  const msMeta = new Map<string, { salesPrice: number; billable: boolean; projectId: string; billingType: (typeof projects)[number]["billingType"] }>();
  const projContract = new Map<string, number>();
  for (const p of projects) {
    projContract.set(p.id, Number(p.contractValue ?? p.budgetAmount ?? 0));
    for (const ms of p.milestones) msMeta.set(ms.id, { salesPrice: Number(ms.salesPrice), billable: ms.billable, projectId: p.id, billingType: p.billingType });
  }
  const asgMilestone = new Map(assignments.map((a) => [a.id, a.milestoneId]));

  const now = new Date();
  const baseQ = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const quarters = Array.from({ length: 4 }, (_, i) => {
    const start = new Date(baseQ.getFullYear(), baseQ.getMonth() + i * 3, 1);
    const end = new Date(baseQ.getFullYear(), baseQ.getMonth() + i * 3 + 3, 1);
    return { start, end, label: `Q${Math.floor(start.getMonth() / 3) + 1} '${String(start.getFullYear()).slice(2)}` };
  });
  const periodIndex = (d: Date) => quarters.findIndex((q) => d >= q.start && d < q.end);

  const quarterlyByProj = new Map<string, number[]>();
  const fpPlannedByProjQ = new Map<string, number[]>();
  for (const pr of planDetail) {
    const msId = asgMilestone.get(pr.assignmentId);
    const meta = msId ? msMeta.get(msId) : undefined;
    if (!meta || overheadProjectIds.has(meta.projectId)) continue;
    const qi = periodIndex(pr.weekStartDate);
    if (qi < 0) continue; // outside the forward 4-quarter window
    const hours = Number(pr.hours);
    if (meta.billingType === "FIXED_PRICE") {
      const arr = fpPlannedByProjQ.get(meta.projectId) ?? [0, 0, 0, 0];
      arr[qi] += hours;
      fpPlannedByProjQ.set(meta.projectId, arr);
    } else if (meta.billable) {
      const arr = quarterlyByProj.get(meta.projectId) ?? [0, 0, 0, 0];
      arr[qi] += hours * meta.salesPrice;
      quarterlyByProj.set(meta.projectId, arr);
    }
  }
  const fpTotalPlannedByProj = new Map<string, number>();
  for (const a of assignments) {
    const msId = asgMilestone.get(a.id);
    const meta = msId ? msMeta.get(msId) : undefined;
    if (!meta || meta.billingType !== "FIXED_PRICE" || overheadProjectIds.has(meta.projectId)) continue;
    fpTotalPlannedByProj.set(meta.projectId, (fpTotalPlannedByProj.get(meta.projectId) ?? 0) + (planAsgMap.get(a.id) ?? 0));
  }
  for (const [projId, arr] of fpPlannedByProjQ) {
    const total = fpTotalPlannedByProj.get(projId) ?? 0;
    if (total <= 0) continue;
    const cv = projContract.get(projId) ?? 0;
    const out = quarterlyByProj.get(projId) ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) out[i] += (cv * arr[i]) / total;
    quarterlyByProj.set(projId, out);
  }

  const revenueRows: RevenueRow[] = [];
  const overheadRows: OverheadRow[] = [];
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
      overheadRows.push({
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

    revenueRows.push({
      projectId: p.id,
      projectName: p.name,
      clientName: p.client.name,
      billingType: p.billingType,
      currency: companyCurrency,
      contractValue,
      budgetHours,
      ...rev,
      // Register-driven recognized revenue (overrides the helper's milestone/POC proxy).
      recognizedRevenue: Math.round((invoicedByProject.get(p.id) ?? 0) * 100) / 100,
      quarterly: (quarterlyByProj.get(p.id) ?? [0, 0, 0, 0]).map((v) => Math.round(v * 100) / 100),
    });
  }

  return (
    <RevenueClient
      rows={revenueRows}
      overhead={overheadRows}
      quarterLabels={quarters.map((q) => q.label)}
      defaultCurrency={companyCurrency}
    />
  );
}
