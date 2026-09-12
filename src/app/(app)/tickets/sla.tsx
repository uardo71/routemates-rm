"use client";

import { cn } from "@/lib/utils";
import { SLA_BADGE_LABEL, slaBadgeState, type SlaBadgeKind, type SlaBadgeState } from "@/lib/sla";

// SlaBadge — the one SLA chip every screen draws (header, list, board).
//
// Four states and no more: On track · At risk · Breached · No SLA. The verdict itself now lives in
// the pure `@/lib/sla`, because the SERVER needs the same answer (the actions register asks whether
// a ticket is urgent). This file keeps the drawing and re-exports the verdict, so every screen that
// already imported it from here is unaffected.

export { SLA_AT_RISK_MS, SLA_BADGE_LABEL, slaBadgeState } from "@/lib/sla";
export type { SlaBadgeKind, SlaBadgeState, SlaClock } from "@/lib/sla";

const SLA_BADGE_TONE: Record<SlaBadgeKind, string> = {
  on_track: "bg-success-soft text-success",
  at_risk: "bg-warning-soft text-warning",
  breached: "bg-danger-soft text-destructive",
  none: "bg-muted text-muted-foreground",
};

export function SlaBadge({ state, showNone = false, detail = true, className }: {
  state: SlaBadgeState;
  /** Draw the "No SLA" state too. Off by default: every screen that shows SLA today draws nothing
   *  for a ticket without one, and this component doesn't change that on its own. */
  showNone?: boolean;
  /** Drop the clock and keep the words — for tight places like a board card. */
  detail?: boolean;
  className?: string;
}) {
  if (!state.show && !(showNone && state.kind === "none")) return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", SLA_BADGE_TONE[state.kind], className)}
      title={state.detail || undefined}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", state.kind === "none" ? "bg-muted-foreground/70" : "bg-current")} />
      {state.label}
      {detail && state.detail && <span className="font-normal opacity-80">· {state.detail}</span>}
    </span>
  );
}

/** The same chip from a bare verdict — for lists that carry the kind and label but not a ticket row. */
export function SlaKindBadge({ kind, label, detail, className }: { kind: SlaBadgeKind; label?: string; detail?: string; className?: string }) {
  return (
    <SlaBadge
      state={{ kind, show: kind !== "none", label: label ?? SLA_BADGE_LABEL[kind], detail: detail ?? "" }}
      showNone
      className={className}
    />
  );
}

// Kept so `slaBadgeState` stays reachable from this module's own consumers without a second import.
export const slaVerdict = slaBadgeState;
