import type { UatResult, UatScriptStatus, UatIssueStatus } from "@prisma/client";

// Pure helpers + labels for the UAT test scripts — client & server safe.

export const UAT_RESULTS: UatResult[] = ["NOT_RUN", "OK", "KO", "REDO"];
export const UAT_RESULT_LABEL: Record<UatResult, string> = { NOT_RUN: "Not run", OK: "OK", KO: "KO", REDO: "Redo" };
export const UAT_RESULT_TONE: Record<UatResult, string> = {
  NOT_RUN: "bg-muted text-muted-foreground",
  OK: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  KO: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  REDO: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};
export const UAT_RESULT_HEX: Record<UatResult, string> = {
  NOT_RUN: "FFEDEFF2",
  OK: "FFD1FAE5",
  KO: "FFFEE2E2",
  REDO: "FFFEF3C7",
};

export const UAT_SCRIPT_STATUSES: UatScriptStatus[] = ["DRAFT", "READY", "SENT"];
export const UAT_SCRIPT_STATUS_LABEL: Record<UatScriptStatus, string> = { DRAFT: "Draft", READY: "Ready", SENT: "Sent to customer" };
export const UAT_SCRIPT_STATUS_TONE: Record<UatScriptStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  READY: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  SENT: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export const UAT_ISSUE_STATUS_LABEL: Record<UatIssueStatus, string> = { OPEN: "Open", CLOSED: "Closed" };

export type AreaRollup = { total: number; ok: number; ko: number; redo: number; notRun: number };
export function rollupArea(results: UatResult[]): AreaRollup {
  return {
    total: results.length,
    ok: results.filter((r) => r === "OK").length,
    ko: results.filter((r) => r === "KO").length,
    redo: results.filter((r) => r === "REDO").length,
    notRun: results.filter((r) => r === "NOT_RUN").length,
  };
}
