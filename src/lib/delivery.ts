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
