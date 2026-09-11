// The change-request lifecycle, as one pure module (no Prisma, no clock). A ticket of the
// `change_request` type moves Evaluation → Development → Unit testing → UAT → Go-live → Closing →
// Closed, one stage at a time, and only once the stage it leaves has produced what it must. Rework
// goes back to any earlier stage with a reason; a change request can be rejected from any open
// stage. There is no SLA: a change request is tracked by its stage, time in stage and next step.
// The stage IS the ticket's status — its TicketStatusDef.key is one of CR_STAGE_KEYS.

import type { GateCheck } from "@/lib/project-stage";

export const CR_TYPE_KEY = "change_request";
export const isChangeRequestType = (typeKey: string | null | undefined): boolean => typeKey === CR_TYPE_KEY;

export const CR_FLOW = ["evaluation", "development", "unit_testing", "uat", "go_live", "closing", "closed"] as const;
export type CrFlowKey = (typeof CR_FLOW)[number];
export type CrStageKey = CrFlowKey | "rejected";
export const CR_STAGE_KEYS: CrStageKey[] = [...CR_FLOW, "rejected"];

export type CrStageDef = { key: CrStageKey; label: string; owner: string; purpose: string; steps: string[] };

/** The process: what each stage is for, who drives it, and the next steps that get it done. */
export const CR_STAGES: Record<CrStageKey, CrStageDef> = {
  evaluation: {
    key: "evaluation", label: "Evaluation", owner: "Consultant / PM",
    purpose: "Understand the change, size it and get the customer's go-ahead before anyone builds.",
    steps: [
      "Clarify the requirement with the requester (a call or a written spec)",
      "Write the impact assessment and the proposed solution",
      "Estimate the effort in hours and send the quote",
      "Get the customer's written approval: who, when, PO or e-mail reference",
    ],
  },
  development: {
    key: "development", label: "Development", owner: "Developer",
    purpose: "Build the approved change in the development system.",
    steps: [
      "Assign the ticket to the developer",
      "Agree the planned go-live date with the customer",
      "Build it and record the transports / release",
      "Log the time spent on the ticket",
    ],
  },
  unit_testing: {
    key: "unit_testing", label: "Unit testing", owner: "Developer / consultant",
    purpose: "Prove the change works before the customer sees it.",
    steps: [
      "Test every scenario in the development / QA system",
      "Record the results and attach the evidence (screenshots, test log)",
      "Anything failing goes back to Development",
    ],
  },
  uat: {
    key: "uat", label: "UAT", owner: "Customer, supported by the consultant",
    purpose: "The customer tests in their QA system and signs it off.",
    steps: [
      "Send the customer the test instructions",
      "Support their testing; defects go back to Development with a reason",
      "Get the UAT sign-off in writing and attach it",
    ],
  },
  go_live: {
    key: "go_live", label: "Go-live", owner: "Consultant / basis",
    purpose: "Move the change to production in the agreed slot.",
    steps: [
      "Confirm the go-live slot with the customer",
      "Import the transports into production",
      "Record the actual go-live date and smoke-test in production",
    ],
  },
  closing: {
    key: "closing", label: "Closing", owner: "PM",
    purpose: "Hypercare and wrap-up.",
    steps: [
      "Watch the change in production for issues",
      "Write the closing summary in Resolution",
      "Check all time is logged and flag anything billable",
    ],
  },
  closed: {
    key: "closed", label: "Closed", owner: "—",
    purpose: "Delivered and closed. Reopen it into Closing if something comes back.",
    steps: [],
  },
  rejected: {
    key: "rejected", label: "Rejected", owner: "—",
    purpose: "Not going ahead — the reason is in the stage history. Reopen it into Evaluation if it comes back.",
    steps: [],
  },
};

export function asCrStage(statusKey: string | null | undefined): CrStageKey | null {
  return statusKey && (CR_STAGE_KEYS as string[]).includes(statusKey) ? (statusKey as CrStageKey) : null;
}
export const isCrTerminal = (k: CrStageKey): boolean => k === "closed" || k === "rejected";
const flowIndex = (k: CrStageKey): number => (CR_FLOW as readonly string[]).indexOf(k);

/** The stage after this one, or null at the end (and for Rejected). */
export function nextStage(from: CrStageKey): CrFlowKey | null {
  const i = flowIndex(from);
  return i < 0 || i >= CR_FLOW.length - 1 ? null : CR_FLOW[i + 1];
}

// ---------- moves ----------

export type CrMoveKind = "FORWARD" | "BACK" | "REJECT" | "REOPEN";

/** Is `from -> to` a legal move? Forward one stage at a time; back to any earlier stage; reject from
 *  any open stage; reopen Closed into Closing and Rejected into Evaluation. */
export function crMoveKind(from: CrStageKey, to: CrStageKey): { ok: true; kind: CrMoveKind } | { ok: false; reason: string } {
  const L = (k: CrStageKey) => CR_STAGES[k].label;
  if (from === to) return { ok: false, reason: `The change request is already in ${L(to)}.` };
  if (from === "closed") return to === "closing" ? { ok: true, kind: "REOPEN" } : { ok: false, reason: "A closed change request can only be reopened into Closing." };
  if (from === "rejected") return to === "evaluation" ? { ok: true, kind: "REOPEN" } : { ok: false, reason: "A rejected change request can only be reopened into Evaluation." };
  if (to === "rejected") return { ok: true, kind: "REJECT" };
  const i = flowIndex(from), j = flowIndex(to);
  if (j === i + 1) return { ok: true, kind: "FORWARD" };
  if (j < i) return { ok: true, kind: "BACK" };
  return { ok: false, reason: `A change request moves one stage at a time — the next stage is ${L(nextStage(from)!)}.` };
}

// ---------- exit checks (what a stage must produce before the next one starts) ----------

export type CrRecord = {
  assessment: string | null;
  estimateHours: number | null;
  approvedByName: string | null;
  approvedOn: string | null;
  assigneeId: string | null;
  plannedGoLive: string | null;
  unitTestNotes: string | null;
  /** Attachments filed under each stage. */
  evidence: Partial<Record<CrStageKey, number>>;
  uatSignedOffBy: string | null;
  uatSignedOffOn: string | null;
  goLiveOn: string | null;
  /** The ticket's Resolution — the closing summary. */
  resolution: string | null;
};

const filled = (s: string | null | undefined) => !!s?.trim();

export function exitChecks(stage: CrStageKey, r: CrRecord): GateCheck[] {
  switch (stage) {
    case "evaluation": return [
      { key: "assessment", label: "Impact assessment written", ok: filled(r.assessment), hint: "Write the impact assessment and proposed solution in the Evaluation section." },
      { key: "estimate", label: "Effort estimated", ok: (r.estimateHours ?? 0) > 0, hint: "Enter the estimated effort in hours." },
      { key: "approval", label: "Customer approval recorded", ok: filled(r.approvedByName) && !!r.approvedOn, hint: "Record who approved it at the customer and on which date." },
    ];
    case "development": return [
      { key: "developer", label: "Developer assigned", ok: !!r.assigneeId, hint: "Assign the ticket to the developer building it." },
      { key: "plannedGoLive", label: "Planned go-live date agreed", ok: !!r.plannedGoLive, hint: "Set the planned go-live date in the Development section." },
    ];
    case "unit_testing": return [
      { key: "unitTest", label: "Unit test results recorded", ok: filled(r.unitTestNotes) || (r.evidence.unit_testing ?? 0) > 0, hint: "Write the unit test results, or attach the evidence under Unit testing." },
    ];
    case "uat": return [
      { key: "uatSignOff", label: "UAT signed off by the customer", ok: filled(r.uatSignedOffBy) && !!r.uatSignedOffOn, hint: "Record who signed off UAT at the customer and when — and attach the sign-off." },
    ];
    case "go_live": return [
      { key: "goLive", label: "Go-live date recorded", ok: !!r.goLiveOn, hint: "Enter the actual go-live date." },
    ];
    case "closing": return [
      { key: "closingSummary", label: "Closing summary written", ok: filled(r.resolution), hint: "Write the closing summary in Resolution." },
    ];
    default: return [];
  }
}

export type CrMoveInput = {
  from: CrStageKey;
  to: CrStageKey;
  record: CrRecord;
  /** On the client's support team (canManageClientTickets). */
  canManage: boolean;
  /** Requester, assignee or creator of the ticket. */
  involved: boolean;
  note?: string | null;
  overrideReason?: string | null;
};
export type CrMoveDecision =
  | { ok: true; kind: CrMoveKind; overridden: boolean; failing: GateCheck[] }
  | { ok: false; error: string; failing: GateCheck[] };

/** The verdict on one move. Forward needs the stage's checks green — or the support team's written
 *  override. Going back, rejecting and reopening each need a reason; rejecting and reopening are the
 *  support team's call. */
export function decideCrMove(i: CrMoveInput): CrMoveDecision {
  const legal = crMoveKind(i.from, i.to);
  if (!legal.ok) return { ok: false, error: legal.reason, failing: [] };
  if (!i.canManage && !i.involved) return { ok: false, error: "Only the client's support team or the people on this ticket can move it.", failing: [] };
  const note = i.note?.trim() ?? "";
  const to = CR_STAGES[i.to].label;
  switch (legal.kind) {
    case "BACK":
      if (note.length < 3) return { ok: false, error: `Say why it goes back to ${to}.`, failing: [] };
      return { ok: true, kind: "BACK", overridden: false, failing: [] };
    case "REJECT":
    case "REOPEN":
      if (!i.canManage) return { ok: false, error: `Only the client's support team can ${legal.kind === "REJECT" ? "reject" : "reopen"} a change request.`, failing: [] };
      if (note.length < 3) return { ok: false, error: legal.kind === "REJECT" ? "Say why it's rejected." : "Say why it's reopened.", failing: [] };
      return { ok: true, kind: legal.kind, overridden: false, failing: [] };
    case "FORWARD": {
      const failing = exitChecks(i.from, i.record).filter((c) => !c.ok);
      if (failing.length === 0) return { ok: true, kind: "FORWARD", overridden: false, failing };
      const list = failing.map((c) => c.label).join("; ");
      if (!i.overrideReason?.trim()) return { ok: false, error: `${failing.length} check${failing.length === 1 ? "" : "s"} not met: ${list}.`, failing };
      if (!i.canManage) return { ok: false, error: `Only the client's support team can go ahead with checks not met (${list}).`, failing };
      return { ok: true, kind: "FORWARD", overridden: true, failing };
    }
  }
}

// ---------- time in stage and the next step ----------

/** Milliseconds spent in each stage, summed over every visit (rework can revisit a stage). The open
 *  stage counts up to `nowIso`; Closed and Rejected are end states and don't count. */
export function timeInStages(events: { toKey: string; at: string }[], nowIso: string): Record<string, number> {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const out: Record<string, number> = {};
  sorted.forEach((e, idx) => {
    const k = asCrStage(e.toKey);
    if (!k || isCrTerminal(k)) return;
    const end = idx + 1 < sorted.length ? sorted[idx + 1].at : nowIso;
    const ms = Math.max(0, new Date(end).getTime() - new Date(e.at).getTime());
    out[k] = (out[k] ?? 0) + ms;
  });
  return out;
}

export function formatDuration(ms: number): string {
  if (ms < 3_600_000) return "<1h";
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

/** Said when someone tries to set a change request's status directly (status menu, board, portal). */
export const CR_MOVE_ONLY = "A change request moves through its stages from the Lifecycle panel on the ticket, where each stage's checks apply.";

// ---------- the editable record, as the ticket page holds it ----------

/** Every field as text, as the form holds it (dates yyyy-MM-dd, hours as typed). */
export type CrDraft = {
  assessment: string; estimateHours: string; quoteReference: string;
  approvedByName: string; approvedOn: string; approvalReference: string;
  plannedGoLive: string; buildReference: string;
  unitTestNotes: string; unitTestedOn: string;
  uatSignedOffBy: string; uatSignedOffOn: string; uatNotes: string;
  goLiveOn: string;
  nextStep: string; nextStepOwnerId: string; nextStepDue: string;
};
export const EMPTY_CR_DRAFT: CrDraft = {
  assessment: "", estimateHours: "", quoteReference: "", approvedByName: "", approvedOn: "", approvalReference: "",
  plannedGoLive: "", buildReference: "", unitTestNotes: "", unitTestedOn: "", uatSignedOffBy: "", uatSignedOffOn: "",
  uatNotes: "", goLiveOn: "", nextStep: "", nextStepOwnerId: "", nextStepDue: "",
};

/** Hours as typed ("12", "7,5"): null when blank, NaN when not a number. */
export function parseHours(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function crRecordFromDraft(
  d: CrDraft, x: { assigneeId: string | null; resolution: string | null; evidence: Partial<Record<CrStageKey, number>> },
): CrRecord {
  const h = parseHours(d.estimateHours);
  const or = (s: string) => s.trim() || null;
  return {
    assessment: or(d.assessment), estimateHours: h !== null && Number.isFinite(h) ? h : null,
    approvedByName: or(d.approvedByName), approvedOn: or(d.approvedOn), assigneeId: x.assigneeId,
    plannedGoLive: or(d.plannedGoLive), unitTestNotes: or(d.unitTestNotes), evidence: x.evidence,
    uatSignedOffBy: or(d.uatSignedOffBy), uatSignedOffOn: or(d.uatSignedOffOn), goLiveOn: or(d.goLiveOn),
    resolution: x.resolution,
  };
}

export type NextStepState = "none" | "upcoming" | "today" | "overdue";
/** Dates are yyyy-MM-dd. */
export function nextStepState(dueIso: string | null, todayIso: string): NextStepState {
  if (!dueIso) return "none";
  if (dueIso < todayIso) return "overdue";
  return dueIso === todayIso ? "today" : "upcoming";
}
