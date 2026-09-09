import type { ProjectBillingType, MilestoneStatus } from "@prisma/client";

// Pure revenue/forecast math for the Revenue report — no Prisma/runtime deps, so it can be unit
// tested and imported anywhere. The caller aggregates hours/cost from the DB and hands plain
// numbers in; this decides how those become revenue per billing type.
//
// Revenue recognition (per the user's "show both" choice for fixed-price):
//  • TIME_AND_MATERIALS / RETAINER — rate-driven. Milestone salesPrice is an hourly rate.
//      earned = Σ approvedHours × rate ; forecast = Σ plannedHours × rate ; recognized = earned.
//      (Rates are the milestone LIST rates; any project-level discount is tracked separately and
//       intentionally not re-applied here — same decision as the opportunity→project conversion.)
//  • FIXED_PRICE — value-driven. Milestone salesPrice is a lump sum.
//      forecast   = contractValue (the whole deal, net of discount).
//      earned     = percentage-of-completion = min(1, approvedHours / budgetHours) × contractValue.
//      recognized = Σ lump sum of milestones already COMPLETE or INVOICED (billing-complete work).

export type MilestoneRevenueInput = {
  salesPrice: number;
  budgetHours: number;
  status: MilestoneStatus;
  approvedHours: number;
  plannedHours: number;
  billable: boolean;
  /** Net value adjustments on the milestone (removed/absorbed money). Applied to the fixed-price
   *  value: effective = salesPrice + adjustment. Optional; defaults to 0. */
  adjustment?: number;
};

export type ProjectRevenueInput = {
  billingType: ProjectBillingType;
  /** Net contract value (from a won opportunity) or the project budget amount; used for FIXED_PRICE. */
  contractValue: number;
  /** Project budget hours, or Σ milestone budget hours when the project has none. */
  budgetHours: number;
  /** Internal delivery cost to date = Σ(approved hours × historical cost rate), computed by the
   *  caller. This is our own people's time only. */
  internalCost: number;
  /** Money paid (or committed) to partners for this project — vendor bills attributed to it, in
   *  the reporting currency. Both TO_PAY and PAID count: a committed bill is a real cost.
   *  Optional; defaults to 0 for projects delivered entirely in-house. */
  externalCost?: number;
  /** Projected internal cost of the whole plan = Σ(planned hours × current cost rate). */
  forecastCost: number;
  milestones: MilestoneRevenueInput[];
};

export type ProjectRevenueResult = {
  plannedHours: number;
  approvedHours: number;
  /** Budget hours not yet scheduled in the plan (headroom). Never negative. */
  unplannedHours: number;
  forecastRevenue: number;
  /** Earned to date: approved×rate (T&M) or percentage-of-completion (fixed price). */
  earnedRevenue: number;
  /** Recognized: same as earned for T&M; completed-milestone value for fixed price. */
  recognizedRevenue: number;
  /** Our own people's time: Σ(approved hours × historical cost rate). */
  internalCost: number;
  /** Subcontractor / partner bills attributed to the project (TO_PAY + PAID). */
  externalCost: number;
  /** internalCost + externalCost — what delivering this project actually costs. */
  totalCost: number;
  /** Gross margin against earned revenue (earned − TOTAL cost, internal and external). */
  margin: number;
  /** Projected internal cost of the whole plan = Σ(planned hours × current cost rate). */
  forecastCost: number;
  /** Projected total cost = forecast internal cost + external bills already committed. */
  forecastTotalCost: number;
  /** Projected margin if the whole plan is delivered = forecast revenue − forecast TOTAL cost. */
  forecastMargin: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- resolving an hour's bill rate ----------

export type BillRateSources = {
  /** Rate frozen onto the entry at approval — authoritative when present. */
  entryBillRate?: number | null;
  /** Rate snapshotted on the assignment when it was created. */
  assignmentBillRate?: number | null;
  /** For T&M/RETAINER this IS the hourly rate; for FIXED_PRICE it's the milestone's LUMP SUM. */
  milestoneSalesPrice: number;
  /** Only meaningful for FIXED_PRICE, where the per-hour value is lump sum / budget hours. */
  milestoneBudgetHours?: number | null;
  billingType: ProjectBillingType;
};

/** The hourly rate to value one worked hour at.
 *
 *  Entries approved before bill rates existed carry no frozen rate and their assignment carries no
 *  snapshot, so without a final fallback every such hour is worth 0 — which silently reported zero
 *  revenue and a margin equal to minus the cost. Falls back to the milestone, taking care that a
 *  FIXED_PRICE salesPrice is a lump sum: its per-hour value is the milestone value spread over its
 *  budget hours (the same "effective rate" the project page shows), never the lump sum itself. */
export function effectiveBillRate(s: BillRateSources): number {
  if (s.entryBillRate != null) return round2(s.entryBillRate);
  if (s.assignmentBillRate != null) return round2(s.assignmentBillRate);
  if (s.billingType === "FIXED_PRICE") {
    const hours = s.milestoneBudgetHours ?? 0;
    return hours > 0 ? round2(s.milestoneSalesPrice / hours) : 0;
  }
  return round2(s.milestoneSalesPrice);
}

// ---------- work in progress (earned vs invoiced) ----------

export type WipInput = {
  /** Earned revenue to date (approved hours × rate, or % completion for fixed price). */
  earned: number;
  /** Recognized/invoiced to date — net of issued invoices in the register (credit notes subtract). */
  invoiced: number;
  /** Approved hours not yet attached to an invoice line. */
  unbilledHours: number;
};

export type WipResult = {
  earned: number;
  invoiced: number;
  /** earned − invoiced. Positive = work delivered but not yet billed (the month-end accrual and
   *  the leakage signal). Negative = billed ahead of delivery (see `overBilled`). */
  unbilled: number;
  /** max(0, invoiced − earned) — deposits, prepaid retainers, and other billing ahead of work. */
  overBilled: number;
  unbilledHours: number;
};

/** Pure earned-vs-invoiced reconciliation (Prisma-free). Every euro of approved work sits in exactly
 *  one of three states: unbilled (here), invoiced (`invoiced`), or written off (billable hours that
 *  will never be billed — see {@link realizationMetrics}'s `writeOffHours`). */
export function wipMetrics(input: WipInput): WipResult {
  const earned = round2(input.earned);
  const invoiced = round2(input.invoiced);
  return {
    earned,
    invoiced,
    unbilled: round2(earned - invoiced),
    overBilled: round2(Math.max(0, invoiced - earned)),
    unbilledHours: round2(input.unbilledHours),
  };
}

// ---------- per-consultant realization ----------

export type RealizationInput = {
  /** Total approved hours the person worked in the period (across all milestones). */
  workedHours: number;
  /** Of those, hours logged on billable milestones. */
  billableHours: number;
  /** Of those, hours already attached to an invoice line (billed). */
  billedHours: number;
  /** Revenue attributed to the person for the period (Σ billed hours × frozen bill rate). */
  revenue: number;
};

export type RealizationResult = {
  workedHours: number;
  billableHours: number;
  billedHours: number;
  /** billed ÷ worked, as a percentage (0 when no hours worked — no division by zero). */
  realizationPct: number;
  /** revenue ÷ worked (0 when no hours worked). */
  effectiveHourlyRate: number;
  /** billable − billed: billable hours that haven't been invoiced (leakage). */
  writeOffHours: number;
};

/** Pure per-consultant realization math (Prisma-free). Realization is billed vs worked hours;
 *  the effective hourly rate is revenue spread over ALL worked hours (so non-billable and unbilled
 *  time drags it down), and write-off is billable hours not yet billed. */
export function realizationMetrics(input: RealizationInput): RealizationResult {
  const worked = input.workedHours;
  return {
    workedHours: round2(worked),
    billableHours: round2(input.billableHours),
    billedHours: round2(input.billedHours),
    realizationPct: worked > 0 ? round2((input.billedHours / worked) * 100) : 0,
    effectiveHourlyRate: worked > 0 ? round2(input.revenue / worked) : 0,
    writeOffHours: round2(input.billableHours - input.billedHours),
  };
}

/** How much each milestone's LIST value is scaled by to reach the negotiated contract value.
 *
 *  Milestones deliberately keep list prices; the deal-level discount lives on the project
 *  (`contractValue` = list − discount). Sharing this factor means the Revenue report and the
 *  project page can never disagree about what a milestone is actually worth. Returns 1 when there
 *  is no contract value or no list total to scale (i.e. nothing to discount). */
export function contractValueScale(contractValue: number, totalListValue: number): number {
  if (!(totalListValue > 0) || !(contractValue > 0)) return 1;
  return contractValue / totalListValue;
}

export function computeProjectRevenue(input: ProjectRevenueInput): ProjectRevenueResult {
  const plannedHours = round2(input.milestones.reduce((s, m) => s + m.plannedHours, 0));
  const approvedHours = round2(input.milestones.reduce((s, m) => s + m.approvedHours, 0));
  const unplannedHours = round2(Math.max(0, input.budgetHours - plannedHours));

  let forecastRevenue: number;
  let earnedRevenue: number;
  let recognizedRevenue: number;

  if (input.billingType === "FIXED_PRICE") {
    forecastRevenue = round2(input.contractValue);
    // Per-milestone: a COMPLETE/INVOICED milestone earns its full (adjusted) value even with no
    // logged hours; an in-progress one earns percentage-of-completion by its own hours. Value
    // adjustments (money removed/absorbed) apply to the milestone's effective lump sum.
    const done = (m: MilestoneRevenueInput) => m.status === "COMPLETE" || m.status === "INVOICED";
    const effective = (m: MilestoneRevenueInput) => m.salesPrice + (m.adjustment ?? 0);
    // Milestones keep LIST prices; the deal-level discount lives on the project (contractValue = list
    // − discount). Distribute the contract value across milestones by their list-value share, so the
    // discount is respected and a fully-delivered project earns exactly the contract value, not the
    // pre-discount list total. Fall back to list values when no contract value is set.
    const totalList = input.milestones.reduce((s, m) => s + effective(m), 0);
    const scale = contractValueScale(input.contractValue, totalList);
    earnedRevenue = round2(
      input.milestones.reduce((s, m) => {
        const value = effective(m) * scale;
        if (done(m)) return s + value;
        const ratio = m.budgetHours > 0 ? Math.min(1, m.approvedHours / m.budgetHours) : 0;
        return s + ratio * value;
      }, 0),
    );
    recognizedRevenue = round2(input.milestones.filter(done).reduce((s, m) => s + effective(m) * scale, 0));
  } else {
    // T&M / RETAINER — only billable milestones generate revenue.
    const billable = input.milestones.filter((m) => m.billable);
    earnedRevenue = round2(billable.reduce((s, m) => s + m.approvedHours * m.salesPrice, 0));
    forecastRevenue = round2(billable.reduce((s, m) => s + m.plannedHours * m.salesPrice, 0));
    recognizedRevenue = earnedRevenue;
  }

  // Cost has two sources and both belong in margin: our own people's time, and whatever we paid a
  // partner to deliver part of the work. Counting only the first inflates the margin of every
  // project delivered through a subcontractor.
  const internalCost = round2(input.internalCost);
  const externalCost = round2(input.externalCost ?? 0);
  const totalCost = round2(internalCost + externalCost);
  // External bills are already committed, so they weigh on the forecast too — otherwise the
  // forecast column reintroduces exactly the inflated margin this split exists to remove.
  const forecastTotalCost = round2(input.forecastCost + externalCost);

  return {
    plannedHours,
    approvedHours,
    unplannedHours,
    forecastRevenue,
    earnedRevenue,
    recognizedRevenue,
    internalCost,
    externalCost,
    totalCost,
    margin: round2(earnedRevenue - totalCost),
    forecastCost: round2(input.forecastCost),
    forecastTotalCost: forecastTotalCost,
    forecastMargin: round2(forecastRevenue - forecastTotalCost),
  };
}
