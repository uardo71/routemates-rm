import { describe, it, expect, vi } from "vitest";
import { convertWith, pickLatestRate, type RateLookup } from "@/lib/fx";

// A lookup built from an explicit {"FROM>TO": rate} table.
function table(rates: Record<string, number>): RateLookup {
  return (from, to) => rates[`${from}>${to}`] ?? null;
}

describe("convertWith", () => {
  it("is identity when from === to (lookup never consulted)", async () => {
    const lookup = vi.fn<RateLookup>(() => null);
    expect(await convertWith(100, "EUR", "EUR", lookup)).toBe(100);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses a direct rate (multiply)", async () => {
    expect(await convertWith(100, "USD", "EUR", table({ "USD>EUR": 0.9 }))).toBe(90);
  });

  it("uses an inverse rate (divide) when only the reverse pair exists", async () => {
    expect(await convertWith(105, "ALL", "EUR", table({ "EUR>ALL": 105 }))).toBe(1); // 105 / 105
  });

  it("triangulates through EUR when neither direct nor inverse exists", async () => {
    // ALL→USD unknown; go ALL→EUR (inverse of EUR→ALL) then EUR→USD (direct).
    const lookup = table({ "EUR>ALL": 100, "EUR>USD": 1.1 });
    // 210 ALL / 100 = 2.1 EUR; × 1.1 = 2.31 USD
    expect(await convertWith(210, "ALL", "USD", lookup)).toBeCloseTo(2.31, 10);
  });

  it("triangulates with direct legs on both sides", async () => {
    const lookup = table({ "ALL>EUR": 0.01, "EUR>USD": 1.2 });
    // 500 ALL × 0.01 = 5 EUR; × 1.2 = 6 USD
    expect(await convertWith(500, "ALL", "USD", lookup)).toBeCloseTo(6, 10);
  });

  it("returns null when no path resolves", async () => {
    expect(await convertWith(100, "USD", "GBP", table({ "EUR>ALL": 100 }))).toBeNull();
  });
});

describe("pickLatestRate", () => {
  const rows = [
    { rate: 1.0, effectiveFrom: new Date("2026-01-01") },
    { rate: 1.1, effectiveFrom: new Date("2026-03-01") },
    { rate: 1.2, effectiveFrom: new Date("2026-06-01") },
  ];

  it("picks the latest rate at or before asOf, not a later one", () => {
    expect(pickLatestRate(rows, new Date("2026-04-30"))).toBe(1.1); // March rate, not June
  });

  it("includes a rate effective exactly on asOf", () => {
    expect(pickLatestRate(rows, new Date("2026-03-01"))).toBe(1.1);
  });

  it("returns null when every rate is after asOf", () => {
    expect(pickLatestRate(rows, new Date("2025-12-31"))).toBeNull();
  });

  it("returns the most recent rate when asOf is after all of them", () => {
    expect(pickLatestRate(rows, new Date("2027-01-01"))).toBe(1.2);
  });
});
