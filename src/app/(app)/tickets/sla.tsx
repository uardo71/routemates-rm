"use client";

import { cn } from "@/lib/utils";
import { isOpenCategory } from "@/lib/ticket-config";
import type { TicketRow } from "./serialize";

function rel(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 24) return `in ${Math.max(1, h)}h`;
  return `in ${Math.round(h / 24)}d`;
}

// ---------------------------------------------------------------------------------------------
// SlaBadge — the one SLA chip every screen draws (header, list, board).
//
// Four states and no more: On track · At risk · Breached · No SLA. The numbers behind them are the
// ticket's own stored respondBy/resolveBy, which sla.server.ts wrote from the resolved policy
// (client override > company policy > built-in default) — this component resolves nothing itself.
// ---------------------------------------------------------------------------------------------

/** How close to a target counts as "at risk" — the threshold the amber pill already used. */
export const SLA_AT_RISK_MS = 4 * 3_600_000;

export type SlaBadgeKind = "on_track" | "at_risk" | "breached" | "none";

export type SlaBadgeState = {
  kind: SlaBadgeKind;
  /** False wherever the app draws nothing today: a type with no SLA, a clock that has stopped
   *  (resolved/cancelled), or a ticket carrying no target at all. `kind` still says which. */
  show: boolean;
  /** "On track" · "At risk" · "Breached" · "No SLA". */
  label: string;
  /** The clock in words — "respond in 3h", "resolve overdue by 2h". Empty when there is no clock. */
  detail: string;
};

const SLA_BADGE_LABEL: Record<SlaBadgeKind, string> = {
  on_track: "On track",
  at_risk: "At risk",
  breached: "Breached",
  none: "No SLA",
};

const NO_SLA: SlaBadgeState = { kind: "none", show: false, label: SLA_BADGE_LABEL.none, detail: "" };

function overdueBy(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `overdue by ${Math.max(1, h)}h` : `overdue by ${Math.round(h / 24)}d`;
}

/** Which of the four states a ticket is in. `now` is injectable so the boundaries can be tested. */
export function slaBadgeState(
  r: Pick<TicketRow, "statusCategory" | "firstResponseAt" | "respondBy" | "resolveBy" | "slaApplicable">,
  now: number = Date.now(),
): SlaBadgeState {
  if (!r.slaApplicable) return NO_SLA;
  // The clock stops when the ticket leaves an open status; a closed ticket is not "on track".
  if (!isOpenCategory(r.statusCategory)) return NO_SLA;
  const responded = !!r.firstResponseAt;
  const targetIso = responded ? r.resolveBy : r.respondBy;
  if (!targetIso) return NO_SLA;

  const kind = responded ? "resolve" : "respond";
  const left = new Date(targetIso).getTime() - now;
  if (left <= 0) return { kind: "breached", show: true, label: SLA_BADGE_LABEL.breached, detail: `${kind} ${overdueBy(-left)}` };
  const at = left < SLA_AT_RISK_MS ? "at_risk" : "on_track";
  return { kind: at, show: true, label: SLA_BADGE_LABEL[at], detail: `${kind} ${rel(left)}` };
}

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
