import type { OpportunityStage, DiscountType } from "@prisma/client";

// Shared, pure helpers for the Opportunities module — safe to import from both server actions and
// client components (no Prisma/runtime deps, just number math and label maps).

export type QuoteLine = { quantityHours: number; unitPrice: number };
export type QuoteTotals = { gross: number; discountAmount: number; net: number };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The money taken off the list total for a given deal-level discount. ABSOLUTE is capped at the
 *  gross (you can't discount below zero); PERCENT is value% of gross. Returns 0 when no discount. */
export function computeDiscountAmount(
  gross: number,
  type: DiscountType | null | undefined,
  value: number | null | undefined,
): number {
  if (!type || value == null || value <= 0) return 0;
  if (type === "PERCENT") return round2(gross * (Math.min(value, 100) / 100));
  return round2(Math.min(gross, value)); // ABSOLUTE
}

/** gross = Σ(hours × list unit price); net = gross − discount. All rounded to 2dp. */
export function computeQuoteTotals(
  lines: QuoteLine[],
  type: DiscountType | null | undefined,
  value: number | null | undefined,
): QuoteTotals {
  const gross = round2(lines.reduce((sum, l) => sum + l.quantityHours * l.unitPrice, 0));
  const discountAmount = computeDiscountAmount(gross, type, value);
  return { gross, discountAmount, net: round2(gross - discountAmount) };
}

// Human labels for the pipeline stages.
export const STAGE_LABELS: Record<OpportunityStage, string> = {
  QUALIFYING: "Qualifying",
  PROPOSAL_SENT: "Proposal sent",
  NEGOTIATION: "Negotiation",
  PENDING_APPROVAL: "Pending approval",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
};

// Stages where the deal is still being actively worked (editable lines, movable stage).
export const OPEN_STAGES: OpportunityStage[] = ["QUALIFYING", "PROPOSAL_SENT", "NEGOTIATION"];
// Terminal stages — no further pipeline movement.
export const TERMINAL_STAGES: OpportunityStage[] = ["WON", "LOST", "CANCELLED"];

export function isOpenStage(stage: OpportunityStage): boolean {
  return OPEN_STAGES.includes(stage);
}

// Order used to render the pipeline board / group the list.
export const PIPELINE_ORDER: OpportunityStage[] = [
  "QUALIFYING",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "PENDING_APPROVAL",
  "WON",
  "LOST",
  "CANCELLED",
];

// Badge tone per stage, reusing the app's semantic tokens (see components/ui/badge.tsx variants).
export const STAGE_TONE: Record<OpportunityStage, "default" | "secondary" | "outline" | "destructive"> = {
  QUALIFYING: "outline",
  PROPOSAL_SENT: "secondary",
  NEGOTIATION: "secondary",
  PENDING_APPROVAL: "default",
  WON: "default",
  LOST: "destructive",
  CANCELLED: "outline",
};

// The "expiring soon" alert (src/lib/alerts) has told a deal's owner and PM by email for a while,
// but the opportunity's own detail page never showed the same signal — poValidUntil sat there as a
// plain date, not a warning, even minutes before (or after) the alert fired. Same 30-day window as
// the alert's default, kept independent on purpose: this is a UI hint, not something an admin's
// alert-threshold change should silently move.
export type PoValidityState = "none" | "expired" | "expiring" | "ok";
const PO_WARNING_WINDOW_DAYS = 30;

export function poValidityState(poValidUntilIso: string | null, todayIso: string): PoValidityState {
  if (!poValidUntilIso) return "none";
  if (poValidUntilIso < todayIso) return "expired";
  const days = (Date.parse(poValidUntilIso) - Date.parse(todayIso)) / 86_400_000;
  return days <= PO_WARNING_WINDOW_DAYS ? "expiring" : "ok";
}
