import type { InvoiceStatus, InvoiceType } from "@prisma/client";

// Pure invoice math + labels for the register — no Prisma/runtime deps, safe on client & server.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type InvoiceLineAmount = { amount: number };

/** Net = Σ line amounts (a credit note's amounts are negative). VAT = net × rate. Gross = net + VAT. */
export function invoiceTotals(lines: InvoiceLineAmount[], vatRate: number | null | undefined) {
  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vat = vatRate ? round2(net * (vatRate / 100)) : 0;
  return { net, vat, gross: round2(net + vat) };
}

/** Amount still owed = gross − Σ payments (never below 0 for display purposes). */
export function outstanding(gross: number, payments: { amount: number }[]): number {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return round2(gross - paid);
}

// ---------- accounts receivable: aging, overdue, DSO ----------

export type AgingBucket = "CURRENT" | "D1_30" | "D31_60" | "D61_90" | "D90_PLUS" | "NO_DUE_DATE";

export const AGING_BUCKETS: { key: AgingBucket; label: string; short: string }[] = [
  { key: "CURRENT", label: "Not yet due", short: "Current" },
  { key: "D1_30", label: "1–30 days", short: "1–30" },
  { key: "D31_60", label: "31–60 days", short: "31–60" },
  { key: "D61_90", label: "61–90 days", short: "61–90" },
  { key: "D90_PLUS", label: "90+ days", short: "90+" },
  { key: "NO_DUE_DATE", label: "No due date", short: "No due date" },
];

/** Day number for a Date, taken from its local calendar components so two dates stored with
 *  different midnight conventions still compare a whole day apart. */
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
}

/** Whole days past the due date: positive = overdue, 0 ON the due date itself (an invoice due today
 *  is not yet late), negative = days still remaining. Null due date ⇒ null (never guessed). */
export function daysOverdue(dueDate: Date | null | undefined, asOf: Date = new Date()): number | null {
  if (!dueDate) return null;
  return dayNumber(asOf) - dayNumber(dueDate);
}

/** AR aging bucket. Upper edges are inclusive — exactly 30 days late is still 1–30, exactly 90 is
 *  61–90 — so only genuinely older-than-90 work lands in D90_PLUS. A missing due date gets its own
 *  bucket rather than being guessed into CURRENT. */
export function agingBucket(dueDate: Date | null | undefined, asOf: Date = new Date()): AgingBucket {
  const d = daysOverdue(dueDate, asOf);
  if (d === null) return "NO_DUE_DATE";
  if (d <= 0) return "CURRENT";
  if (d <= 30) return "D1_30";
  if (d <= 60) return "D31_60";
  if (d <= 90) return "D61_90";
  return "D90_PLUS";
}

/** Days Sales Outstanding: how many days of revenue are sitting in receivables.
 *  receivables ÷ revenue × days. Zero/negative revenue ⇒ 0 (no division by zero). */
export function dso(revenue: number, receivables: number, days: number): number {
  if (revenue <= 0) return 0;
  return round2((receivables / revenue) * days);
}

/** The due date to age an invoice by: its own `dueDate`, else issue date + the client's payment
 *  terms. Returns null when neither is available — the caller must then bucket it as NO_DUE_DATE
 *  rather than assuming a term. */
export function effectiveDueDate(
  dueDate: Date | null | undefined,
  issueDate: Date,
  paymentTermsDays: number | null | undefined,
): Date | null {
  if (dueDate) return dueDate;
  if (paymentTermsDays == null) return null;
  const d = new Date(issueDate);
  d.setDate(d.getDate() + paymentTermsDays);
  return d;
}

/** An invoice counts toward AR only when it's issued (or reconciled/paid) — never DRAFT or VOID. */
export function countsTowardAR(status: InvoiceStatus): boolean {
  return status === "ISSUED" || status === "RECONCILED" || status === "PAID";
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  RECONCILED: "Reconciled",
  PAID: "Paid",
  VOID: "Void",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, "secondary" | "default" | "outline" | "destructive"> = {
  DRAFT: "secondary",
  ISSUED: "default",
  RECONCILED: "outline",
  PAID: "outline",
  VOID: "destructive",
};

export const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  INVOICE: "Invoice",
  CREDIT_NOTE: "Credit note",
};

// Statuses at which an invoice's revenue is recognized (counts toward the register / revenue report).
export const RECOGNIZED_STATUSES: InvoiceStatus[] = ["ISSUED", "RECONCILED", "PAID"];

export function isRecognized(status: InvoiceStatus): boolean {
  return RECOGNIZED_STATUSES.includes(status);
}
