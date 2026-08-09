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
