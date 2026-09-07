import { describe, it, expect } from "vitest";
import { entitlementForYear, walkVacationBalance, ANNUAL_VACATION_ENTITLEMENT } from "@/lib/vacation-calc";

const NONE = () => 0;

describe("entitlementForYear (hire-date accrual)", () => {
  it("prorates a mid-year (July) hire by months remaining", () => {
    // getMonth() July = 6 ⇒ 6 months remaining ⇒ round(20 × 6/12) = 10
    expect(entitlementForYear(new Date(2024, 6, 1), 2024)).toBe(10);
  });
  it("gives a full year for a January hire", () => {
    expect(entitlementForYear(new Date(2024, 0, 1), 2024)).toBe(ANNUAL_VACATION_ENTITLEMENT);
  });
  it("rounds a December hire to ~2 days", () => {
    // 1 month remaining ⇒ round(20/12) = round(1.67) = 2
    expect(entitlementForYear(new Date(2024, 11, 15), 2024)).toBe(2);
  });
  it("is 0 for years before the hire year and full for years after", () => {
    expect(entitlementForYear(new Date(2024, 6, 1), 2023)).toBe(0);
    expect(entitlementForYear(new Date(2024, 6, 1), 2025)).toBe(ANNUAL_VACATION_ENTITLEMENT);
  });
});

describe("walkVacationBalance — carry-in seeding vs hire-date accrual", () => {
  it("carry-in path seeds from the baseline year with FULL entitlement (no first-year proration)", () => {
    // Established employee joined mid-2020, admin set opening 12 days as of 2024.
    const r = walkVacationBalance({ joinDate: new Date(2020, 6, 1), openingDays: 12, openingYear: 2024, asOfYear: 2024, takenByYear: NONE });
    expect(r.year).toBe(2024);
    expect(r.carriedIn).toBe(12); // seeded opening, not re-derived from 2020
    expect(r.entitlement).toBe(20); // FULL, despite a July join date
    expect(r.balance).toBe(32); // 12 + 20 − 0
  });

  it("carry-in path carries the running balance across years, subtracting taken days", () => {
    const taken = (y: number) => (y === 2023 ? 5 : y === 2024 ? 10 : 0);
    const r = walkVacationBalance({ joinDate: new Date(2019, 0, 1), openingDays: 12, openingYear: 2023, asOfYear: 2024, takenByYear: taken });
    // 2023: 12 + 20 − 5 = 27 ; 2024: carriedIn 27, 27 + 20 − 10 = 37
    expect(r.year).toBe(2024);
    expect(r.carriedIn).toBe(27);
    expect(r.taken).toBe(10);
    expect(r.balance).toBe(37);
  });

  it("hire-date accrual path prorates the first year and seeds from 0", () => {
    const r = walkVacationBalance({ joinDate: new Date(2024, 6, 1), openingDays: null, openingYear: null, asOfYear: 2024, takenByYear: NONE });
    expect(r.carriedIn).toBe(0);
    expect(r.entitlement).toBe(10); // July hire prorated
    expect(r.balance).toBe(10);
  });

  it("hire-date accrual carries the balance across a year boundary", () => {
    // Jan 2023 hire (full first year), no leave taken → carryover accumulates into 2024.
    const r = walkVacationBalance({ joinDate: new Date(2023, 0, 1), openingDays: null, openingYear: null, asOfYear: 2024, takenByYear: NONE });
    expect(r.year).toBe(2024);
    expect(r.carriedIn).toBe(20); // last year's full 20 carried in
    expect(r.balance).toBe(40); // 20 + 20
  });

  it("returns the seed unchanged when asOfYear precedes the start year", () => {
    const r = walkVacationBalance({ joinDate: new Date(2019, 0, 1), openingDays: 12, openingYear: 2024, asOfYear: 2023, takenByYear: NONE });
    expect(r.year).toBe(2024);
    expect(r.balance).toBe(12);
  });
});
