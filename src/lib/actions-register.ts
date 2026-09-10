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
    isOverdue: overdueDays != null && overdueDays > 0,
    unassigned: !a.ownerUserId && !(a.owner ?? "").trim(),
  };
}

/** Worst first: overdue (most days late first), then due soonest, then undated (oldest first). */
export function compareWorstFirst(a: EnrichedAction, b: EnrichedAction): number {
  const oa = a.overdueDays ?? Number.NEGATIVE_INFINITY;
  const ob = b.overdueDays ?? Number.NEGATIVE_INFINITY;
  if (oa !== ob) return ob - oa;
  if (a.critical !== b.critical) return Number(b.critical) - Number(a.critical);
  return b.ageDays - a.ageDays;
}

export function enrichAll(actions: RegisterAction[], todayIso: string): EnrichedAction[] {
  return actions.map((a) => enrichAction(a, todayIso)).sort(compareWorstFirst);
}

export type ActionFilter = {
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
  return actions.filter((a) => {
    if (f.mineUserId && a.ownerUserId !== f.mineUserId) return false;
    if (f.unassigned && !a.unassigned) return false;
    if (f.overdue && !a.isOverdue) return false;
    if (f.projectId && a.projectId !== f.projectId) return false;
    if (f.source && a.source !== f.source) return false;
    if (needle && !`${a.title} ${a.projectName} ${a.engagementName ?? ""} ${a.owner ?? ""} ${a.status}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type ActionSortKey = "worst" | "due" | "age" | "title" | "project" | "owner" | "source";
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
    }
  };
  s.sort((a, b) => (dir === "asc" ? cmp(a, b) : -cmp(a, b)));
  return s;
}

export function summarizeActions(actions: EnrichedAction[]) {
  return {
    total: actions.length,
    overdue: actions.filter((a) => a.isOverdue).length,
    unassigned: actions.filter((a) => a.unassigned).length,
    dueThisWeek: actions.filter((a) => a.overdueDays != null && a.overdueDays <= 0 && a.overdueDays >= -7).length,
  };
}
