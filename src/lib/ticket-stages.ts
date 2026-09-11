// The generic stage lifecycle, as one pure module (no Prisma, no clock, no React).
//
// A STAGE-mode ticket type (TicketTypeDef.lifecycleMode = STAGE) replaces its status list with an
// ordered list of stages (TicketStageDef). Each stage carries gates (TicketStageGate) — the things
// that must be true before the ticket leaves it — which someone ticks by hand (TicketGateCheck).
// A ticket moves one stage at a time; it can be sent back to any earlier stage with a reason, closed
// early into a terminal stage with a reason, and reopened once terminal.
//
// This is the DB-driven sibling of src/lib/change-request.ts, whose stages, gates and checks are
// hard-coded because a change request's checks read its record rather than a manual tick. The two
// share the presentation layer (tickets/[id]/stage-lifecycle.tsx), not their rules.

import type { GateCheck } from "@/lib/project-stage";

export type StageGateDef = { key: string; label: string; description: string | null };
export type StageDef = {
  key: string; name: string; description: string | null;
  order: number; isStarting: boolean; isTerminal: boolean;
  gates: StageGateDef[];
};

/** Stage order is the flow. `order` ties are broken by key so the sequence is never ambiguous. */
export function sortStages(stages: StageDef[]): StageDef[] {
  return [...stages].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}
export function stageByKey(stages: StageDef[], key: string | null | undefined): StageDef | null {
  return (key && stages.find((s) => s.key === key)) || null;
}
/** Where a new ticket of this type starts. */
export function startingStage(stages: StageDef[]): StageDef | null {
  const sorted = sortStages(stages);
  return sorted.find((s) => s.isStarting) ?? sorted[0] ?? null;
}
export function stageIndex(stages: StageDef[], key: string): number {
  return sortStages(stages).findIndex((s) => s.key === key);
}
/** The stage after this one, or null at the end. */
export function nextStage(stages: StageDef[], fromKey: string): StageDef | null {
  const sorted = sortStages(stages);
  const i = sorted.findIndex((s) => s.key === fromKey);
  return i < 0 || i >= sorted.length - 1 ? null : sorted[i + 1];
}
/** Every stage before this one — where "Send back" may go. */
export function earlierStages(stages: StageDef[], fromKey: string): StageDef[] {
  const sorted = sortStages(stages);
  const i = sorted.findIndex((s) => s.key === fromKey);
  return i <= 0 ? [] : sorted.slice(0, i);
}
/** Closing early: the terminal stage a ticket can be dropped into from anywhere. Null when the only
 *  terminal stage is already the next one (then closing IS the gated forward move, not an escape). */
export function closeTarget(stages: StageDef[], fromKey: string): StageDef | null {
  const from = stageByKey(stages, fromKey);
  if (!from || from.isTerminal) return null;
  const next = nextStage(stages, fromKey);
  const terminal = sortStages(stages).find((s) => s.isTerminal);
  if (!terminal || terminal.key === next?.key) return null;
  return terminal;
}
/** Reopening a terminal stage lands on the last open stage before it. */
export function reopenTarget(stages: StageDef[], fromKey: string): StageDef | null {
  const from = stageByKey(stages, fromKey);
  if (!from || !from.isTerminal) return null;
  const earlier = earlierStages(stages, fromKey).filter((s) => !s.isTerminal);
  return earlier[earlier.length - 1] ?? null;
}

// ---------- moves ----------

export type StageMoveKind = "FORWARD" | "BACK" | "CLOSE" | "REOPEN";

/** Is `from -> to` a legal move? Forward one stage at a time; back to any earlier stage; into a
 *  terminal stage from any open one; reopen a terminal stage into the last open stage before it. */
export function stageMoveKind(
  stages: StageDef[], fromKey: string, toKey: string,
): { ok: true; kind: StageMoveKind } | { ok: false; reason: string } {
  const from = stageByKey(stages, fromKey);
  const to = stageByKey(stages, toKey);
  if (!from) return { ok: false, reason: "This ticket isn't on one of the type's stages." };
  if (!to) return { ok: false, reason: "Unknown stage." };
  if (from.key === to.key) return { ok: false, reason: `The ticket is already in ${to.name}.` };
  if (from.isTerminal) {
    const target = reopenTarget(stages, from.key);
    if (target && target.key === to.key) return { ok: true, kind: "REOPEN" };
    return {
      ok: false,
      reason: target
        ? `A ${from.name.toLowerCase()} ticket can only be reopened into ${target.name}.`
        : `A ${from.name.toLowerCase()} ticket has no stage to reopen into.`,
    };
  }
  const sorted = sortStages(stages);
  const i = sorted.findIndex((s) => s.key === from.key);
  const j = sorted.findIndex((s) => s.key === to.key);
  if (j === i + 1) return { ok: true, kind: "FORWARD" };
  if (to.isTerminal) return { ok: true, kind: "CLOSE" };
  if (j < i) return { ok: true, kind: "BACK" };
  return { ok: false, reason: `A ticket moves one stage at a time — the next stage is ${sorted[i + 1].name}.` };
}

// ---------- gates ----------

/** A stage's gates as checks, green where someone has ticked them. */
export function gateChecks(stage: StageDef | null, ticked: Iterable<string>): GateCheck[] {
  if (!stage) return [];
  const set = new Set(ticked);
  return stage.gates.map((g) => ({
    key: g.key,
    label: g.label,
    ok: set.has(g.key),
    hint: g.description?.trim() || "Tick this once it's done.",
  }));
}

export type StageMoveInput = {
  stages: StageDef[];
  from: string;
  to: string;
  /** Gate keys ticked on the stage being left. */
  ticked: Iterable<string>;
  /** On the client's support team (canManageClientTickets). */
  canManage: boolean;
  /** Requester, assignee or creator of the ticket. */
  involved: boolean;
  note?: string | null;
  overrideReason?: string | null;
};
export type StageMoveDecision =
  | { ok: true; kind: StageMoveKind; overridden: boolean; failing: GateCheck[] }
  | { ok: false; error: string; failing: GateCheck[] };

/** The verdict on one move. Forward needs the stage's gates ticked — or the support team's written
 *  override. Going back, closing early and reopening each need a reason; closing early and reopening
 *  are the support team's call. Mirrors decideCrMove deliberately: one lifecycle, two rule sources. */
export function decideStageMove(i: StageMoveInput): StageMoveDecision {
  const legal = stageMoveKind(i.stages, i.from, i.to);
  if (!legal.ok) return { ok: false, error: legal.reason, failing: [] };
  if (!i.canManage && !i.involved) return { ok: false, error: "Only the client's support team or the people on this ticket can move it.", failing: [] };
  const note = i.note?.trim() ?? "";
  const to = stageByKey(i.stages, i.to)!;
  switch (legal.kind) {
    case "BACK":
      if (note.length < 3) return { ok: false, error: `Say why it goes back to ${to.name}.`, failing: [] };
      return { ok: true, kind: "BACK", overridden: false, failing: [] };
    case "CLOSE":
    case "REOPEN": {
      const verb = legal.kind === "CLOSE" ? "close" : "reopen";
      if (!i.canManage) return { ok: false, error: `Only the client's support team can ${verb} a ticket from here.`, failing: [] };
      if (note.length < 3) return { ok: false, error: legal.kind === "CLOSE" ? `Say why it goes straight to ${to.name}.` : "Say why it's reopened.", failing: [] };
      return { ok: true, kind: legal.kind, overridden: false, failing: [] };
    }
    case "FORWARD": {
      const failing = gateChecks(stageByKey(i.stages, i.from), i.ticked).filter((c) => !c.ok);
      if (failing.length === 0) return { ok: true, kind: "FORWARD", overridden: false, failing };
      const list = failing.map((c) => c.label).join("; ");
      if (!i.overrideReason?.trim()) return { ok: false, error: `${failing.length} check${failing.length === 1 ? "" : "s"} not met: ${list}.`, failing };
      if (!i.canManage) return { ok: false, error: `Only the client's support team can go ahead with checks not met (${list}).`, failing };
      return { ok: true, kind: "FORWARD", overridden: true, failing };
    }
  }
}

// ---------- time in stage ----------

/** Milliseconds spent in each stage, summed over every visit (rework can revisit a stage). The open
 *  stage counts up to `nowIso`; a terminal stage is an end state and doesn't count. */
export function stageTimes(
  stages: StageDef[], events: { toKey: string; at: string }[], nowIso: string,
): Record<string, number> {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const out: Record<string, number> = {};
  sorted.forEach((e, idx) => {
    const s = stageByKey(stages, e.toKey);
    if (!s || s.isTerminal) return;
    const end = idx + 1 < sorted.length ? sorted[idx + 1].at : nowIso;
    const ms = Math.max(0, new Date(end).getTime() - new Date(e.at).getTime());
    out[s.key] = (out[s.key] ?? 0) + ms;
  });
  return out;
}

/** Said when someone tries to set a STAGE-mode ticket's status directly (status menu, board, portal). */
export const STAGE_MOVE_ONLY =
  "This ticket type moves through its stages from the Lifecycle panel on the ticket, where each stage's checks apply.";
