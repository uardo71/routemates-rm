// Pure budget-vs-actual math for the Budgets rollup — no Prisma/runtime deps, so it can be
// imported on client or server. The caller aggregates budgeted vs actual hours/cost from the DB
// (milestone budget hours + budgeted cost vs approved-time hours + approved-time cost) and this
// derives the variance and utilisation for a row at any level (milestone/project/client/company).

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type BudgetInput = { budgetHours: number; actualHours: number; budgetCost: number; actualCost: number };

export type BudgetMetrics = BudgetInput & {
  /** budgetCost − actualCost. Negative = over budget (overspent). null when no cost budget is set,
   *  so "remaining" reads as "—" instead of a misleading −actualCost. */
  costVariance: number | null;
  /** budgetHours − actualHours. Negative = over the hour budget. null when no hour budget is set. */
  hoursVariance: number | null;
  /** actualCost / budgetCost × 100, or null when there's no cost budget to measure against. */
  costUsedPct: number | null;
  /** actualHours / budgetHours × 100, or null when there's no hour budget. */
  hoursUsedPct: number | null;
  overCost: boolean;
  overHours: boolean;
};

export function budgetMetrics(input: BudgetInput): BudgetMetrics {
  const budgetHours = round2(input.budgetHours);
  const actualHours = round2(input.actualHours);
  const budgetCost = round2(input.budgetCost);
  const actualCost = round2(input.actualCost);
  return {
    budgetHours,
    actualHours,
    budgetCost,
    actualCost,
    costVariance: budgetCost > 0 ? round2(budgetCost - actualCost) : null,
    hoursVariance: budgetHours > 0 ? round2(budgetHours - actualHours) : null,
    costUsedPct: budgetCost > 0 ? round2((actualCost / budgetCost) * 100) : null,
    hoursUsedPct: budgetHours > 0 ? round2((actualHours / budgetHours) * 100) : null,
    overCost: budgetCost > 0 && actualCost > budgetCost,
    overHours: budgetHours > 0 && actualHours > budgetHours,
  };
}
