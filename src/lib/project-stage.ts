// The project lifecycle, as one pure module (no Prisma, no clock): which status changes are legal,
// what blocks time and invoices, and the two gates — Prepare for Delivery (PLANNED -> ACTIVE) and
// closure (-> COMPLETED). `ProjectStatus` IS the state machine; there is no second "stage" field.

import { daysBetweenIso } from "@/lib/delivery-signals";

export type ProjectStatusKey = "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export const PROJECT_STATUSES: ProjectStatusKey[] = ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];
export const PROJECT_STATUS_LABEL: Record<ProjectStatusKey, string> = {
  PLANNED: "Planned", ACTIVE: "Active", ON_HOLD: "On hold", COMPLETED: "Completed", CANCELLED: "Cancelled",
};
const label = (s: string) => PROJECT_STATUS_LABEL[s as ProjectStatusKey] ?? s;

// ---------- transitions ----------

export type TransitionRule = { to: ProjectStatusKey; label: string; adminOnly?: boolean; gate?: "readiness" | "closure" };

export const TRANSITIONS: Record<ProjectStatusKey, TransitionRule[]> = {
  PLANNED: [{ to: "ACTIVE", label: "Start delivery", gate: "readiness" }, { to: "CANCELLED", label: "Cancel project" }],
  ACTIVE: [{ to: "ON_HOLD", label: "Put on hold" }, { to: "COMPLETED", label: "Close project", gate: "closure" }, { to: "CANCELLED", label: "Cancel project" }],
  ON_HOLD: [{ to: "ACTIVE", label: "Reactivate" }, { to: "CANCELLED", label: "Cancel project" }],
  COMPLETED: [{ to: "ACTIVE", label: "Reopen", adminOnly: true }],
  CANCELLED: [{ to: "PLANNED", label: "Reopen as planned", adminOnly: true }],
};

/** Is `from -> to` a legal move for this user? Reopening (COMPLETED -> ACTIVE, CANCELLED -> PLANNED) is admin-only. */
export function checkTransition(from: string, to: string, opts: { isAdmin: boolean }): { ok: true; rule: TransitionRule } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: `The project is already ${label(to)}.` };
  const rule = (TRANSITIONS[from as ProjectStatusKey] ?? []).find((r) => r.to === to);
  if (!rule) return { ok: false, reason: `A project can't go from ${label(from)} to ${label(to)}.` };
  if (rule.adminOnly && !opts.isAdmin) return { ok: false, reason: "Only an administrator can reopen a project." };
  return { ok: true, rule };
}

/** The moves this user can offer from `from`, in display order. */
export function allowedTransitions(from: string, isAdmin: boolean): TransitionRule[] {
  return (TRANSITIONS[from as ProjectStatusKey] ?? []).filter((r) => !r.adminOnly || isAdmin);
}

// ---------- the entry gate (time, submissions, invoices) ----------

export type GateProject = { name: string; status: string; isInternal: boolean };

/** Why this project can't take new time right now, or null when it can. Only ACTIVE projects take
 *  time; internal projects (vacation tracking and the like) are exempt entirely, because leave
 *  approval provisions pre-approved time on them whatever their status. */
export function entryBlock(p: GateProject, doing: "logging time" | "submitting time" = "logging time"): string | null {
  if (p.isInternal || p.status === "ACTIVE") return null;
  switch (p.status) {
    case "PLANNED": return `${p.name} is Planned — delivery hasn't started; ask the PM to start it before ${doing}.`;
    case "ON_HOLD": return `${p.name} is On hold — ask the PM to reactivate it before ${doing}.`;
    case "COMPLETED": return `${p.name} is Completed — it's closed for new time; an administrator can reopen it if work continues.`;
    case "CANCELLED": return `${p.name} is Cancelled — no new time can be recorded against it.`;
    default: return `${p.name} is ${label(p.status)} — it doesn't take new time.`;
  }
}

export type EntryChange = GateProject & { beforeHours: number; afterHours: number; alreadyApproved: boolean };

/** The gate applied to one time cell. It judges NEW writes only: approved time is never re-validated
 *  (the project may have closed after it was approved), and a cell whose hours don't change is
 *  left alone — so an old draft line on a paused project can't stop someone saving the rest of the week. */
export function entryChangeBlock(c: EntryChange): string | null {
  if (c.alreadyApproved) return null;
  if (Math.abs(c.afterHours - c.beforeHours) < 0.005) return null;
  if (Math.abs(c.afterHours) < 0.005) return null; // clearing a draft cell only removes hours
  return entryBlock(c);
}

/** Invoicing a project that hasn't started, or was cancelled, is refused. ON_HOLD and COMPLETED still
 *  invoice — billing often runs after delivery ends. */
export function invoiceBlock(p: { name: string; status: string }): string | null {
  if (p.status === "PLANNED") return `${p.name} is Planned — start delivery before invoicing it.`;
  if (p.status === "CANCELLED") return `${p.name} is Cancelled — it can't be invoiced.`;
  return null;
}

// ---------- gates ----------

export type GateCheck = { key: string; label: string; ok: boolean; hint: string };

export type ReadinessInput = {
  managerId: string | null;
  startDate: string | null;
  endDate: string | null;
  milestoneCount: number;
  assignmentCount: number;
  billingType: string | null;
  contractValue: number | null;
  budgetAmount: number | null;
  sponsorContactId: string | null;
  sowNumber: string | null;
  poNumber: string | null;
  poWaived: boolean;
};

/** Prepare for Delivery: everything computed from data already in the app, never hand-ticked. */
export function readinessChecks(p: ReadinessInput): GateCheck[] {
  const missingDates = [!p.startDate && "start", !p.endDate && "end"].filter(Boolean).join(" and ");
  const value = (p.contractValue ?? 0) > 0 || (p.budgetAmount ?? 0) > 0;
  return [
    { key: "manager", label: "Project manager set", ok: !!p.managerId, hint: "Pick the project manager on Edit project." },
    { key: "dates", label: "Start and end dates set", ok: !!p.startDate && !!p.endDate, hint: `Set the ${missingDates || "start and end"} date on Edit project.` },
    { key: "milestones", label: "At least one milestone", ok: p.milestoneCount > 0, hint: "Add a milestone on the Milestones tab." },
    { key: "assignments", label: "At least one person assigned", ok: p.assignmentCount > 0, hint: "Assign someone to a milestone." },
    { key: "commercials", label: "Billing type and contract value", ok: !!p.billingType && value, hint: !p.billingType ? "Set the billing type on Edit project." : "Set the contract value or budget amount on Edit project." },
    { key: "sponsor", label: "Client sponsor named", ok: !!p.sponsorContactId, hint: "Choose the sponsor from the client's contacts on Edit project (add the contact on the client first if needed)." },
    { key: "sow", label: "SoW number recorded", ok: !!p.sowNumber?.trim(), hint: "Enter the signed SoW number on Edit project." },
    { key: "po", label: "PO number recorded (or waived)", ok: !!p.poNumber?.trim() || p.poWaived, hint: "Enter the customer's PO number, or tick \"PO waived\" with a reason, on Edit project." },
  ];
}

export type ClosureInput = {
  todayIso: string;
  /** RAID items still OPEN or IN_PROGRESS. */
  openRaidCount: number;
  /** Latest status update of any scope (yyyy-MM-dd), or null. */
  lastStatusIso: string | null;
  uatStatus: string;
  uatNotApplicable: boolean;
  milestones: { name: string; status: string; writtenOff: boolean }[];
  /** Unbilled WIP on the project, from wip-data (hours and value in the company currency). */
  unbilledHours: number;
  unbilledValue: number;
  currency: string;
  wipAcknowledged: boolean;
  /** Timecards on the project still SUBMITTED (waiting for a decision). */
  submittedCardCount: number;
};

/** Days a status update counts as recent for closure (and in the hygiene worklist). Exactly 30 is fine. */
export const STATUS_FRESH_DAYS = 30;

const names = (xs: string[], max = 3) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

/** Closure: what must be true before a project can be COMPLETED. */
export function closureChecks(p: ClosureInput): GateCheck[] {
  const openMs = p.milestones.filter((m) => m.status !== "COMPLETE" && m.status !== "INVOICED" && !m.writtenOff);
  const statusAge = p.lastStatusIso ? daysBetweenIso(p.lastStatusIso, p.todayIso) : null;
  const wipClear = p.unbilledHours < 0.005 && Math.abs(p.unbilledValue) < 0.005;
  return [
    { key: "raid", label: "No open issues or risks", ok: p.openRaidCount === 0, hint: `${p.openRaidCount} RAID item${p.openRaidCount === 1 ? " is" : "s are"} still open or in progress — close ${p.openRaidCount === 1 ? "it" : "them"} on the Issues tab.` },
    { key: "status", label: `Status update in the last ${STATUS_FRESH_DAYS} days`, ok: statusAge != null && statusAge <= STATUS_FRESH_DAYS, hint: p.lastStatusIso ? `The last status update was ${statusAge} days ago (${p.lastStatusIso}) — send a closing update.` : "No status update was ever sent — send a closing update." },
    { key: "uat", label: "UAT accepted (or not applicable)", ok: p.uatStatus === "ACCEPTED" || p.uatNotApplicable, hint: "Record the customer's acceptance on the UAT tab, or mark UAT not applicable." },
    { key: "milestones", label: "Every milestone complete, invoiced or written off", ok: openMs.length === 0, hint: `Still open: ${names(openMs.map((m) => m.name))}. Complete them, or write them off.` },
    { key: "wip", label: "No unbilled work (or acknowledged)", ok: wipClear || p.wipAcknowledged, hint: `${p.currency} ${p.unbilledValue.toFixed(2)} (${Math.round(p.unbilledHours * 100) / 100}h) is approved but not invoiced — invoice it, or acknowledge it to close anyway.` },
    { key: "timecards", label: "No timecard waiting for approval", ok: p.submittedCardCount === 0, hint: `${p.submittedCardCount} timecard${p.submittedCardCount === 1 ? " is" : "s are"} still waiting for a decision — approve or reject ${p.submittedCardCount === 1 ? "it" : "them"}.` },
  ];
}

/** A gate's verdict. Everything green passes. Otherwise only an administrator, with a written reason,
 *  may go ahead — and the caller records that override. */
export function gateDecision(checks: GateCheck[], opts: { isAdmin: boolean; overrideReason?: string | null }): { ok: boolean; overridden: boolean; error?: string } {
  const failing = checks.filter((c) => !c.ok);
  if (failing.length === 0) return { ok: true, overridden: false };
  const list = failing.map((c) => c.label).join("; ");
  if (!opts.overrideReason?.trim()) return { ok: false, overridden: false, error: `${failing.length} check${failing.length === 1 ? "" : "s"} not met: ${list}.` };
  if (!opts.isAdmin) return { ok: false, overridden: false, error: `Only an administrator can override the checks (${list}).` };
  return { ok: true, overridden: true };
}
