import { describe, it, expect } from "vitest";
import { computeProjectRevenue, realizationMetrics, wipMetrics, type MilestoneRevenueInput, type ProjectRevenueInput } from "@/lib/revenue";

function ms(o: Partial<MilestoneRevenueInput> = {}): MilestoneRevenueInput {
  return { salesPrice: 0, budgetHours: 0, status: "ACTIVE", approvedHours: 0, plannedHours: 0, billable: true, ...o };
}
function project(o: Partial<ProjectRevenueInput> = {}): ProjectRevenueInput {
  return { billingType: "TIME_AND_MATERIALS", contractValue: 0, budgetHours: 0, internalCost: 0, externalCost: 0, forecastCost: 0, milestones: [], ...o };
}

describe("computeProjectRevenue — T&M / RETAINER", () => {
  it("earns Σ approvedHours × salesPrice over billable milestones only; non-billable adds hours but no revenue", () => {
    const r = computeProjectRevenue(
      project({
        billingType: "TIME_AND_MATERIALS",
        milestones: [
          ms({ approvedHours: 10, plannedHours: 12, salesPrice: 100, billable: true }),
          ms({ approvedHours: 5, plannedHours: 5, salesPrice: 200, billable: false }),
        ],
      }),
    );
    expect(r.earnedRevenue).toBe(1000); // only the billable milestone (10 × 100); non-billable 5 × 200 excluded
    expect(r.forecastRevenue).toBe(1200); // billable planned only: 12 × 100
    expect(r.recognizedRevenue).toBe(r.earnedRevenue); // T&M: recognized === earned
    expect(r.approvedHours).toBe(15); // hours count both billable and non-billable milestones
    expect(r.plannedHours).toBe(17);
  });

  it("RETAINER behaves like T&M (rate-driven)", () => {
    const r = computeProjectRevenue(project({ billingType: "RETAINER", milestones: [ms({ approvedHours: 8, plannedHours: 8, salesPrice: 50 })] }));
    expect(r.earnedRevenue).toBe(400);
    expect(r.recognizedRevenue).toBe(400);
  });
});

describe("computeProjectRevenue — FIXED_PRICE", () => {
  it("a COMPLETE milestone earns its full effective value even with zero approved hours", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 5000, budgetHours: 100, milestones: [ms({ salesPrice: 5000, budgetHours: 100, approvedHours: 0, status: "COMPLETE" })] }),
    );
    expect(r.earnedRevenue).toBe(5000);
    expect(r.recognizedRevenue).toBe(5000);
    expect(r.forecastRevenue).toBe(5000);
  });

  it("an INVOICED milestone likewise earns full value with no hours", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 3000, budgetHours: 50, milestones: [ms({ salesPrice: 3000, budgetHours: 50, approvedHours: 0, status: "INVOICED" })] }),
    );
    expect(r.earnedRevenue).toBe(3000);
    expect(r.recognizedRevenue).toBe(3000);
  });

  it("an in-progress milestone earns min(1, approved/budget) × effective", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 10000, budgetHours: 100, milestones: [ms({ salesPrice: 10000, budgetHours: 100, approvedHours: 25, status: "ACTIVE" })] }),
    );
    expect(r.earnedRevenue).toBe(2500); // 0.25 × 10000
    expect(r.recognizedRevenue).toBe(0); // nothing COMPLETE/INVOICED yet
  });

  it("budgetHours === 0 earns 0 rather than dividing by zero", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 8000, budgetHours: 0, milestones: [ms({ salesPrice: 8000, budgetHours: 0, approvedHours: 50, status: "ACTIVE" })] }),
    );
    expect(r.earnedRevenue).toBe(0);
    expect(Number.isFinite(r.earnedRevenue)).toBe(true); // not NaN / Infinity
  });

  it("a negative adjustment reduces the effective value", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 8000, budgetHours: 100, milestones: [ms({ salesPrice: 10000, adjustment: -2000, budgetHours: 100, approvedHours: 100, status: "COMPLETE" })] }),
    );
    expect(r.earnedRevenue).toBe(8000); // effective = 10000 + (−2000); contractValue 8000 ⇒ scale 1
  });

  it("over-delivery is capped at 100%", () => {
    const r = computeProjectRevenue(
      project({ billingType: "FIXED_PRICE", contractValue: 10000, budgetHours: 100, milestones: [ms({ salesPrice: 10000, budgetHours: 100, approvedHours: 200, status: "ACTIVE" })] }),
    );
    expect(r.earnedRevenue).toBe(10000); // min(1, 200/100) = 1, not 2×
  });

  it("scales list values to the contract value when a discount is present", () => {
    // Two COMPLETE milestones list 6000 total; contract 3000 (50% discount) ⇒ earn exactly 3000.
    const r = computeProjectRevenue(
      project({
        billingType: "FIXED_PRICE", contractValue: 3000, budgetHours: 100,
        milestones: [ms({ salesPrice: 4000, budgetHours: 60, approvedHours: 60, status: "COMPLETE" }), ms({ salesPrice: 2000, budgetHours: 40, approvedHours: 40, status: "COMPLETE" })],
      }),
    );
    expect(r.earnedRevenue).toBe(3000);
    expect(r.recognizedRevenue).toBe(3000);
  });
});

describe("computeProjectRevenue — hours, margin, rounding", () => {
  it("unplannedHours never goes negative when planned exceeds budget", () => {
    const over = computeProjectRevenue(project({ budgetHours: 100, milestones: [ms({ plannedHours: 90 }), ms({ plannedHours: 60 })] }));
    expect(over.plannedHours).toBe(150);
    expect(over.unplannedHours).toBe(0); // max(0, 100 − 150)
    const under = computeProjectRevenue(project({ budgetHours: 100, milestones: [ms({ plannedHours: 40 })] }));
    expect(under.unplannedHours).toBe(60);
  });

  it("margin === earned − cost and forecastMargin === forecastRevenue − forecastCost, incl. negatives", () => {
    const r = computeProjectRevenue(
      project({ billingType: "TIME_AND_MATERIALS", internalCost: 1500, forecastCost: 2000, milestones: [ms({ approvedHours: 10, plannedHours: 12, salesPrice: 100 })] }),
    );
    expect(r.earnedRevenue).toBe(1000);
    expect(r.margin).toBe(-500); // 1000 − 1500
    expect(r.forecastRevenue).toBe(1200);
    expect(r.forecastMargin).toBe(-800); // 1200 − 2000
    expect(r.internalCost).toBe(1500);
    expect(r.externalCost).toBe(0);
    expect(r.totalCost).toBe(1500);
    expect(r.forecastCost).toBe(2000);
  });

  it("round2 cleans binary float error and rounds .005 up consistently", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754 → must come back as a clean 0.3
    const noise = computeProjectRevenue(project({ milestones: [ms({ approvedHours: 0.1, salesPrice: 1 }), ms({ approvedHours: 0.2, salesPrice: 1 })] }));
    expect(noise.earnedRevenue).toBe(0.3);
    // 0.005 lands on the rounding boundary → rounds up to 0.01
    const half = computeProjectRevenue(project({ milestones: [ms({ approvedHours: 0.005, salesPrice: 1 })] }));
    expect(half.earnedRevenue).toBe(0.01);
    // every returned money value is clean to 2 decimals (no float tail)
    expect(Number.isInteger(noise.earnedRevenue * 100)).toBe(true);
  });
});

describe("wipMetrics", () => {
  it("reports earned − invoiced as unbilled, with no over-billing", () => {
    const r = wipMetrics({ earned: 10000, invoiced: 6000, unbilledHours: 40 });
    expect(r.unbilled).toBe(4000);
    expect(r.overBilled).toBe(0);
    expect(r.earned).toBe(10000);
    expect(r.invoiced).toBe(6000);
    expect(r.unbilledHours).toBe(40);
  });

  it("treats a project with zero invoices as fully unbilled", () => {
    const r = wipMetrics({ earned: 7500, invoiced: 0, unbilledHours: 30 });
    expect(r.unbilled).toBe(7500);
    expect(r.overBilled).toBe(0);
  });

  it("flags over-billing (deposit / prepaid retainer) and keeps unbilled negative", () => {
    // Billed a 5000 deposit before any work was delivered.
    const r = wipMetrics({ earned: 2000, invoiced: 5000, unbilledHours: 0 });
    expect(r.unbilled).toBe(-3000); // signed: billed ahead of delivery
    expect(r.overBilled).toBe(3000); // the same gap, surfaced positively
  });

  it("is balanced when earned equals invoiced", () => {
    const r = wipMetrics({ earned: 4200, invoiced: 4200, unbilledHours: 0 });
    expect(r.unbilled).toBe(0);
    expect(r.overBilled).toBe(0);
  });

  it("handles an empty project (no work, no invoices)", () => {
    const r = wipMetrics({ earned: 0, invoiced: 0, unbilledHours: 0 });
    expect(r).toEqual({ earned: 0, invoiced: 0, unbilled: 0, overBilled: 0, unbilledHours: 0 });
  });

  it("rounds to cents rather than carrying float noise", () => {
    const r = wipMetrics({ earned: 0.1 + 0.2, invoiced: 0.1, unbilledHours: 0.005 });
    expect(r.earned).toBe(0.3);
    expect(r.unbilled).toBe(0.2);
    expect(r.unbilledHours).toBe(0.01);
  });
});

describe("realizationMetrics", () => {
  it("handles zero worked hours without dividing by zero", () => {
    const r = realizationMetrics({ workedHours: 0, billableHours: 0, billedHours: 0, revenue: 0 });
    expect(r.realizationPct).toBe(0);
    expect(r.effectiveHourlyRate).toBe(0);
    expect(r.writeOffHours).toBe(0);
    expect(Number.isFinite(r.realizationPct)).toBe(true);
    expect(Number.isFinite(r.effectiveHourlyRate)).toBe(true);
  });

  it("reports 100% realization when every worked hour is billed", () => {
    const r = realizationMetrics({ workedHours: 10, billableHours: 10, billedHours: 10, revenue: 1000 });
    expect(r.realizationPct).toBe(100);
    expect(r.effectiveHourlyRate).toBe(100); // 1000 / 10
    expect(r.writeOffHours).toBe(0);
  });

  it("counts non-billable hours in worked (dragging realization + effective rate down)", () => {
    // 10 worked = 8 on billable milestones + 2 on a non-billable one; all 8 billable hours are billed.
    const r = realizationMetrics({ workedHours: 10, billableHours: 8, billedHours: 8, revenue: 800 });
    expect(r.realizationPct).toBe(80); // 8 billed / 10 worked
    expect(r.effectiveHourlyRate).toBe(80); // 800 / 10 worked, not / 8
    expect(r.writeOffHours).toBe(0);
  });

  it("surfaces unbilled billable hours as write-off", () => {
    const r = realizationMetrics({ workedHours: 10, billableHours: 10, billedHours: 6, revenue: 600 });
    expect(r.realizationPct).toBe(60); // 6 / 10
    expect(r.effectiveHourlyRate).toBe(60); // 600 / 10
    expect(r.writeOffHours).toBe(4); // 10 billable − 6 billed
  });
});

// ---------- internal vs external (subcontractor) cost ----------

describe("computeProjectRevenue — cost split", () => {
  it("defaults external cost to 0, so an in-house project is unchanged", () => {
    const r = computeProjectRevenue(
      project({ internalCost: 400, milestones: [ms({ approvedHours: 10, salesPrice: 100 })] }),
    );
    expect(r.internalCost).toBe(400);
    expect(r.externalCost).toBe(0);
    expect(r.totalCost).toBe(400);
    expect(r.margin).toBe(600); // 1000 − 400
  });

  it("subtracts partner bills from margin — the bug this split exists to fix", () => {
    const inHouse = computeProjectRevenue(
      project({ internalCost: 400, milestones: [ms({ approvedHours: 10, salesPrice: 100 })] }),
    );
    const withPartner = computeProjectRevenue(
      project({ internalCost: 400, externalCost: 250, milestones: [ms({ approvedHours: 10, salesPrice: 100 })] }),
    );
    expect(withPartner.totalCost).toBe(650); // 400 + 250
    expect(withPartner.margin).toBe(350); // 1000 − 650, NOT 600
    expect(withPartner.margin).toBeLessThan(inHouse.margin); // partner money must reduce margin
    // Revenue itself is untouched — only cost changed.
    expect(withPartner.earnedRevenue).toBe(inHouse.earnedRevenue);
  });

  it("handles a project delivered entirely by a partner: external cost, zero internal hours", () => {
    // Fully subcontracted fixed-price work — nobody internal logged a minute, but we paid €9,000
    // and billed €12,000. The old math reported a 100% margin here.
    const r = computeProjectRevenue(
      project({
        billingType: "FIXED_PRICE",
        contractValue: 12000,
        budgetHours: 0,
        internalCost: 0,
        externalCost: 9000,
        milestones: [ms({ salesPrice: 12000, budgetHours: 0, approvedHours: 0, status: "COMPLETE" })],
      }),
    );
    expect(r.approvedHours).toBe(0);
    expect(r.earnedRevenue).toBe(12000); // COMPLETE milestone earns its full value with no hours
    expect(r.internalCost).toBe(0);
    expect(r.externalCost).toBe(9000);
    expect(r.totalCost).toBe(9000);
    expect(r.margin).toBe(3000); // not 12000
  });

  it("can drive margin negative when a partner costs more than the work earned", () => {
    const r = computeProjectRevenue(
      project({ internalCost: 100, externalCost: 2000, milestones: [ms({ approvedHours: 10, salesPrice: 100 })] }),
    );
    expect(r.margin).toBe(-1100); // 1000 − 2100
  });

  it("weighs committed external cost on the forecast too", () => {
    const r = computeProjectRevenue(
      project({
        internalCost: 0,
        externalCost: 500,
        forecastCost: 1000,
        milestones: [ms({ plannedHours: 20, salesPrice: 100 })],
      }),
    );
    expect(r.forecastRevenue).toBe(2000);
    expect(r.forecastCost).toBe(1000); // internal only
    expect(r.forecastTotalCost).toBe(1500); // + the committed bill
    expect(r.forecastMargin).toBe(500); // 2000 − 1500, not 1000
  });

  it("rounds the split to cents without drift", () => {
    const r = computeProjectRevenue(
      project({ internalCost: 0.1, externalCost: 0.2, milestones: [ms({ approvedHours: 1, salesPrice: 1 })] }),
    );
    expect(r.totalCost).toBe(0.3); // not 0.30000000000000004
    expect(r.margin).toBe(0.7);
  });
});
