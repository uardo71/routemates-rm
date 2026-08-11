import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { BudgetsClient, type ClientNode } from "./budgets-client";

// Company-wide budget rollup: budgeted hours + cost vs actual (approved time) hours + cost, rolled
// up client -> project -> milestone. Parent totals are always the sum of their children, so the
// tree adds up when expanded. Actual cost = Σ approved hours × the historical cost rate frozen on
// each entry at approval (EUR, effective on the worked date) — same basis as the Revenue report.
export default async function BudgetsPage() {
  const user = await requirePermission("reports:view");

  const [projects, company] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: user.companyId },
      include: {
        client: { select: { id: true, name: true } },
        milestones: {
          select: {
            id: true,
            name: true,
            budgetHours: true,
            cost: true,
            status: true,
            // For the implied budget cost: each assignment's allocated hours × that person's current
            // cost rate, summed. Only used when the milestone has no manually-entered budgeted cost.
            assignments: { select: { allocatedHours: true, user: { select: { employment: { select: { costRate: true } } } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUnique({ where: { id: user.companyId }, select: { currency: true } }),
  ]);
  const currency = company?.currency ?? "USD";

  const milestoneIds = projects.flatMap((p) => p.milestones.map((m) => m.id));
  const [apprByMs, costEntries] = await Promise.all([
    milestoneIds.length
      ? prisma.timeEntry.groupBy({ by: ["milestoneId"], where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } }, _sum: { hours: true } })
      : Promise.resolve([]),
    // Approved entries carry the historical cost rate frozen at approval (rate effective on the
    // worked date); fall back to the assignment snapshot for any entry that predates the backfill.
    milestoneIds.length
      ? prisma.timeEntry.findMany({
          where: { milestoneId: { in: milestoneIds }, timeCard: { status: "APPROVED" } },
          select: { milestoneId: true, hours: true, costRate: true, assignment: { select: { costRate: true } } },
        })
      : Promise.resolve([]),
  ]);

  const apprMsMap = new Map(apprByMs.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
  // Actual cost per milestone = Σ approved hours × the entry's historical rate (snapshot fallback).
  const costByMs = new Map<string, number>();
  for (const e of costEntries) {
    const rate = e.costRate != null ? Number(e.costRate) : Number(e.assignment.costRate);
    costByMs.set(e.milestoneId, (costByMs.get(e.milestoneId) ?? 0) + Number(e.hours) * rate);
  }
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const clientsMap = new Map<string, ClientNode>();
  for (const p of projects) {
    const milestones = p.milestones.map((m) => {
      const actualCost = costByMs.get(m.id) ?? 0;
      // Budget cost: the milestone's manually-entered budgeted cost when set (>0); otherwise an
      // implied projection = Σ each assignment's allocated hours × that person's current cost rate.
      const manualCost = Number(m.cost);
      const impliedCost = m.assignments.reduce(
        (s, a) => s + Number(a.allocatedHours ?? 0) * Number(a.user.employment?.costRate ?? 0),
        0,
      );
      return {
        id: m.id,
        name: m.name,
        budgetHours: m.budgetHours ? Number(m.budgetHours) : 0,
        actualHours: apprMsMap.get(m.id) ?? 0,
        budgetCost: round2(manualCost > 0 ? manualCost : impliedCost),
        actualCost: round2(actualCost),
      };
    });
    const project = {
      id: p.id,
      name: p.name,
      billingType: p.billingType,
      budgetHours: round2(milestones.reduce((s, m) => s + m.budgetHours, 0)),
      actualHours: round2(milestones.reduce((s, m) => s + m.actualHours, 0)),
      budgetCost: round2(milestones.reduce((s, m) => s + m.budgetCost, 0)),
      actualCost: round2(milestones.reduce((s, m) => s + m.actualCost, 0)),
      milestones,
    };
    let node = clientsMap.get(p.client.id);
    if (!node) {
      node = { id: p.client.id, name: p.client.name, projects: [] };
      clientsMap.set(p.client.id, node);
    }
    node.projects.push(project);
  }
  const clients = [...clientsMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Budgets</h1>
        <p className="text-sm text-muted-foreground">
          Budgeted hours and cost vs actual, rolled up client → project → milestone. Budgeted cost is a milestone&apos;s
          entered cost, or — when none is set — an implied projection of its allocated hours × each person&apos;s
          current cost rate. Actual cost uses approved time at the cost rate that was in effect when each entry was worked.
        </p>
      </div>
      <BudgetsClient clients={clients} currency={currency} />
    </div>
  );
}
