import "server-only";
import type { RagStatus, ProjectBillingType, MilestoneStatus, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleProjectIds, type SessionUser } from "@/lib/permissions";
import { computeCompanyRevenue } from "@/lib/revenue-data";
import { invoiceTotals, outstanding } from "@/lib/invoice";
import { computeQuoteTotals, TERMINAL_STAGES, STAGE_LABELS } from "@/lib/opportunity";

export type CmdRag = RagStatus | "NONE";

export type CmdProject = {
  projectId: string;
  name: string;
  clientName: string;
  billingType: ProjectBillingType;
  earned: number;
  forecast: number;
  recognized: number;
  cost: number;
  margin: number;
  marginPct: number | null;
  outstanding: number;
  /** Delivered work not yet invoiced (still to bill). */
  unbilled: number;
  approvedHours: number;
  budgetHours: number;
  rag: CmdRag;
  /** Delivery signals for the delivery lens. */
  nextMilestone: string | null;
  lastStatusDays: number | null;
  openIssues: number;
};

export type CmdClient = {
  clientName: string;
  earned: number;
  margin: number;
  marginPct: number | null;
  outstanding: number;
  unbilled: number;
  openIssues: number;
  rag: CmdRag;
  projects: CmdProject[];
};

// Drill-down for an "unbilled work" item: the delivered milestones (what was earned) and the invoices
// already raised (what was billed) — so the owner can see exactly what makes up the gap.
export type TimeCardRef = {
  cardId: string;
  user: string;
  week: string;
  hours: number;
  /** Value = hours × rate for T&M; null for fixed price (value is completion-based, not per-card). */
  value: number | null;
};
export type UnbilledMilestone = {
  milestoneId: string;
  name: string;
  status: MilestoneStatus;
  /** Still-to-bill value for this milestone (the headline). */
  unbilled: number;
  /** Total earned value (context). */
  earned: number;
  /** Approved hours not yet linked to any invoice (0 for a fixed-price milestone billed on completion). */
  unbilledHours: number;
  budgetHours: number;
  /** Some of this milestone's work has already been invoiced (T&M: some hours are linked). */
  billed: boolean;
  /** How the unbilled value arises: "complete" = fixed-price milestone marked done, full value due for
   *  invoicing; "hours" = approved time not yet invoiced (T&M, or fixed-price percentage-of-completion). */
  basis: "hours" | "complete";
  /** The approved time cards with hours NOT yet on an invoice (person · week · unbilled hours · value). */
  cards: TimeCardRef[];
};
export type UnbilledInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  status: InvoiceStatus;
  work: number;
};
export type UnbilledBreakdown = {
  projectId: string;
  projectName: string;
  clientName: string;
  billingType: ProjectBillingType;
  earned: number;
  billed: number;
  unbilled: number;
  milestones: UnbilledMilestone[];
  invoices: UnbilledInvoice[];
};

export type CmdAttention = {
  id: string;
  severity: "high" | "med";
  kind: string;
  title: string;
  detail: string;
  amount: number | null;
  href: string;
  /** Present on "unbilled" items: the delivered-vs-billed breakdown for the drill-down dialog. */
  breakdown?: UnbilledBreakdown;
};

export type CommandCenter = {
  currency: string;
  kpis: {
    earned: number;
    forecast: number;
    recognized: number;
    cost: number;
    margin: number;
    marginPct: number | null;
    operatingMargin: number;
    overheadCost: number;
    outstanding: number;
    overdueAmount: number;
    collected: number;
    pipeline: number;
    activeProjects: number;
    clientsCount: number;
  };
  clients: CmdClient[];
  ragCounts: { GREEN: number; AMBER: number; RED: number; NONE: number };
  attention: CmdAttention[];
  quarterLabels: string[];
  quarterly: number[];
  /** Open opportunities behind the pipeline KPI. */
  pipelineDeals: { id: string; name: string; clientName: string; stage: string; value: number }[];
  /** Internal/overhead projects behind the overhead KPI. */
  overheadProjects: { projectId: string; name: string; clientName: string; cost: number }[];
};

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RAG_RANK: Record<CmdRag, number> = { RED: 3, AMBER: 2, GREEN: 1, NONE: 0 };
const worse = (a: CmdRag, b: CmdRag): CmdRag => (RAG_RANK[a] >= RAG_RANK[b] ? a : b);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

/** Assemble the owner Command Center: company financials, per-client/project drill-down with delivery
 *  RAG and cash, the pipeline, and a money-and-risk attention feed. Reuses the Revenue single source
 *  of truth so figures reconcile with the Revenue report. */
export async function assembleCommandCenter(user: SessionUser): Promise<CommandCenter> {
  const projectIds = await visibleProjectIds(user);
  const scopeAll = projectIds === "ALL";
  const projFilter = scopeAll ? {} : { id: { in: projectIds as string[] } };

  const [{ rows, overhead, quarterLabels, companyCurrency }, invoices, opportunities, deliv, allMs, unlinkedByMs] =
    await Promise.all([
      computeCompanyRevenue(user),
      prisma.invoice.findMany({
        where: { companyId: user.companyId, status: { not: "VOID" }, ...(scopeAll ? {} : { OR: [{ projectId: { in: projectIds as string[] } }, { projectId: null }] }) },
        select: {
          id: true, invoiceNumber: true, issueDate: true, status: true, type: true, dueDate: true, vatRate: true, fiscalNumber: true,
          projectId: true, lines: { select: { amount: true, description: true } }, payments: { select: { amount: true, bankFee: true } },
        },
      }),
      prisma.opportunity.findMany({
        where: { companyId: user.companyId, stage: { notIn: TERMINAL_STAGES } },
        select: { id: true, name: true, stage: true, client: { select: { name: true } }, discountType: true, discountValue: true, lines: { select: { quantityHours: true, unitPrice: true } } },
      }),
      prisma.project.findMany({
        where: { companyId: user.companyId, isInternal: false, ...projFilter },
        select: {
          id: true,
          statusReports: { orderBy: { reportDate: "desc" }, select: { engagementId: true, overallRag: true, reportDate: true } },
          raidItems: { where: { status: { not: "CLOSED" }, type: { in: ["RISK", "ISSUE"] } }, select: { severity: true, dueDate: true } },
          planTasks: { where: { isMilestone: true }, select: { name: true, dueDate: true, status: true, progress: true } },
        },
      }),
      // Every non-internal milestone's rate + billing type, and approved hours NOT yet linked to any
      // invoice line — the precise basis for "delivered but not invoiced" on T&M work.
      prisma.milestone.findMany({
        where: { project: { companyId: user.companyId, isInternal: false, ...projFilter } },
        select: { id: true, salesPrice: true, billable: true, projectId: true, project: { select: { billingType: true } } },
      }),
      prisma.timeEntry.groupBy({
        by: ["milestoneId"],
        where: { milestone: { project: { companyId: user.companyId, isInternal: false, ...projFilter } }, timeCard: { status: "APPROVED" }, invoiceLineId: null },
        _sum: { hours: true },
      }),
    ]);

  // ---- Cash from the invoice register ----
  const COMMISSION_DESC = "Sales comision"; // exact wording of the deal-level commission discount line
  const today = new Date(new Date().toISOString().slice(0, 10));
  const outstandingByProject = new Map<string, number>();
  // Value of actual WORK billed per project = Σ invoice line amounts excluding the commission-discount
  // line (that's a discount we chose to give, not unbilled work). Compared against earned to find
  // delivered-but-unbilled work. Any non-void invoice counts (a draft means billing is already under
  // way), so we don't nag about work that already has an invoice started.
  const billedWorkByProject = new Map<string, number>();
  let outstandingTotal = 0;
  let overdueAmount = 0;
  let collected = 0;
  for (const inv of invoices) {
    const sign = inv.type === "CREDIT_NOTE" ? -1 : 1;
    const { gross } = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) * sign })), inv.vatRate ? Number(inv.vatRate) : null);
    const owed = inv.status === "PAID" ? 0 : outstanding(gross, inv.payments.map((p) => ({ amount: Number(p.amount), bankFee: Number(p.bankFee) })));
    collected += inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    if (inv.projectId) {
      const work = inv.lines.filter((l) => l.description !== COMMISSION_DESC).reduce((s, l) => s + Number(l.amount) * sign, 0);
      billedWorkByProject.set(inv.projectId, (billedWorkByProject.get(inv.projectId) ?? 0) + work);
    }
    if ((inv.status === "ISSUED" || inv.status === "RECONCILED") && owed > 0) {
      outstandingTotal += owed;
      if (inv.projectId) outstandingByProject.set(inv.projectId, (outstandingByProject.get(inv.projectId) ?? 0) + owed);
      if (inv.dueDate && new Date(inv.dueDate) < today) overdueAmount += owed;
    }
  }

  // ---- Still-to-bill per project ----
  // T&M / Retainer: exact — Σ (approved hours NOT linked to any invoice × milestone rate). Fixed price
  // (manual, lump invoices): earned minus work already billed on the register (never below 0).
  const unlinkedM = new Map(unlinkedByMs.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
  const tmUnbilledByProject = new Map<string, number>();
  for (const m of allMs) {
    if (m.project.billingType === "FIXED_PRICE" || !m.billable) continue;
    const v = (unlinkedM.get(m.id) ?? 0) * Number(m.salesPrice);
    if (v > 0) tmUnbilledByProject.set(m.projectId, (tmUnbilledByProject.get(m.projectId) ?? 0) + v);
  }
  const stillToBill = (r: (typeof rows)[number]): number =>
    r.billingType === "FIXED_PRICE"
      ? round2(Math.max(0, r.earnedRevenue - (billedWorkByProject.get(r.projectId) ?? 0)))
      : round2(tmUnbilledByProject.get(r.projectId) ?? 0);

  // ---- Pipeline (open opportunities, net of discount) ----
  let pipeline = 0;
  const pipelineDeals: CommandCenter["pipelineDeals"] = [];
  for (const o of opportunities) {
    const { net } = computeQuoteTotals(
      o.lines.map((l) => ({ quantityHours: Number(l.quantityHours), unitPrice: Number(l.unitPrice) })),
      o.discountType ?? undefined,
      o.discountValue != null ? Number(o.discountValue) : undefined,
    );
    pipeline += net;
    pipelineDeals.push({ id: o.id, name: o.name, clientName: o.client.name, stage: STAGE_LABELS[o.stage] ?? o.stage, value: round2(net) });
  }
  pipelineDeals.sort((a, b) => b.value - a.value);
  const overheadProjects: CommandCenter["overheadProjects"] = overhead
    .filter((o) => o.cost > 0)
    .map((o) => ({ projectId: o.projectId, name: o.projectName, clientName: o.clientName, cost: round2(o.cost) }))
    .sort((a, b) => b.cost - a.cost);

  // ---- Delivery signals per project (RAG, status age, open issues, next milestone) ----
  const MS_DAY = 86400000;
  const ragByProject = new Map<string, CmdRag>();
  const statusDaysByProject = new Map<string, number | null>();
  const openIssuesByProject = new Map<string, number>();
  const nextMsByProject = new Map<string, string | null>();
  for (const p of deliv) {
    const latestByScope = new Map<string | null, RagStatus>();
    for (const r of p.statusReports) if (!latestByScope.has(r.engagementId)) latestByScope.set(r.engagementId, r.overallRag);
    let rag: CmdRag = "NONE";
    for (const rr of latestByScope.values()) rag = worse(rag, rr);
    const hasCriticalOverdue = p.raidItems.some(
      (i) => (i.severity === "HIGH" || i.severity === "CRITICAL") && i.dueDate != null && new Date(i.dueDate) < today,
    );
    if (hasCriticalOverdue) rag = "RED";
    ragByProject.set(p.id, rag);

    const latestReport = p.statusReports[0]?.reportDate ?? null;
    statusDaysByProject.set(p.id, latestReport ? Math.round((today.getTime() - new Date(latestReport).getTime()) / MS_DAY) : null);
    openIssuesByProject.set(p.id, p.raidItems.length);

    // Next milestone: earliest incomplete plan milestone due today or later.
    const upcoming = p.planTasks
      .filter((t) => t.status !== "COMPLETED" && t.progress < 100 && t.dueDate != null && new Date(t.dueDate) >= today)
      .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0];
    nextMsByProject.set(
      p.id,
      upcoming ? `${upcoming.name} · ${MONTH_ABBR[new Date(upcoming.dueDate!).getUTCMonth()]} ${new Date(upcoming.dueDate!).getUTCDate()}` : null,
    );
  }

  // ---- Per-project rows for the drill-down ----
  const projects: CmdProject[] = rows.map((r) => {
    const marginPct = pct(r.margin, r.earnedRevenue);
    return {
      projectId: r.projectId,
      name: r.projectName,
      clientName: r.clientName,
      billingType: r.billingType,
      earned: r.earnedRevenue,
      forecast: r.forecastRevenue,
      recognized: r.recognizedRevenue,
      cost: r.totalCost, // internal time + partner bills
      margin: r.margin,
      marginPct,
      outstanding: round2(outstandingByProject.get(r.projectId) ?? 0),
      unbilled: stillToBill(r),
      approvedHours: r.approvedHours,
      budgetHours: r.budgetHours,
      rag: ragByProject.get(r.projectId) ?? "NONE",
      nextMilestone: nextMsByProject.get(r.projectId) ?? null,
      lastStatusDays: statusDaysByProject.get(r.projectId) ?? null,
      openIssues: openIssuesByProject.get(r.projectId) ?? 0,
    };
  });

  // ---- Group by client ----
  const byClient = new Map<string, CmdProject[]>();
  for (const p of projects) (byClient.get(p.clientName) ?? byClient.set(p.clientName, []).get(p.clientName)!).push(p);
  const clients: CmdClient[] = [...byClient.entries()]
    .map(([clientName, ps]) => {
      const earned = round2(ps.reduce((s, p) => s + p.earned, 0));
      const margin = round2(ps.reduce((s, p) => s + p.margin, 0));
      const outstandingC = round2(ps.reduce((s, p) => s + p.outstanding, 0));
      const unbilledC = round2(ps.reduce((s, p) => s + p.unbilled, 0));
      const openIssuesC = ps.reduce((s, p) => s + p.openIssues, 0);
      const rag = ps.reduce<CmdRag>((acc, p) => worse(acc, p.rag), "NONE");
      return { clientName, earned, margin, marginPct: pct(margin, earned), outstanding: outstandingC, unbilled: unbilledC, openIssues: openIssuesC, rag, projects: ps.sort((a, b) => b.earned - a.earned) };
    })
    .sort((a, b) => b.earned - a.earned);

  // ---- Company KPIs ----
  const earned = round2(rows.reduce((s, r) => s + r.earnedRevenue, 0));
  const forecast = round2(rows.reduce((s, r) => s + r.forecastRevenue, 0));
  const recognized = round2(rows.reduce((s, r) => s + r.recognizedRevenue, 0));
  const cost = round2(rows.reduce((s, r) => s + r.totalCost, 0));
  const overheadCost = round2(overhead.reduce((s, o) => s + o.cost, 0));
  const margin = round2(earned - cost);
  const operatingMargin = round2(margin - overheadCost);
  const quarterly = quarterLabels.map((_, i) => round2(rows.reduce((s, r) => s + (r.quarterly[i] ?? 0), 0)));

  const ragCounts = { GREEN: 0, AMBER: 0, RED: 0, NONE: 0 };
  for (const p of projects) ragCounts[p.rag]++;

  // ---- Unbilled drill-down breakdowns (only for flagged projects) ----
  const flagged = rows.filter((r) => stillToBill(r) >= 1000);
  const flaggedIds = flagged.map((r) => r.projectId);
  const breakdowns = new Map<string, UnbilledBreakdown>();
  if (flaggedIds.length) {
    const [ms, apprRows, adjRows, cardRows] = await Promise.all([
      prisma.milestone.findMany({ where: { projectId: { in: flaggedIds } }, select: { id: true, name: true, salesPrice: true, budgetHours: true, status: true, billable: true, projectId: true } }),
      prisma.timeEntry.groupBy({ by: ["milestoneId"], where: { milestone: { projectId: { in: flaggedIds } }, timeCard: { status: "APPROVED" } }, _sum: { hours: true } }),
      prisma.milestoneAdjustment.groupBy({ by: ["milestoneId"], where: { milestone: { projectId: { in: flaggedIds } } }, _sum: { amount: true } }),
      // Approved time cards with their entries' invoice linkage, so we can show the UNBILLED hours per card.
      prisma.timeCard.findMany({
        where: { milestone: { projectId: { in: flaggedIds } }, status: "APPROVED" },
        select: { id: true, milestoneId: true, weekStartDate: true, user: { select: { name: true } }, entries: { select: { hours: true, invoiceLineId: true } } },
      }),
    ]);
    const apprM = new Map(apprRows.map((x) => [x.milestoneId, Number(x._sum.hours ?? 0)]));
    const adjM = new Map(adjRows.map((x) => [x.milestoneId, Number(x._sum.amount ?? 0)]));
    const msByProj = new Map<string, typeof ms>();
    for (const m of ms) (msByProj.get(m.projectId) ?? msByProj.set(m.projectId, []).get(m.projectId)!).push(m);
    // Per-milestone unbilled time cards (person · week · hours NOT yet on an invoice).
    const cardsByMs = new Map<string, { cardId: string; user: string; week: string; unbilledHours: number }[]>();
    for (const cd of cardRows) {
      const unbilledHours = cd.entries.filter((e) => !e.invoiceLineId).reduce((s, e) => s + Number(e.hours), 0);
      if (unbilledHours <= 0.005) continue;
      const arr = cardsByMs.get(cd.milestoneId) ?? cardsByMs.set(cd.milestoneId, []).get(cd.milestoneId)!;
      arr.push({ cardId: cd.id, user: cd.user.name ?? "—", week: new Date(cd.weekStartDate).toISOString().slice(0, 10), unbilledHours: round2(unbilledHours) });
    }

    for (const r of flagged) {
      const isFP = r.billingType === "FIXED_PRICE";
      const projMs = msByProj.get(r.projectId) ?? [];
      // Same discount-aware scaling as revenue.ts: distribute the contract value across milestones by
      // their list-value share, so a project-level discount is reflected here too.
      const totalList = projMs.reduce((s, m) => s + Number(m.salesPrice) + (adjM.get(m.id) ?? 0), 0);
      const scale = isFP && totalList > 0 && r.contractValue > 0 ? r.contractValue / totalList : 1;
      const milestones: UnbilledMilestone[] = [];
      for (const m of projMs) {
        const rate = Number(m.salesPrice);
        const appr = apprM.get(m.id) ?? 0;
        const budget = m.budgetHours ? Number(m.budgetHours) : 0;
        const effective = (rate + (adjM.get(m.id) ?? 0)) * scale;

        if (isFP) {
          // Fixed price is billed on completion (manual, lump invoices — not attributable per milestone).
          // A flagged FP project has value still to bill; show the delivered milestones: a completed one's
          // full value, an in-progress one's percentage-of-completion value.
          const done = m.status === "COMPLETE" || m.status === "INVOICED";
          const earnedM = done ? effective : budget > 0 ? Math.min(1, appr / budget) * effective : 0;
          if (earnedM > 0.005 || done) {
            milestones.push({
              milestoneId: m.id, name: m.name, status: m.status, unbilled: round2(earnedM),
              earned: round2(earnedM), unbilledHours: 0, budgetHours: budget,
              billed: false, basis: done ? "complete" : "hours", cards: [],
            });
          }
        } else {
          // T&M / Retainer: unbilled = approved hours not yet linked to an invoice × rate.
          if (!m.billable) continue;
          const unbilledH = unlinkedM.get(m.id) ?? 0;
          if (unbilledH <= 0.005) continue;
          const cards: TimeCardRef[] = (cardsByMs.get(m.id) ?? [])
            .sort((a, b) => (a.week < b.week ? 1 : -1))
            .map((c) => ({ cardId: c.cardId, user: c.user, week: c.week, hours: c.unbilledHours, value: round2(c.unbilledHours * rate) }));
          milestones.push({
            milestoneId: m.id, name: m.name, status: m.status, unbilled: round2(unbilledH * rate),
            earned: round2(appr * rate), unbilledHours: round2(unbilledH), budgetHours: budget,
            billed: appr > unbilledH + 0.005, basis: "hours", cards,
          });
        }
      }
      milestones.sort((a, b) => b.unbilled - a.unbilled);
      const invs: UnbilledInvoice[] = invoices
        .filter((i) => i.projectId === r.projectId)
        .map((i) => {
          const sign = i.type === "CREDIT_NOTE" ? -1 : 1;
          const work = round2(i.lines.filter((l) => l.description !== COMMISSION_DESC).reduce((s, l) => s + Number(l.amount) * sign, 0));
          return { invoiceId: i.id, invoiceNumber: i.invoiceNumber, date: new Date(i.issueDate).toISOString().slice(0, 10), status: i.status, work };
        })
        .filter((i) => i.work !== 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      const unbilled = stillToBill(r);
      breakdowns.set(r.projectId, {
        projectId: r.projectId, projectName: r.projectName, clientName: r.clientName, billingType: r.billingType,
        earned: round2(r.earnedRevenue), billed: round2(r.earnedRevenue - unbilled), unbilled, milestones, invoices: invs,
      });
    }
  }

  // ---- Attention feed (money & risk) ----
  const attention: CmdAttention[] = [];
  const money = (n: number) => Math.round(n);
  for (const r of rows) {
    // Delivered-but-unbilled: for T&M/Retainer, approved hours not yet linked to an invoice × rate;
    // for fixed price, earned minus work already billed on the register. Billing ahead → 0 (no flag).
    const unbilled = stillToBill(r);
    if (unbilled >= 1000) {
      attention.push({
        id: `unbilled:${r.projectId}`, severity: unbilled >= 10000 ? "high" : "med", kind: "unbilled",
        title: "Work delivered but not invoiced", detail: `${r.projectName} · ${r.clientName}`,
        amount: money(unbilled), href: `/projects/${r.projectId}?tab=invoices`,
        breakdown: breakdowns.get(r.projectId),
      });
    }
    if (r.budgetHours > 0 && r.approvedHours > r.budgetHours) {
      attention.push({
        id: `overbudget:${r.projectId}`, severity: "med", kind: "overbudget",
        title: "Over budgeted hours", detail: `${r.projectName} · ${Math.round(r.approvedHours)}/${Math.round(r.budgetHours)}h`,
        amount: null, href: `/projects/${r.projectId}`,
      });
    }
    const mp = pct(r.margin, r.earnedRevenue);
    if (mp != null && r.earnedRevenue >= 5000 && mp < 15) {
      attention.push({
        id: `lowmargin:${r.projectId}`, severity: mp < 0 ? "high" : "med", kind: "lowmargin",
        title: "Low margin", detail: `${r.projectName} · ${mp}% margin`,
        amount: null, href: `/projects/${r.projectId}`,
      });
    }
  }
  if (overdueAmount > 0) {
    attention.push({
      id: "overdue-invoices", severity: "high", kind: "overdue",
      title: "Invoices overdue for payment", detail: "Past their due date, still unpaid",
      amount: money(overdueAmount), href: "/invoices",
    });
  }
  const toReconcile = invoices.filter((i) => i.status === "ISSUED" && !i.fiscalNumber).length;
  if (toReconcile > 0) {
    attention.push({
      id: "to-reconcile", severity: "med", kind: "reconcile",
      title: "Invoices to reconcile", detail: `${toReconcile} issued without a fiscal number`,
      amount: null, href: "/invoices",
    });
  }
  const sevRank = { high: 0, med: 1 };
  attention.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || (b.amount ?? 0) - (a.amount ?? 0));

  return {
    currency: companyCurrency,
    kpis: {
      earned, forecast, recognized, cost, margin, marginPct: pct(margin, earned),
      operatingMargin, overheadCost, outstanding: round2(outstandingTotal), overdueAmount: round2(overdueAmount),
      collected: round2(collected), pipeline: round2(pipeline),
      activeProjects: projects.length, clientsCount: clients.length,
    },
    clients,
    ragCounts,
    attention,
    quarterLabels,
    quarterly,
    pipelineDeals,
    overheadProjects,
  };
}
