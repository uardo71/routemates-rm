import type { TaxPaymentStatus } from "@prisma/client";

export const TAX_STATUS_LABEL: Record<TaxPaymentStatus, string> = {
  TO_PAY: "To pay",
  PAID: "Paid",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Tax-period label from UTC-midnight dates: a full single month → "Jul 2026"; anything else a
 *  range. Read with UTC accessors so the calendar month is stable regardless of server timezone. */
export function taxPeriodLabel(start: Date, end: Date | null): string {
  const e = end ?? start;
  if (start.getUTCFullYear() === e.getUTCFullYear() && start.getUTCMonth() === e.getUTCMonth()) {
    return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`;
  }
  return `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()}, ${start.getUTCFullYear()} – ${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
}

export const TAX_DOC_KIND_LABEL: Record<string, string> = {
  TAX_NOTICE: "Tax notice",
  PAYMENT_RECEIPT: "Payment receipt",
  OTHER: "Other",
};
