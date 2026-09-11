import { describe, it, expect } from "vitest";
import {
  diffFields,
  redactDiff,
  summarize,
  isMoneyField,
  normalizeValue,
  formatAuditValue,
  fieldLabel,
  hasMoneyChange,
  REDACTED,
  referenceIds,
  resolveReferences,
  summaryTail,
} from "@/lib/audit-diff";

// A stand-in for Prisma's Decimal: the diff must never depend on the class, only on toNumber().
const dec = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

describe("normalizeValue", () => {
  it("collapses Prisma scalars to JSON-safe values", () => {
    expect(normalizeValue(dec(12.5))).toBe(12.5);
    expect(normalizeValue(new Date("2026-09-10T00:00:00.000Z"))).toBe("2026-09-10T00:00:00.000Z");
    expect(normalizeValue(undefined)).toBeNull();
    expect(normalizeValue(null)).toBeNull();
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(BigInt(7))).toBe(7);
  });
  it("marks relations, arrays and Json blobs as non-scalar so they are skipped", () => {
    expect(normalizeValue({ id: "x" })).toBeUndefined();
    expect(normalizeValue([1, 2])).toBeUndefined();
  });
});

describe("diffFields", () => {
  it("lists only changed fields with before/after values", () => {
    const before = { id: "a", status: "DRAFT", dueDate: null, vatRate: dec(20), notes: "x", updatedAt: new Date() };
    const after = { id: "a", status: "ISSUED", dueDate: new Date("2026-10-01T00:00:00.000Z"), vatRate: dec(20), notes: "x", updatedAt: new Date(Date.now() + 1000) };
    const d = diffFields(before, after);
    expect(d).toEqual({
      status: { from: "DRAFT", to: "ISSUED" },
      dueDate: { from: null, to: "2026-10-01T00:00:00.000Z" },
    });
  });
  it("ignores id/createdAt/updatedAt/companyId and relation objects", () => {
    const d = diffFields(
      { id: "1", companyId: "c", createdAt: new Date(0), lines: [{ id: "l" }], client: { name: "A" }, amount: dec(10) },
      { id: "2", companyId: "d", createdAt: new Date(1), lines: [], client: { name: "B" }, amount: dec(11) },
    );
    expect(Object.keys(d)).toEqual(["amount"]);
  });
  it("treats Decimal and number as the same value when equal", () => {
    expect(diffFields({ rate: dec(50) }, { rate: 50 })).toEqual({});
    expect(diffFields({ rate: dec(50) }, { rate: 50.000000001 })).toEqual({});
    expect(diffFields({ rate: dec(50) }, { rate: 55 })).toEqual({ rate: { from: 50, to: 55 } });
  });
  it("restricts to an allow-list when fields are given", () => {
    const d = diffFields({ status: "A", notes: "x", amount: 1 }, { status: "B", notes: "y", amount: 2 }, ["status", "amount"]);
    expect(Object.keys(d)).toEqual(["status", "amount"]);
  });
  it("a create lists only set values; a delete lists only the values that existed", () => {
    expect(diffFields(null, { name: "M1", salesPrice: dec(100), endDate: null })).toEqual({
      name: { from: null, to: "M1" },
      salesPrice: { from: null, to: 100 },
    });
    expect(diffFields({ name: "M1", endDate: null }, null)).toEqual({ name: { from: "M1", to: null } });
  });
  it("hides foreign keys on create/delete but keeps them on update", () => {
    expect(diffFields(null, { invoiceId: "inv1", description: "Line", amount: 5 })).toEqual({
      description: { from: null, to: "Line" },
      amount: { from: null, to: 5 },
    });
    expect(diffFields({ invoiceId: "inv1", amount: 5 }, null)).toEqual({ amount: { from: 5, to: null } });
    expect(diffFields({ managerId: "a" }, { managerId: "b" })).toEqual({ managerId: { from: "a", to: "b" } });
  });
  it("returns an empty diff when nothing changed", () => {
    expect(diffFields({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual({});
  });
});

describe("isMoneyField / redactDiff", () => {
  it("recognises money by name and leaves hours, dates and ids alone", () => {
    for (const f of ["amount", "salesPrice", "costRate", "billRate", "bankFee", "contractValue", "monthlyAmount", "budgetAmount", "commissionFixed", "discountValue", "cost"]) {
      expect(isMoneyField(f), f).toBe(true);
    }
    for (const f of ["budgetHours", "allocatedHours", "dueDate", "discountType", "currency", "invoiceLineId", "status", "name", "poNumber", "timeEntryOpen", "customerReference"]) {
      expect(isMoneyField(f), f).toBe(false);
    }
  });
  it("hides money values but keeps the fact that they changed, and keeps nulls as nulls", () => {
    const r = redactDiff({
      salesPrice: { from: 100, to: 120 },
      status: { from: "PLANNED", to: "ACTIVE" },
      cost: { from: null, to: 30 },
    });
    expect(r.salesPrice).toEqual({ from: REDACTED, to: REDACTED });
    expect(r.status).toEqual({ from: "PLANNED", to: "ACTIVE" });
    expect(r.cost).toEqual({ from: null, to: REDACTED });
    expect(hasMoneyChange(r)).toBe(true);
    expect(hasMoneyChange({ status: { from: "A", to: "B" } })).toBe(false);
  });
});

describe("summarize", () => {
  it("reads as one line for an update, with dates shortened and a cap on listed fields", () => {
    const s = summarize({
      entityType: "Invoice",
      action: "update",
      label: "INV-0003",
      diff: {
        status: { from: "DRAFT", to: "ISSUED" },
        dueDate: { from: null, to: "2026-10-01T00:00:00.000Z" },
        vatRate: { from: 20, to: 22 },
        notes: { from: "a", to: "b" },
      },
    });
    expect(s).toBe("Invoice INV-0003: status DRAFT → ISSUED, due date — → 2026-10-01, vat rate 20 → 22, +1 more");
  });
  it("describes creates and deletes, appending the note", () => {
    expect(summarize({ entityType: "Salary", action: "create", label: "Ana", diff: { monthlyAmount: { from: null, to: 1500 }, currency: { from: null, to: "EUR" } } }))
      .toBe("Salary Ana created (monthly amount 1500, currency EUR)");
    expect(summarize({ entityType: "InvoicePayment", action: "delete", label: "INV-0003", diff: {}, note: "payment removed" }))
      .toBe("InvoicePayment INV-0003 deleted — payment removed");
  });
  it("the redacted summary never contains the amount", () => {
    const diff = { costRate: { from: 20, to: 25 }, status: { from: "ACTIVE", to: "PAUSED" } };
    const full = summarize({ entityType: "Assignment", action: "update", label: "Indri", diff });
    const hidden = summarize({ entityType: "Assignment", action: "update", label: "Indri", diff: redactDiff(diff) });
    expect(full).toContain("20 → 25");
    expect(hidden).not.toContain("25");
    expect(hidden).toContain(`${REDACTED} → ${REDACTED}`);
    expect(hidden).toContain("ACTIVE → PAUSED");
  });
});

describe("formatting helpers", () => {
  it("formats values for humans", () => {
    expect(formatAuditValue(null)).toBe("—");
    expect(formatAuditValue(true)).toBe("yes");
    expect(formatAuditValue(12.34567)).toBe("12.3457");
    expect(formatAuditValue("2026-09-10T12:00:00.000Z")).toBe("2026-09-10");
    expect(formatAuditValue("x".repeat(50))).toHaveLength(38);
  });
  it("turns camelCase into words", () => {
    expect(fieldLabel("recognitionDate")).toBe("recognition date");
    expect(fieldLabel("status")).toBe("status");
  });
});

describe("fields that point at another record", () => {
  it("are labelled by what they point at, not by their id column", () => {
    expect(fieldLabel("sponsorContactId")).toBe("sponsor");
    expect(fieldLabel("managerId")).toBe("manager");
    expect(fieldLabel("invoiceLineId")).toBe("invoice line");
    expect(fieldLabel("recognitionDate")).toBe("recognition date");
  });
  it("collect their ids by kind and show names instead; a record that's gone reads (deleted)", () => {
    const diff = { sponsorContactId: { from: null, to: "c1" }, managerId: { from: "u1", to: "u2" }, status: { from: "PLANNED", to: "ACTIVE" } };
    const ids = referenceIds([diff]);
    expect([...ids.get("contact")!]).toEqual(["c1"]);
    expect([...ids.get("user")!].sort()).toEqual(["u1", "u2"]);
    const r = resolveReferences(diff, new Map([["c1", "Mario Rossi"], ["u1", "Enida Selita"]]));
    expect(r.sponsorContactId).toEqual({ from: null, to: "Mario Rossi" });
    expect(r.managerId).toEqual({ from: "Enida Selita", to: "(deleted)" });
    expect(r.status).toEqual({ from: "PLANNED", to: "ACTIVE" });
  });
  it("keep a summary's note when it is rebuilt, whichever label style wrote it", () => {
    const input = { entityType: "Project", action: "update", label: "PR-1", diff: { sponsorContactId: { from: null, to: "c1" } } };
    expect(summaryTail("Project PR-1: sponsor contact id — → c1 — set by the PM", input)).toBe(" — set by the PM");
    expect(summaryTail(summarize({ ...input, note: "why" }), input)).toBe(" — why");
    expect(summaryTail(summarize(input), input)).toBe("");
    expect(summaryTail("something else entirely", input)).toBeNull();
  });
});
