import type { CutoverStatus } from "@prisma/client";

// Pure helpers + labels for the cutover plan — no Prisma/runtime deps, safe on client & server.

export const CUTOVER_STATUSES: CutoverStatus[] = ["PENDING", "IN_PROGRESS", "DONE", "BLOCKED", "SKIPPED"];

export const CUTOVER_STATUS_LABEL: Record<CutoverStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  BLOCKED: "Blocked",
  SKIPPED: "Skipped",
};

export const CUTOVER_STATUS_TONE: Record<CutoverStatus, string> = {
  PENDING: "bg-muted text-muted-foreground",
  IN_PROGRESS: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  DONE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  BLOCKED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  SKIPPED: "bg-muted text-muted-foreground",
};

// ARGB fills for the Excel export.
export const CUTOVER_STATUS_HEX: Record<CutoverStatus, string> = {
  PENDING: "FFEDEFF2",
  IN_PROGRESS: "FFDBEAFE",
  DONE: "FFD1FAE5",
  BLOCKED: "FFFEE2E2",
  SKIPPED: "FFEDEFF2",
};

/** Parse a human duration ("2h", "1.5h", "1h30", "1h 30m", "30m", "1:30", "90") into whole minutes.
 *  Returns null for empty input, and null when it can't be understood (caller keeps the old value). */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h\s*(\d+)\s*m?$/))) return Math.round(Number(m[1]) * 60) + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h$/))) return Math.round(Number(m[1]) * 60);
  if ((m = s.match(/^(\d+)\s*m$/))) return Number(m[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

/** Minutes → "2h 30m" / "45m" / "3h". Empty string for null. */
export function formatDuration(mins: number | null | undefined): string {
  if (mins == null) return "";
  if (mins === 0) return "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

// Duration is entered/shown in DECIMAL HOURS (0.25, 0.5, 0.75, 1, 1.25…) but stored as whole minutes.
/** Stored minutes → hours as a plain string for a number input ("1.25", "" for null). */
export function hoursValue(mins: number | null | undefined): string {
  if (mins == null) return "";
  const h = Math.round((mins / 60) * 100) / 100;
  return String(h);
}
/** Hours text → whole minutes (0.25h → 15). Null for empty/invalid. */
export function minutesFromHours(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const h = parseFloat(t);
  if (isNaN(h) || h < 0) return null;
  return Math.round(h * 60);
}
/** Stored minutes → "1.25 h" for display/export. Empty string for null. */
export function formatHours(mins: number | null | undefined): string {
  const v = hoursValue(mins);
  return v ? `${v} h` : "";
}

/** Roll a parent's status up from its children: any blocked → blocked; all done/skipped → done;
 *  all pending → pending; otherwise in progress. */
export function rollupStatus(statuses: CutoverStatus[]): CutoverStatus {
  if (statuses.length === 0) return "PENDING";
  if (statuses.some((s) => s === "BLOCKED")) return "BLOCKED";
  if (statuses.every((s) => s === "DONE" || s === "SKIPPED")) return "DONE";
  if (statuses.every((s) => s === "PENDING")) return "PENDING";
  return "IN_PROGRESS";
}

export type CutoverSeed = { macro: string; activity: string; description?: string };

// A standard SAP go-live runbook to start from — edit freely after applying.
export const STANDARD_CUTOVER: CutoverSeed[] = [
  { macro: "Preparation", activity: "Get production access", description: "Request and confirm access to the production system for the go-live team." },
  { macro: "Preparation", activity: "Prepare list of transports (TRs) to move", description: "Compile and sequence the transport requests in the correct import order." },
  { macro: "Preparation", activity: "Freeze changes / lock DEV & QA", description: "No new transports once the list is frozen." },
  { macro: "Preparation", activity: "Take backup / snapshot", description: "Confirm a restore point exists before cutover." },
  { macro: "Transport to production", activity: "Import transports to production", description: "Move the TRs in the agreed sequence; watch the import logs." },
  { macro: "Transport to production", activity: "Check import logs / return codes", description: "Confirm all transports imported cleanly (RC 0/4)." },
  { macro: "Go-live configuration", activity: "Manual production configuration (T-code / table)", description: "Run the config steps that don't travel in transports." },
  { macro: "Go-live configuration", activity: "Stop / reschedule background jobs", description: "Stop or reschedule the relevant jobs as planned." },
  { macro: "Go-live configuration", activity: "Release number ranges / open posting periods", description: "Any master-data / financial opening steps." },
  { macro: "Validation", activity: "Smoke test key business processes", description: "Verify the critical end-to-end processes in production." },
  { macro: "Validation", activity: "Go / no-go decision", description: "Confirm with the customer and all providers that go-live is a go." },
  { macro: "Hypercare", activity: "Open hypercare / monitoring", description: "Hand over to hypercare; monitor for the agreed period." },
];
