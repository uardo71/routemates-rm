import { describe, it, expect } from "vitest";
import { budgetMetrics } from "@/lib/budget";

describe("budgetMetrics", () => {
  it("returns null variance and null percentage when the corresponding budget is 0", () => {
    const r = budgetMetrics({ budgetHours: 0, actualHours: 5, budgetCost: 0, actualCost: 100 });
    expect(r.hoursVariance).toBeNull();
    expect(r.hoursUsedPct).toBeNull();
    expect(r.costVariance).toBeNull();
    expect(r.costUsedPct).toBeNull();
    expect(r.overHours).toBe(false); // no budget ⇒ can't be over
    expect(r.overCost).toBe(false);
  });

  it("computes variance/percentage against a non-zero budget", () => {
    const r = budgetMetrics({ budgetHours: 40, actualHours: 30, budgetCost: 1000, actualCost: 250 });
    expect(r.hoursVariance).toBe(10); // 40 − 30
    expect(r.costVariance).toBe(750); // 1000 − 250
    expect(r.hoursUsedPct).toBe(75); // 30/40 × 100
    expect(r.costUsedPct).toBe(25);
  });

  it("is NOT over budget when actual is exactly at budget", () => {
    const r = budgetMetrics({ budgetHours: 40, actualHours: 40, budgetCost: 1000, actualCost: 1000 });
    expect(r.overHours).toBe(false);
    expect(r.overCost).toBe(false);
    expect(r.hoursVariance).toBe(0);
    expect(r.costVariance).toBe(0);
    expect(r.hoursUsedPct).toBe(100);
    expect(r.costUsedPct).toBe(100);
  });

  it("is over budget at one cent / one hundredth of an hour over", () => {
    const r = budgetMetrics({ budgetHours: 40, actualHours: 40.01, budgetCost: 1000, actualCost: 1000.01 });
    expect(r.overHours).toBe(true);
    expect(r.overCost).toBe(true);
    expect(r.hoursVariance).toBe(-0.01);
    expect(r.costVariance).toBe(-0.01);
  });
});
