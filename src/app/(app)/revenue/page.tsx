import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds } from "@/lib/permissions";
import { computeProjectRevenue } from "@/lib/revenue";
import { RevenueClient, type RevenueRow } from "./revenue-client";

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
        select: { id: true, milestoneId: true, costRate: true },
      })
    : [];
  const assignmentIds = assignments.map((a) => a.id);

  const [apprByMs, apprByAsg, planByAsg] = await Promise.all([
    milestoneIds.length
      ? prisma.timeEntry.groupBy({
          by: ["milestoneId"],
          where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
          _sum: { hours: true },
        })
      : Promise.resolve([]),
    assignmentIds.length
      ? prisma.timeEntry.groupBy({
          by: ["assignmentId"],
          where: { assignmentId: { in: assignmentIds }, timeCard: { status: "APPROVED" } },
          _sum: { hours: true },
        })
      : Promise.resolve([]),
    assignmentIds.length
      ? prisma.assignmentPlan.groupBy({ by: ["assignmentId"], where: { assignmentId: { in: assignmentIds } }, _sum: { hours: true } })
      : Promise.resolve([]),
  ]);

  const companyCurrency = company?.currency ?? "USD";
  const apprMsMap = new Map(apprByMs.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
  const apprAsgMap = new Map(apprByAsg.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
  const planAsgMap = new Map(planByAsg.map((x) => [x.assignmentId, Number(x._sum.hours ?? 0)]));
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

  const rows: RevenueRow[] = projects.map((p) => {
    const milestoneInputs = p.milestones.map((m) => {
      const asgs = asgByMs.get(m.id) ?? [];
      const plannedHours = asgs.reduce((s, a) => s + (planAsgMap.get(a.id) ?? 0), 0);
      return {
        salesPrice: Number(m.salesPrice),
        budgetHours: m.budgetHours ? Number(m.budgetHours) : 0,
        status: m.status,
        approvedHours: apprMsMap.get(m.id) ?? 0,
        plannedHours,
        billable: m.billable,
      };
    });

    let cost = 0;
    for (const m of p.milestones) {
      for (const a of asgByMs.get(m.id) ?? []) cost += (apprAsgMap.get(a.id) ?? 0) * a.costRate;
    }

    const budgetHours =
      p.budgetHours != null ? Number(p.budgetHours) : milestoneInputs.reduce((s, m) => s + m.budgetHours, 0);
    const contractValue = Number(p.contractValue ?? p.budgetAmount ?? 0);

    const rev = computeProjectRevenue({
      billingType: p.billingType,
      contractValue,
      budgetHours,
      cost,
      milestones: milestoneInputs,
    });

    return {
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
    };
  });

  return <RevenueClient rows={rows} defaultCurrency={companyCurrency} />;
}
