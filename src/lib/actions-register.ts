// Pure half of the cross-project actions register: one row shape for the four action-bearing
// models (plan tasks, RAID items, status-report actions, meeting actions), plus age/overdue math,
// filtering and the default "worst first" ordering. The server half (actions-register-data.ts)
// loads and completes rows.

export type ActionSource = "PLAN" | "RAID" | "STATUS" | "MEETING";
export const ACTION_SOURCES: ActionSource[] = ["RAID", "MEETING", "STATUS", "PLAN"];
export const ACTION_SOURCE_LABEL: Record<ActionSource, string> = { PLAN: "Plan task", RAID: "Issue / RAID", STATUS: "Status action", MEETING: "Meeting action" };

export type RegisterAction = {
  id: string;
  source: ActionSource;
  title: string;
  projectId: string;
  projectName: string;
  engagementId: string | null;
  engagementName: string | null;
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
};

export type EnrichedAction = RegisterAction & {
  /** Whole days since it was raised. */
  ageDays: number;
  /** Days past due (positive), 0 when due today, negative when still in the future, null without a due date. */
  overdueDays: number | null;
  isOverdue: boolean;
  unassigned: boolean;
};

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** Whole days from `fromIso` to `toIso` at UTC midnight (date-only or full ISO input). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcDay(toIso) - utcDay(fromIso)) / DAY_MS);
}

export function enrichAction(a: RegisterAction, todayIso: string): EnrichedAction {
  const overdueDays = a.dueDate ? daysBetween(a.dueDate, todayIso) : null;
  return {
    ...a,
    ageDays: Math.max(0, daysBetween(a.createdAt, todayIso)),
    overdueDays,
    // A completed action is never late, whatever its due date said.
    isOverdue: !a.done && overdueDays != null && overdueDays > 0,
    unassigned: !a.ownerUserId && !(a.owner ?? "").trim(),
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
    if (needle && !`${a.title} ${a.projectName} ${a.engagementName ?? ""} ${a.owner ?? ""} ${a.status}`.toLowerCase().includes(needle)) return false;
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
