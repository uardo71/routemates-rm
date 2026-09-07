import { describe, it, expect } from "vitest";
import { invoiceTotals, outstanding, paymentSettles, totalBankFees, cashCollected, agingBucket, daysOverdue, dso, effectiveDueDate, countsTowardAR } from "@/lib/invoice";

describe("invoiceTotals", () => {
  it("treats VAT null as no VAT", () => {
    expect(invoiceTotals([{ amount: 100 }, { amount: 50 }], null)).toEqual({ net: 150, vat: 0, gross: 150 });
  });

  it("treats VAT 0 as no VAT", () => {
    expect(invoiceTotals([{ amount: 100 }, { amount: 50 }], 0)).toEqual({ net: 150, vat: 0, gross: 150 });
  });

  it("applies a 20% VAT rate", () => {
    expect(invoiceTotals([{ amount: 100 }], 20)).toEqual({ net: 100, vat: 20, gross: 120 });
  });

  it("returns zeros for an empty line list (VAT null and VAT 20)", () => {
    expect(invoiceTotals([], 20)).toEqual({ net: 0, vat: 0, gross: 0 });
    expect(invoiceTotals([], null)).toEqual({ net: 0, vat: 0, gross: 0 });
  });

  it("handles credit-note negative amounts (net/VAT/gross all negative)", () => {
    expect(invoiceTotals([{ amount: -100 }], 20)).toEqual({ net: -100, vat: -20, gross: -120 });
  });
});

describe("outstanding", () => {
  it("equals gross when there are no payments", () => {
    expect(outstanding(120, [])).toBe(120);
  });
  it("subtracts a partial payment", () => {
    expect(outstanding(120, [{ amount: 50 }])).toBe(70);
  });
  it("is 0 when paid exactly", () => {
    expect(outstanding(120, [{ amount: 120 }])).toBe(0);
  });
  it("goes negative on over-payment", () => {
    expect(outstanding(120, [{ amount: 150 }])).toBe(-30);
  });
  it("handles a gross of 0", () => {
    expect(outstanding(0, [])).toBe(0);
    expect(outstanding(0, [{ amount: 10 }])).toBe(-10);
  });
});

// ---------- AR aging / overdue / DSO ----------

const DUE = new Date(2026, 0, 31); // 31 Jan 2026
const at = (y: number, m: number, d: number) => new Date(y, m, d);

describe("daysOverdue", () => {
  it("is 0 ON the due date itself — due today is not yet late", () => {
    expect(daysOverdue(DUE, at(2026, 0, 31))).toBe(0);
  });
  it("counts whole days past the due date", () => {
    expect(daysOverdue(DUE, at(2026, 1, 1))).toBe(1);
    expect(daysOverdue(DUE, at(2026, 2, 1))).toBe(29); // Feb 2026 has 28 days
  });
  it("is negative while the invoice is still within terms", () => {
    expect(daysOverdue(DUE, at(2026, 0, 21))).toBe(-10);
  });
  it("ignores the time of day (a late-evening 'today' is still 0 days over)", () => {
    expect(daysOverdue(DUE, new Date(2026, 0, 31, 23, 59, 59))).toBe(0);
  });
  it("returns null for a missing due date rather than guessing", () => {
    expect(daysOverdue(null, at(2026, 5, 1))).toBeNull();
    expect(daysOverdue(undefined, at(2026, 5, 1))).toBeNull();
  });
});

describe("agingBucket", () => {
  it("is CURRENT before and on the due date", () => {
    expect(agingBucket(DUE, at(2026, 0, 20))).toBe("CURRENT");
    expect(agingBucket(DUE, at(2026, 0, 31))).toBe("CURRENT");
  });

  it("uses inclusive upper edges at exactly 30, 60 and 90 days", () => {
    const plus = (n: number) => { const d = new Date(DUE); d.setDate(d.getDate() + n); return d; };
    expect(agingBucket(DUE, plus(1))).toBe("D1_30");
    expect(agingBucket(DUE, plus(30))).toBe("D1_30"); // exactly 30 → still 1–30
    expect(agingBucket(DUE, plus(31))).toBe("D31_60");
    expect(agingBucket(DUE, plus(60))).toBe("D31_60"); // exactly 60 → still 31–60
    expect(agingBucket(DUE, plus(61))).toBe("D61_90");
    expect(agingBucket(DUE, plus(90))).toBe("D61_90"); // exactly 90 → still 61–90
    expect(agingBucket(DUE, plus(91))).toBe("D90_PLUS");
    expect(agingBucket(DUE, plus(400))).toBe("D90_PLUS");
  });

  it("puts a missing due date in its own bucket, never CURRENT", () => {
    expect(agingBucket(null, at(2026, 5, 1))).toBe("NO_DUE_DATE");
  });
});

describe("dso", () => {
  it("returns 0 for zero revenue (no division by zero)", () => {
    expect(dso(0, 5000, 90)).toBe(0);
    expect(Number.isFinite(dso(0, 5000, 90))).toBe(true);
  });
  it("returns 0 for negative revenue (net credit notes)", () => {
    expect(dso(-1000, 5000, 90)).toBe(0);
  });
  it("computes receivables ÷ revenue × days", () => {
    expect(dso(90000, 30000, 90)).toBe(30); // a third of 90 days' revenue outstanding
    expect(dso(9000, 9000, 90)).toBe(90);
  });
  it("is 0 when nothing is outstanding", () => {
    expect(dso(50000, 0, 90)).toBe(0);
  });
});

describe("effectiveDueDate", () => {
  it("prefers the invoice's own due date", () => {
    const own = at(2026, 1, 15);
    expect(effectiveDueDate(own, at(2026, 0, 1), 30)).toBe(own);
  });
  it("derives issue date + client payment terms when the due date is missing", () => {
    const d = effectiveDueDate(null, at(2026, 0, 1), 30)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(31); // 1 Jan + 30 days
  });
  it("handles 0-day terms (due on issue)", () => {
    const d = effectiveDueDate(null, at(2026, 0, 1), 0)!;
    expect(d.getDate()).toBe(1);
  });
  it("returns null when there are no terms to derive from", () => {
    expect(effectiveDueDate(null, at(2026, 0, 1), null)).toBeNull();
  });
});

describe("countsTowardAR", () => {
  it("excludes DRAFT and VOID, includes issued/reconciled/paid", () => {
    expect(countsTowardAR("DRAFT")).toBe(false);
    expect(countsTowardAR("VOID")).toBe(false);
    expect(countsTowardAR("ISSUED")).toBe(true);
    expect(countsTowardAR("RECONCILED")).toBe(true);
    expect(countsTowardAR("PAID")).toBe(true);
  });
});

// ---------- bank charges withheld from a payment ----------

describe("payments with bank charges", () => {
  it("settles amount + fee — the customer parted with both", () => {
    expect(paymentSettles({ amount: 997, bankFee: 3 })).toBe(1000);
    expect(paymentSettles({ amount: 997 })).toBe(997); // no fee recorded
    expect(paymentSettles({ amount: 997, bankFee: null })).toBe(997);
  });

  it("closes an invoice whose payment arrived short by the bank's fee", () => {
    // €1,000 invoice, €997 landed, €3 kept by the bank. Without counting the fee this invoice
    // would sit forever showing €3 outstanding and never reach PAID.
    expect(outstanding(1000, [{ amount: 997, bankFee: 3 }])).toBe(0);
    // Ignoring the fee is exactly the bug: it leaves a phantom balance.
    expect(outstanding(1000, [{ amount: 997 }])).toBe(3);
  });

  it("still reports a genuine shortfall when the customer really underpaid", () => {
    // €900 received, €3 fee ⇒ €903 settled, so €97 is still genuinely owed.
    expect(outstanding(1000, [{ amount: 900, bankFee: 3 }])).toBe(97);
  });

  it("accumulates fees across several partial payments", () => {
    const payments = [
      { amount: 497, bankFee: 3 },
      { amount: 495, bankFee: 5 },
    ];
    expect(outstanding(1000, payments)).toBe(0); // 500 + 500
    expect(totalBankFees(payments)).toBe(8);
    expect(cashCollected(payments)).toBe(992); // what actually reached the account
  });

  it("keeps cash collected and debt settled as distinct numbers", () => {
    const payments = [{ amount: 997, bankFee: 3 }];
    expect(cashCollected(payments)).toBe(997); // bank reality
    expect(outstanding(1000, payments)).toBe(0); // customer reality
  });

  it("handles a zero fee and rounds to cents", () => {
    expect(totalBankFees([{ amount: 100, bankFee: 0 }])).toBe(0);
    expect(totalBankFees([])).toBe(0);
    expect(paymentSettles({ amount: 0.1, bankFee: 0.2 })).toBe(0.3);
  });
});
