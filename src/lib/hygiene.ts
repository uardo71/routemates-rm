// The data-hygiene worklist: pure predicates over rows the caller loads (see hygiene-data.ts), one
// per check. The Portfolio, My Day and the weekly hygiene email all read this module, so "what is
// incomplete" means the same thing everywhere. Every item deep-links to the field that fixes it.

import { daysBetweenIso } from "@/lib/delivery-signals";
import { STATUS_FRESH_DAYS } from "@/lib/project-stage";

export type HygieneSeverity = "WARN" | "INFO";
export type HygieneKey =
  | "won_not_started"
  | "active_no_po"
  | "active_no_end"
  | "on_hold_no_issue"
  | "no_status_ever"
  | "status_stale"
  | "milestone_overdue"
  | "milestone_open_after_assignments"
  | "approved_no_budget"
  | "client_no_sponsor"
  | "active_no_manager";

export type HygieneItem = {
  key: HygieneKey;
  label: string;
  severity: HygieneSeverity;
  projectId: string;
  engagementId?: string | null;
  fixHref: string;
  hint: string;
  /** Display + routing extras. */
  projectName: string;
  managerId: string | null;
  /** What the item is about (project, milestone or client id) — stable id for dedup and My Day. */
  subjectId: string;
};

export const HYGIENE_CHECKS: { key: HygieneKey; label: string; severity: HygieneSeverity }[] = [
  { key: "active_no_manager", label: "Active project with no manager", severity: "WARN" },
  { key: "won_not_started", label: "Won deal, project not started", severity: "WARN" },
  { key: "active_no_po", label: "Active project with no PO (and no waiver)", severity: "WARN" },
  { key: "active_no_end", label: "Active project with no end date", severity: "WARN" },
  { key: "on_hold_no_issue", label: "On hold with no open issue explaining why", severity: "WARN" },
  { key: "no_status_ever", label: "No status update ever", severity: "WARN" },
  { key: "status_stale", label: `Status update older than ${STATUS_FRESH_DAYS} days`, severity: "WARN" },
  { key: "milestone_overdue", label: "Milestone past its end date, not complete", severity: "INFO" },
  { key: "milestone_open_after_assignments", label: "Assignments ended, milestone still open for time", severity: "INFO" },
  { key: "approved_no_budget", label: "Approved time but no budget hours", severity: "INFO" },
  { key: "client_no_sponsor", label: "Client with no sponsor contact", severity: "INFO" },
];
const META = new Map(HYGIENE_CHECKS.map((c) => [c.key, c]));

export type HygieneProjectRow = {
  id: string; name: string; clientId: string; clientName: string; status: string; isInternal: boolean;
  managerId: string | null; endDate: string | null; poNumber: string | null; poWaived: boolean;
  budgetHours: number | null; approvedHours: number; sponsorContactId: string | null;
  /** Latest status update of any scope, yyyy-MM-dd. */
  lastStatusIso: string | null;
  /** RAID items not CLOSED. */
  openIssueCount: number;
  hasWonOpportunity: boolean;
};
export type HygieneMilestoneRow = {
  id: string; name: string; projectId: string; endDate: string | null; status: string;
  writtenOff: boolean; timeEntryOpen: boolean; assignmentEndDates: string[];
};
export type HygieneRows = { projects: HygieneProjectRow[]; milestones: HygieneMilestoneRow[] };

const LIVE = new Set(["PLANNED", "ACTIVE", "ON_HOLD"]);
const live = (p: HygieneProjectRow) => !p.isInternal && LIVE.has(p.status);
const edit = (id: string, field: string) => `/projects/${id}/edit#field-${field}`;

function item(key: HygieneKey, p: HygieneProjectRow, fixHref: string, hint: string, subjectId = p.id): HygieneItem {
  const m = META.get(key)!;
  return { key, label: m.label, severity: m.severity, projectId: p.id, engagementId: null, fixHref, hint, projectName: p.name, managerId: p.managerId, subjectId };
}

export function wonNotStarted(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "PLANNED" && p.hasWonOpportunity)
    .map((p) => item("won_not_started", p, `/projects/${p.id}?lifecycle=start`, "The deal is won but the project is still Planned — run Prepare for Delivery and start it."));
}
export function activeNoPo(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "ACTIVE" && !p.poNumber?.trim() && !p.poWaived)
    .map((p) => item("active_no_po", p, edit(p.id, "poNumber"), "Record the customer's PO number, or waive it with a reason."));
}
export function activeNoEnd(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "ACTIVE" && !p.endDate)
    .map((p) => item("active_no_end", p, edit(p.id, "endDate"), "Set the planned end (go-live) date."));
}
export function onHoldNoIssue(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "ON_HOLD" && p.openIssueCount === 0)
    .map((p) => item("on_hold_no_issue", p, `/delivery/${p.id}?tab=raid`, "A paused project needs an open issue recording why it's on hold and what unblocks it."));
}
export function noStatusEver(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && (p.status === "ACTIVE" || p.status === "ON_HOLD") && !p.lastStatusIso)
    .map((p) => item("no_status_ever", p, `/delivery/${p.id}?tab=status`, "Send the first status update."));
}
/** Stale means strictly older than STATUS_FRESH_DAYS: exactly 30 days is still fine, 31 is stale. */
export function statusStale(r: HygieneRows, todayIso: string): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "ACTIVE" && p.lastStatusIso && daysBetweenIso(p.lastStatusIso, todayIso) > STATUS_FRESH_DAYS)
    .map((p) => item("status_stale", p, `/delivery/${p.id}?tab=status`, `The last status update was ${daysBetweenIso(p.lastStatusIso!, todayIso)} days ago (${p.lastStatusIso}).`));
}
/** Past its end date means the end date is before today — due today is not overdue. */
export function milestoneOverdue(r: HygieneRows, todayIso: string): HygieneItem[] {
  const byId = new Map(r.projects.map((p) => [p.id, p]));
  return r.milestones.flatMap((m) => {
    const p = byId.get(m.projectId);
    if (!p || !live(p) || !m.endDate || m.writtenOff || m.status === "COMPLETE" || m.status === "INVOICED") return [];
    if (daysBetweenIso(m.endDate, todayIso) <= 0) return [];
    return [item("milestone_overdue", p, `/projects/${p.id}/milestones/${m.id}`, `${m.name} ended ${m.endDate} and is still ${m.status.toLowerCase()} — complete it, re-plan it or write it off.`, m.id)];
  });
}
/** Every assignment on the milestone has ended (before today), yet the milestone still takes time. */
export function milestoneOpenAfterAssignments(r: HygieneRows, todayIso: string): HygieneItem[] {
  const byId = new Map(r.projects.map((p) => [p.id, p]));
  return r.milestones.flatMap((m) => {
    const p = byId.get(m.projectId);
    if (!p || !live(p) || !m.timeEntryOpen || m.assignmentEndDates.length === 0) return [];
    if (!m.assignmentEndDates.every((d) => daysBetweenIso(d, todayIso) > 0)) return [];
    return [item("milestone_open_after_assignments", p, `/projects/${p.id}/milestones/${m.id}`, `Every assignment on ${m.name} has ended, but it is still open for time — close it for time entry, or extend the assignment.`, m.id)];
  });
}
export function approvedNoBudget(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => live(p) && p.approvedHours > 0 && !((p.budgetHours ?? 0) > 0))
    .map((p) => item("approved_no_budget", p, edit(p.id, "budgetHours"), `${Math.round(p.approvedHours * 100) / 100}h approved against no budget — set the budget hours.`));
}
/** One item per client with live projects where none names a sponsor contact. */
export function clientNoSponsor(r: HygieneRows): HygieneItem[] {
  const byClient = new Map<string, HygieneProjectRow[]>();
  for (const p of r.projects.filter(live)) (byClient.get(p.clientId) ?? byClient.set(p.clientId, []).get(p.clientId)!).push(p);
  const out: HygieneItem[] = [];
  for (const [clientId, ps] of byClient) {
    if (ps.some((p) => p.sponsorContactId)) continue;
    const p = [...ps].sort((a, b) => a.name.localeCompare(b.name))[0];
    out.push(item("client_no_sponsor", p, edit(p.id, "sponsorContactId"), `${p.clientName} has no sponsor named on any of its ${ps.length} live project${ps.length === 1 ? "" : "s"} — pick one from the client's contacts.`, clientId));
  }
  return out;
}
export function activeNoManager(r: HygieneRows): HygieneItem[] {
  return r.projects.filter((p) => !p.isInternal && p.status === "ACTIVE" && !p.managerId)
    .map((p) => item("active_no_manager", p, edit(p.id, "managerId"), "Nobody is accountable for this project — pick a project manager."));
}

/** Every failing check, in HYGIENE_CHECKS order. */
export function evaluateHygiene(r: HygieneRows, todayIso: string): HygieneItem[] {
  const all = [
    ...activeNoManager(r), ...wonNotStarted(r), ...activeNoPo(r), ...activeNoEnd(r), ...onHoldNoIssue(r),
    ...noStatusEver(r), ...statusStale(r, todayIso), ...milestoneOverdue(r, todayIso),
    ...milestoneOpenAfterAssignments(r, todayIso), ...approvedNoBudget(r), ...clientNoSponsor(r),
  ];
  const order = new Map(HYGIENE_CHECKS.map((c, i) => [c.key, i]));
  return all.sort((a, b) => order.get(a.key)! - order.get(b.key)! || a.projectName.localeCompare(b.projectName));
}

/** Count per check, for chips. */
export function hygieneCounts(items: HygieneItem[]): Map<HygieneKey, number> {
  const m = new Map<HygieneKey, number>();
  for (const i of items) m.set(i.key, (m.get(i.key) ?? 0) + 1);
  return m;
}
