import type { RagStatus, RaidType, RaidStatus, RaidSeverity } from "@prisma/client";
import { weightedProgress, type ProgressTask } from "@/lib/plan-schedule";

export const PHASES = ["Initiation", "Planning", "Execution", "Closure"] as const;

export const RAG_LABEL: Record<RagStatus, string> = { GREEN: "On track", AMBER: "At risk", RED: "Off track" };
// The customer status deck's "Severity/Timing" wording.
export const SEVERITY_LABEL: Record<RagStatus, string> = { GREEN: "Low / On time", AMBER: "Medium / Delay", RED: "High / Business impact" };
export const RAG_DOT: Record<RagStatus, string> = { GREEN: "bg-emerald-500", AMBER: "bg-amber-500", RED: "bg-rose-500" };
export const RAG_PILL: Record<RagStatus, string> = {
  GREEN: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  AMBER: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  RED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};
export const RAG_HEX: Record<RagStatus, string> = { GREEN: "FF16A34A", AMBER: "FFD97706", RED: "FFDC2626" };

export const RAID_TYPE_LABEL: Record<RaidType, string> = {
  RISK: "Risk",
  ASSUMPTION: "Assumption",
  ISSUE: "Issue",
  DEPENDENCY: "Dependency",
  DECISION: "Decision",
};
export const RAID_STATUS_LABEL: Record<RaidStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", CLOSED: "Closed" };
export const RAID_SEVERITY_LABEL: Record<RaidSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

export const CADENCE_LABEL: Record<string, string> = { WEEKLY: "Weekly", MONTHLY: "Monthly", ADHOC: "Ad-hoc" };

// ---------- RAG dimensions ----------

export const RAG_RANK: Record<RagStatus, number> = { GREEN: 0, AMBER: 1, RED: 2 };
export const RAG_DIMENSIONS = ["scheduleRag", "budgetRag", "scopeRag"] as const;
export type RagDimension = (typeof RAG_DIMENSIONS)[number];
export const RAG_DIMENSION_LABEL: Record<RagDimension, string> = { scheduleRag: "Schedule", budgetRag: "Budget", scopeRag: "Scope" };

/** The worst of several RAG values — the health a report really conveys when its dimensions differ. */
export function worstRag(...rags: (RagStatus | null | undefined)[]): RagStatus {
  let worst: RagStatus = "GREEN";
  for (const r of rags) if (r && RAG_RANK[r] > RAG_RANK[worst]) worst = r;
  return worst;
}

/** Overall vs. dimensions: true when at least one dimension says something the overall does not. */
export function ragDimensionsDiffer(r: { overallRag: RagStatus; scheduleRag: RagStatus; budgetRag: RagStatus; scopeRag: RagStatus }): boolean {
  return RAG_DIMENSIONS.some((d) => r[d] !== r.overallRag);
}

// ---------- plan rollups ----------

export type PlanProgressInput = ProgressTask;

const DAY_MS = 86_400_000;

/** A phase's (or the whole plan's) progress: effort-weighted when every task has an estimate, else
 *  duration-weighted, else a plain average — see `weightedProgress` in plan-schedule.ts. Milestones
 *  carry no work and are ignored. */
export function phaseProgress(tasks: PlanProgressInput[]): number {
  return weightedProgress(tasks).percent;
}

/** Splits rows into pages of `perPage` (the Gantt slide holds ~30 rows legibly). */
export function paginate<T>(rows: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages.length ? pages : [[]];
}

// ---------- status-report seeding ----------

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

/** The reporting period a new update should propose: weekly = the 7 days ending on the report
 *  date; monthly = the day after the previous period (else the 1st of the report month) up to the
 *  report date; ad-hoc = from the day after the previous period when there is one, else blank. */
export function defaultPeriod(cadence: string | null | undefined, reportDateIso: string, prevPeriodEndIso?: string | null): { periodStart: string; periodEnd: string } {
  const end = dayMs(reportDateIso);
  const after = prevPeriodEndIso ? dayMs(prevPeriodEndIso) + DAY_MS : null;
  if (cadence === "MONTHLY") {
    const first = Date.UTC(+reportDateIso.slice(0, 4), +reportDateIso.slice(5, 7) - 1, 1);
    const start = after != null && after < end ? after : first;
    return { periodStart: isoDay(start), periodEnd: reportDateIso };
  }
  if (cadence === "ADHOC") {
    return after != null && after <= end ? { periodStart: isoDay(after), periodEnd: reportDateIso } : { periodStart: "", periodEnd: "" };
  }
  return { periodStart: isoDay(end - 6 * DAY_MS), periodEnd: reportDateIso };
}

/** Actions to roll over into the next report: still open, or closed after the previous report went out. */
export function actionsToCarry<T extends { done: boolean; doneAt: string | null }>(actions: T[], prevReportDateIso: string): T[] {
  const cut = dayMs(prevReportDateIso);
  return actions.filter((a) => !a.done || (a.doneAt != null && dayMs(a.doneAt) > cut));
}

/** True when the reported % and the plan's duration-weighted % disagree by more than `tolerance` points. */
export function progressMismatch(reportPct: number | null, planPct: number | null, tolerance = 15): boolean {
  if (reportPct == null || planPct == null) return false;
  return Math.abs(reportPct - planPct) > tolerance;
}

