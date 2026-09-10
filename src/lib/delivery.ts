import type { RagStatus, RaidType, RaidStatus, RaidSeverity } from "@prisma/client";

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

export type PlanProgressInput = { progress: number; isMilestone: boolean; startDate: Date | string | null; dueDate: Date | string | null };

const DAY_MS = 86_400_000;
function spanDays(t: PlanProgressInput): number | null {
  if (!t.startDate || !t.dueDate) return null;
  const a = new Date(t.startDate).getTime();
  const b = new Date(t.dueDate).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(1, Math.round((b - a) / DAY_MS) + 1); // inclusive: a one-day task weighs 1
}

/** A phase's progress, weighted by each task's duration in days so a two-week task counts twice a
 *  one-week one. Milestones carry no work and are ignored. Falls back to the plain average when any
 *  task lacks dates (a half-dated plan must not silently over-weight the dated half). */
export function phaseProgress(tasks: PlanProgressInput[]): number {
  const real = tasks.filter((t) => !t.isMilestone);
  if (real.length === 0) return 0;
  const spans = real.map(spanDays);
  if (spans.some((d) => d == null)) return Math.round(real.reduce((s, t) => s + t.progress, 0) / real.length);
  const days = spans as number[];
  const total = days.reduce((s, d) => s + d, 0);
  return Math.round(real.reduce((s, t, i) => s + t.progress * days[i], 0) / total);
}

/** Splits rows into pages of `perPage` (the Gantt slide holds ~30 rows legibly). */
export function paginate<T>(rows: T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages.length ? pages : [[]];
}

