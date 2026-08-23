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
  /** Actual cost to date = Σ(approved hours × historical cost rate), computed by the caller. */
  cost: number;
  /** Projected cost of the whole plan = Σ(planned hours × current cost rate), computed by the caller. */
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
  cost: number;
  /** Gross margin against earned revenue (earned − actual cost). */
  margin: number;
  /** Projected cost of the whole plan = Σ(planned hours × current cost rate). */
  forecastCost: number;
  /** Projected margin if the whole plan is delivered = forecast revenue − forecast cost. */
  forecastMargin: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    const scale = totalList > 0 && input.contractValue > 0 ? input.contractValue / totalList : 1;
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

  return {
    plannedHours,
    approvedHours,
    unplannedHours,
    forecastRevenue,
    earnedRevenue,
    recognizedRevenue,
    cost: round2(input.cost),
    margin: round2(earnedRevenue - input.cost),
    forecastCost: round2(input.forecastCost),
    forecastMargin: round2(forecastRevenue - input.forecastCost),
  };
}
