// Pure half of the cross-project actions register: one row shape for the four action-bearing
// models (plan tasks, RAID items, status-report actions, meeting actions), plus age/overdue math,
// filtering and the default "worst first" ordering. The server half (actions-register-data.ts)
// loads and completes rows.

export type ActionSource = "PLAN" | "RAID" | "STATUS" | "MEETING" | "TICKET";
export const ACTION_SOURCES: ActionSource[] = ["RAID", "MEETING", "STATUS", "PLAN", "TICKET"];
export const ACTION_SOURCE_LABEL: Record<ActionSource, string> = {
  PLAN: "Plan task", RAID: "Issue / RAID", STATUS: "Status action", MEETING: "Meeting action", TICKET: "Support ticket",
};

/** Where a row's "Resolve" opens. One rule, used by the register loader and by the cockpit card, so
 *  the two can never send you somewhere different for the same action. */
export function actionHref(source: ActionSource, projectId: string, engagementId: string | null, ticketId?: string): string {
  if (source === "TICKET") return `/tickets/${ticketId ?? projectId}`;
  const p = new URLSearchParams();
  if (engagementId) p.set("eng", engagementId);
  p.set("tab", source === "RAID" ? "raid" : source === "MEETING" ? "minutes" : source === "STATUS" ? "status" : "plan");
  return `/delivery/${projectId}?${p.toString()}`;
}

/** A support ticket never completes from this list - its own stage/gate rules and Save flow govern
 *  that. The register only surfaces it and links out. */
export const isTicket = (source: ActionSource) => source === "TICKET";

export type RegisterAction = {
  id: string;
  source: ActionSource;
  title: string;
  projectId: string;
  projectName: string;
  engagementId: string | null;
  engagementName: string | null;
  /** The account this work belongs to - the register's primary grouping. Null when the source has
   *  no client (an internal project, or a ticket filed under none). */
  clientId: string | null;
  clientName: string | null;
  /** Where "Resolve" / "Open ticket" goes: the real record, never this list. */
  href: string;
  /** Free-text owner (client-side people keep this only). */
  owner: string | null;
  /** Set when the owner is one of our people. */
  ownerUserId: string | null;
  /** yyyy-MM-dd or null. */
  dueDate: string | null;
  /** ISO timestamp the action was raised. */
  createdAt: string;
  /** Source-specific state label, e.g. "Open", "In progress", "45%". */
  status: string;
  /** Extra weight: a critical status action or a high/critical RAID item. */
  critical: boolean;
  /** Completed at source (issue closed, action done, plan task at 100%). Absent => open. */
  done?: boolean;
  /** ISO timestamp it was completed, when known. */
  completedAt?: string | null;
  /** Who completed it (display name), when recorded. */
  completedBy?: string | null;

  // ---- per-source extras, all optional so the four original sources are unchanged ----
  /** PLAN: 0-100, so the row can draw a real progress bar instead of a "45%" string. */
  progress?: number | null;
  /** TICKET: its number, e.g. TKT-00000006. */
  ref?: string | null;
  /** TICKET (STATUS-mode): the SLA verdict, exactly as the Support badge computes it. */
  slaKind?: "on_track" | "at_risk" | "breached" | "none";
  slaDetail?: string | null;
  /** TICKET (STAGE-mode): the stage it sits in, and how many of that stage's gates are unmet. */
  stageName?: string | null;
  gatesWaiting?: number;
  /** Belongs in "Needs attention" whatever its due date says - a breached SLA or a gate waiting on
   *  its assignee. Kept separate from `critical`, which drives the CRITICAL severity badge. */
  urgent?: boolean;
};

export type EnrichedAction = RegisterAction & {
  /** Whole days since it was raised. */
  ageDays: number;
  /** Days past due (positive), 0 when due today, negative when still in the future, null without a due date. */
  overdueDays: number | null;
  isOverdue: boolean;
  unassigned: boolean;
  /** Overdue, critical, or urgent in its own right (a breached / gate-waiting ticket). */
  needsAttention: boolean;
  /** Routine work completes with one tick here. Critical items and every ticket do not: they open
   *  at their source, where the real rules live. */
  completableHere: boolean;
};

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Whole days from `fromIso` to `toIso` at UTC midnight (date-only or full ISO input). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDay(toIso) - utcDay(fromIso)) / DAY_MS);
}

export function enrichAction(a: RegisterAction, todayIso: string): EnrichedAction {
  const overdueDays = a.dueDate ? daysBetween(a.dueDate, todayIso) : null;
  const isOverdue = !a.done && overdueDays != null && overdueDays > 0;
  return {
    ...a,
    ageDays: Math.max(0, daysBetween(a.createdAt, todayIso)),
    overdueDays,
    // A completed action is never late, whatever its due date said.
    isOverdue,
    unassigned: !a.ownerUserId && !(a.owner ?? "").trim(),
    needsAttention: !a.done && (isOverdue || a.critical || !!a.urgent),
    completableHere: !isTicket(a.source) && (!!a.done || !a.critical),
  };
}

/** Worst first: overdue (most days late first), then due soonest, then undated (oldest first). */
export function compareWorstFirst(a: EnrichedAction, b: EnrichedAction): number {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1; // open work first, completed after
  const oa = a.overdueDays ?? Number.NEGATIVE_INFINITY;
  const ob = b.overdueDays ?? Number.NEGATIVE_INFINITY;
  if (oa !== ob) return ob - oa;
  if (a.critical !== b.critical) return Number(b.critical) - Number(a.critical);
  return b.ageDays - a.ageDays;
}

export function enrichAll(actions: RegisterAction[], todayIso: string): EnrichedAction[] {
  return actions.map((a) => enrichAction(a, todayIso)).sort(compareWorstFirst);
}

/** Which actions a list shows. */
export type ActionView = "open" | "completed" | "all";
/** Stable key of an action across the four sources. */
export const actionKey = (a: { source: ActionSource; id: string }) => `${a.source}:${a.id}`;

/** What saving a tick does to an action that is (or isn't) done: complete it, reopen it, or nothing.
 *  `wantDone` undefined means "not specified" - the action keeps its state. */
export function completionChange(wasDone: boolean, wantDone: boolean | undefined): "complete" | "reopen" | "none" {
  if (wantDone === undefined || wantDone === wasDone) return "none";
  return wantDone ? "complete" : "reopen";
}

export type ActionFilter = {
  /** Open, completed or both (default both). */
  view?: ActionView;
  /** Keys still shown in the Open view although completed (just ticked, kept visible crossed out). */
  pinned?: Set<string>;
  /** Only actions whose ownerUserId is this user. */
  mineUserId?: string | null;
  unassigned?: boolean;
  overdue?: boolean;
  projectId?: string | null;
  source?: ActionSource | null;
  q?: string | null;
};

export function filterActions(actions: EnrichedAction[], f: ActionFilter): EnrichedAction[] {
  const needle = f.q?.trim().toLowerCase() ?? "";
  const view = f.view ?? "all";
  return actions.filter((a) => {
    if (view === "open" && a.done && !f.pinned?.has(actionKey(a))) return false;
    if (view === "completed" && !a.done) return false;
    if (f.mineUserId && a.ownerUserId !== f.mineUserId) return false;
    if (f.unassigned && !a.unassigned) return false;
    if (f.overdue && !a.isOverdue) return false;
    if (f.projectId && a.projectId !== f.projectId) return false;
    if (f.source && a.source !== f.source) return false;
    if (needle && !`${a.title} ${a.ref ?? ""} ${a.clientName ?? ""} ${a.projectName} ${a.engagementName ?? ""} ${a.owner ?? ""} ${a.status}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type ActionSortKey = "worst" | "due" | "age" | "title" | "project" | "owner" | "source" | "completed";
export function sortActions(actions: EnrichedAction[], key: ActionSortKey, dir: "asc" | "desc"): EnrichedAction[] {
  const s = [...actions];
  const cmp = (a: EnrichedAction, b: EnrichedAction): number => {
    switch (key) {
      case "worst": return compareWorstFirst(a, b);
      case "due": return (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
      case "age": return a.ageDays - b.ageDays;
      case "title": return a.title.localeCompare(b.title);
      case "project": return `${a.projectName} ${a.engagementName ?? ""}`.localeCompare(`${b.projectName} ${b.engagementName ?? ""}`);
      case "owner": return (a.owner ?? "").localeCompare(b.owner ?? "");
      case "source": return a.source.localeCompare(b.source);
      case "completed": return (a.done ? a.completedAt ?? "" : "").localeCompare(b.done ? b.completedAt ?? "" : "");
    }
  };
  s.sort((a, b) => (dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  return s;
}

/** Counts for the chips - open work only, plus how many are completed. */
export function summarizeActions(actions: EnrichedAction[]) {
  const open = actions.filter((a) => !a.done);
  return {
    total: open.length,
    completed: actions.length - open.length,
    overdue: open.filter((a) => a.isOverdue).length,
    unassigned: open.filter((a) => a.unassigned).length,
    dueThisWeek: open.filter((a) => a.overdueDays != null && a.overdueDays <= 0 && a.overdueDays >= -7).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Grouping: CLIENT first, then the engagement / project the work actually belongs to.
//
// Project was the old primary grouping and it misled - the same generic project name sits under
// several unrelated clients, so one heading looked like one thing when it was three. The account is
// the real navigational unit; the project is the sub-heading inside it.
// ---------------------------------------------------------------------------------------------

export const NO_CLIENT = "No client";

export type ActionSubGroup = { key: string; label: string; actions: EnrichedAction[] };

export type ActionGroup = {
  /** Client id, or "" for the no-client bucket (always usable as a React key). */
  clientId: string;
  clientName: string;
  actions: EnrichedAction[];
  /** Open actions in this client - what the group header counts. */
  openCount: number;
  subGroups: ActionSubGroup[];
};

/** The heading a row sits under inside its client. */
export const subGroupLabel = (a: EnrichedAction) => a.engagementName ?? a.projectName;

export function groupByClient(actions: EnrichedAction[]): ActionGroup[] {
  const byClient = new Map<string, ActionGroup>();
  for (const a of actions) {
    const key = a.clientId ?? "";
    let g = byClient.get(key);
    if (!g) {
      g = { clientId: key, clientName: a.clientName ?? NO_CLIENT, actions: [], openCount: 0, subGroups: [] };
      byClient.set(key, g);
    }
    g.actions.push(a);
    if (!a.done) g.openCount++;
  }
  for (const g of byClient.values()) {
    const subs = new Map<string, ActionSubGroup>();
    for (const a of g.actions) {
      const k = `${a.projectId}:${a.engagementId ?? ""}`;
      let sub = subs.get(k);
      if (!sub) { sub = { key: k, label: subGroupLabel(a), actions: [] }; subs.set(k, sub); }
      sub.actions.push(a);
    }
    // Worst sub-group first, then alphabetical so the order is stable.
    g.subGroups = [...subs.values()].sort(
      (x, y) => compareWorstFirst(x.actions[0], y.actions[0]) || x.label.localeCompare(y.label),
    );
  }
  // The client holding the worst single item first; a client with nothing open sinks below one that has.
  return [...byClient.values()].sort((a, b) => {
    if ((a.openCount > 0) !== (b.openCount > 0)) return a.openCount > 0 ? -1 : 1;
    return compareWorstFirst(a.actions[0], b.actions[0]) || a.clientName.localeCompare(b.clientName);
  });
}

/** Everything overdue, critical or urgent, across every client and source - the strip above the
 *  grouped list. Completed work never appears, whatever its due date said. */
export function attentionActions(actions: EnrichedAction[]): EnrichedAction[] {
  return actions.filter((a) => a.needsAttention).sort(compareWorstFirst);
}
