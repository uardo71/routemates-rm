// The delivery signals, defined ONCE and pure (no Prisma, no Date.now()): My Day, the cockpit and
// the daily alert rules all call these, so a workspace can never be "due" on one screen and fine on
// another. Every input is a plain value; "today" is always passed in as yyyy-MM-dd.

import { cadenceDays } from "@/lib/delivery-day";

const DAY_MS = 86_400_000;
const dayMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
/** Whole days from `fromIso` to `toIso` (UTC dates; time-of-day ignored). */
export const daysBetweenIso = (fromIso: string, toIso: string): number => Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY_MS);

// ---------- status updates ----------

export type StatusChaseInput = {
  /** Latest report date in this scope (yyyy-MM-dd), or null when never reported. */
  lastReportDateIso: string | null;
  cadence: string | null | undefined;
  /** Reference date for "never reported" — the project's start or creation date. */
  sinceIso: string | null;
  todayIso: string;
  customerFacing: boolean;
  active: boolean;
  done: boolean;
};
export type StatusChase = {
  /** A status update should go out. */
  due: boolean;
  neverReported: boolean;
  daysSince: number | null;
  cadenceDays: number | null;
  /** 0 = not late, 1 = past one cadence, 2 = past two cadences (escalate). */
  tier: 0 | 1 | 2;
  tracking: "TRACKED" | "ADHOC" | "OFF";
};

/** Is a status update due, and how late? Ad-hoc cadence and non-customer-facing scopes are never
 *  chased (that exemption is surfaced in the UI as "not tracked"). */
export function statusChase(i: StatusChaseInput): StatusChase {
  const cad = cadenceDays(i.cadence);
  const tracking: StatusChase["tracking"] = !i.customerFacing ? "OFF" : i.cadence === "ADHOC" ? "ADHOC" : "TRACKED";
  const ref = i.lastReportDateIso ?? i.sinceIso;
  const daysSince = i.lastReportDateIso ? daysBetweenIso(i.lastReportDateIso, i.todayIso) : null;
  const neverReported = i.lastReportDateIso === null;
  if (!i.customerFacing || !i.active || i.done) return { due: false, neverReported, daysSince, cadenceDays: cad, tier: 0, tracking };
  if (neverReported) {
    // Never reported: due at once; escalate when the project has run more than two cadences without a word.
    const sinceDays = ref ? daysBetweenIso(ref, i.todayIso) : 0;
    const tier: StatusChase["tier"] = cad !== null && sinceDays > cad * 2 ? 2 : 1;
    return { due: true, neverReported, daysSince, cadenceDays: cad, tier, tracking };
  }
  if (cad === null) return { due: false, neverReported, daysSince, cadenceDays: cad, tier: 0, tracking };
  const late = (daysSince ?? 0) > cad;
  const tier: StatusChase["tier"] = !late ? 0 : (daysSince ?? 0) > cad * 2 ? 2 : 1;
  return { due: late, neverReported, daysSince, cadenceDays: cad, tier, tracking };
}

// ---------- plan tasks ----------

export type PlanTaskSignal = { status: string; progress: number; isMilestone: boolean; dueDate: string | null };
/** A task is open unless COMPLETED or at 100% — progress drives status. */
export const isPlanTaskOpen = (t: { status: string; progress: number }) => t.status !== "COMPLETED" && t.progress < 100;
/** Open, dated, non-milestone tasks whose due date has passed (due today is not overdue). */
export function overduePlanTasks<T extends PlanTaskSignal>(tasks: T[], todayIso: string): T[] {
  return tasks.filter((t) => !t.isMilestone && isPlanTaskOpen(t) && t.dueDate != null && daysBetweenIso(t.dueDate, todayIso) > 0);
}

// ---------- RAID ----------

export type RaidSignal = { status: string; severity: string | null; dueDate: string | null };
export const isHighSeverity = (sev: string | null | undefined) => sev === "HIGH" || sev === "CRITICAL";
/** Open items past their target date. */
export function overdueRaidItems<T extends RaidSignal>(items: T[], todayIso: string): T[] {
  return items.filter((r) => r.status !== "CLOSED" && r.dueDate != null && daysBetweenIso(r.dueDate, todayIso) > 0);
}
/** High/critical items that are open but not (yet) overdue — worth a nudge, not an escalation. */
export function highOpenRaidItems<T extends RaidSignal>(items: T[], todayIso: string): T[] {
  return items.filter((r) => r.status !== "CLOSED" && isHighSeverity(r.severity) && !(r.dueDate != null && daysBetweenIso(r.dueDate, todayIso) > 0));
}

// ---------- meeting / status actions ----------

export type ActionSignal = { done: boolean; dueDate: string | null };
export function overdueActions<T extends ActionSignal>(actions: T[], todayIso: string): T[] {
  return actions.filter((a) => !a.done && a.dueDate != null && daysBetweenIso(a.dueDate, todayIso) > 0);
}

// ---------- go-live readiness ----------

export type GoLiveInput = {
  active: boolean;
  done: boolean;
  uatStatus: string;
  uatAccepted: boolean;
  /** Project end date = go-live, yyyy-MM-dd or null. */
  endDateIso: string | null;
  todayIso: string;
  scripts: { status: string }[];
  /** Leaf cutover steps (no children) across the plans in scope. */
  cutoverLeaves: { status: string }[];
};
export type GoLiveReadiness = {
  daysToGoLive: number | null;
  goLiveNear: boolean;
  uatWindow: boolean;
  /** UAT is coming/under way but no script is SENT. */
  uatScriptDue: boolean;
  cutoverDone: number;
  cutoverTotal: number;
  cutoverComplete: boolean;
  /** UAT accepted or go-live within 14 days, and the cutover isn't finished. */
  cutoverDue: boolean;
  /** Within 3 days of go-live and still not done. */
  cutoverUrgent: boolean;
};

export function goLiveReadiness(i: GoLiveInput): GoLiveReadiness {
  const daysToGoLive = i.endDateIso ? daysBetweenIso(i.todayIso, i.endDateIso) : null;
  const goLiveNear = daysToGoLive != null && daysToGoLive <= 14;
  const uatWindow = i.uatStatus !== "NOT_STARTED" || (i.active && daysToGoLive != null && daysToGoLive >= 0 && daysToGoLive <= 30);
  const cutoverDone = i.cutoverLeaves.filter((t) => t.status === "DONE" || t.status === "SKIPPED").length;
  const cutoverTotal = i.cutoverLeaves.length;
  const cutoverComplete = cutoverTotal > 0 && cutoverDone === cutoverTotal;
  const blocked = !i.active || i.done;
  const uatScriptDue = !blocked && uatWindow && (i.scripts.length === 0 || i.scripts.some((s) => s.status !== "SENT"));
  const cutoverDue = !i.done && !cutoverComplete && (i.uatAccepted || (i.active && goLiveNear));
  return { daysToGoLive, goLiveNear, uatWindow, uatScriptDue, cutoverDone, cutoverTotal, cutoverComplete, cutoverDue, cutoverUrgent: cutoverDue && daysToGoLive != null && daysToGoLive <= 3 };
}

// ---------- calendar ----------

/** ISO-8601 week key, e.g. "2026-W37" — the digest's "once per PM per week" unit. */
export function isoWeek(dateIso: string): string {
  const d = new Date(dayMs(dateIso));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
/** 1 = Monday … 7 = Sunday. */
export const isoWeekday = (dateIso: string): number => new Date(dayMs(dateIso)).getUTCDay() || 7;
