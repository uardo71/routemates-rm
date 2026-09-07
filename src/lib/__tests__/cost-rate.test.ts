import { describe, it, expect } from "vitest";
import { workingDaysInMonth, hourlyRateFromMonthly } from "@/lib/cost-rate";

describe("workingDaysInMonth", () => {
  it("counts Mon–Fri across months with different working-day counts", () => {
    expect(workingDaysInMonth(2024, 1)).toBe(23); // Jan 2024 (starts Mon), 31 days − 8 weekend
    expect(workingDaysInMonth(2024, 2)).toBe(21); // Feb 2024 (leap, 29 days) − 8 weekend
    expect(workingDaysInMonth(2021, 2)).toBe(20); // Feb 2021 (28 days, starts Mon) − 8 weekend
    expect(workingDaysInMonth(2024, 1)).not.toBe(workingDaysInMonth(2024, 2)); // month drives the divisor
  });
});

describe("hourlyRateFromMonthly", () => {
  it("divides monthly EUR by (working days × 8h), rounded to cents", () => {
    expect(hourlyRateFromMonthly(2000, 2021, 2)).toBe(12.5); // 2000 / (20 × 8) = 2000/160
  });
  it("yields a different rate in a month with more working days", () => {
    expect(hourlyRateFromMonthly(2000, 2024, 1)).toBe(10.87); // 2000 / (23 × 8) = 2000/184 = 10.8695… → 10.87
  });
  it("rounds to two decimals", () => {
    expect(hourlyRateFromMonthly(2000, 2024, 2)).toBe(11.9); // 2000 / (21 × 8) = 2000/168 = 11.9047… → 11.90
  });
});
