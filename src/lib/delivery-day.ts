import type { RagStatus } from "@prisma/client";

// "My Day" for a PM — the guided path across their delivery workspaces. Pure types + coaching
// metadata (no Prisma), so the page can query real data and map it through these. The `how` hints
// are the seed of the (later) admin-editable SOP-hint library: friendly guidance, never a gate.

export type DayPriority = "CRIT" | "WARN" | "INFO";

// The lightweight, deterministic checks that drive the path. Each maps to one coaching hint.
export type DayItemKind =
  | "NO_STATUS" // active customer, no status update ever
  | "STATUS_DUE" // status update overdue against its cadence
  | "PLAN_OVERDUE" // a plan task slipped past its date
  | "ISSUE_DUE" // an open issue is past its target date
  | "ISSUE_OPEN" // a high-severity issue is open and needs a next action
  | "ACTION_OVERDUE" // a meeting action item is overdue
  | "UAT_SCRIPT_DUE" // UAT approaching, but the customer test script isn't sent
  | "CUTOVER_DUE" // UAT accepted / go-live near, but the cutover isn't finished
  | "HYGIENE"; // a data-hygiene check is failing (src/lib/hygiene.ts)

export type DayItem = {
  id: string;
  kind: DayItemKind;
  priority: DayPriority;
  title: string;
  context: string; // "Tungsten · Zambon"
  projectId: string;
  engagementId: string | null;
  tab: string; // deep-link tab: status | plan | raid | minutes
  cta: string;
  how: string;
  href?: string; // overrides the default cockpit-tab link (e.g. the cutover plan route)
};

export type DayStats = { overdue: number; todo: number; dueThisWeek: number; openIssues: number; myActions: number };

export type WorkspaceRow = {
  key: string;
  projectId: string;
  engagementId: string | null;
  name: string;
  account: string | null; // set when this row is a stream under a multi-engagement project
  customerName: string;
  isEngagement: boolean;
  /** Project closed/cancelled, or the end customer marked completed — no nudges, sorted out of the way. */
  completed: boolean;
  rag: RagStatus;
  ragLabel: string;
  lastStatusDays: number | null; // days since last status report (null = never)
  lastStatusDraft: boolean;
  statusDue: boolean;
  /** Why a workspace is (not) chased: ADHOC cadence and programme-level "Overall" are exempt by design. */
  tracking: "TRACKED" | "ADHOC" | "OFF";
  openIssues: number;
  overdueTasks: number;
  progress: number | null; // latest reported progress %
  /** Plan finish vs baseline finish in days (+ = late), over baselined tasks; null when not baselined. */
  slipDays: number | null;
  statusLine: string; // one-line current status (from the latest report, or a derived state)
  nextMilestone: string | null; // e.g. "UAT · Oct 20" — the soonest upcoming plan milestone/task
};

// Category grouping for the My Day path so repeated items read as one tracked group.
export type DayGroupKey = "golive" | "status" | "issues" | "plan" | "meetings" | "hygiene";
export const DAY_GROUP: Record<DayItemKind, { key: DayGroupKey; label: string }> = {
  UAT_SCRIPT_DUE: { key: "golive", label: "Go-live & UAT" },
  CUTOVER_DUE: { key: "golive", label: "Go-live & UAT" },
  NO_STATUS: { key: "status", label: "Status updates" },
  STATUS_DUE: { key: "status", label: "Status updates" },
  ISSUE_DUE: { key: "issues", label: "Issues to handle" },
  ISSUE_OPEN: { key: "issues", label: "Issues to handle" },
  PLAN_OVERDUE: { key: "plan", label: "Plan slipping" },
  ACTION_OVERDUE: { key: "meetings", label: "Meeting actions" },
  HYGIENE: { key: "hygiene", label: "Data hygiene" },
};
export const DAY_GROUP_ORDER: DayGroupKey[] = ["golive", "status", "issues", "plan", "meetings", "hygiene"];

export type UpcomingItem = {
  id: string;
  dateLabel: string;
  daysAway: number;
  title: string;
  context: string;
  tag: "Status" | "Milestone" | "Task" | "Action";
  projectId: string;
  engagementId: string | null;
  tab: string;
};

// Default coaching per check kind. `how` is deliberately plain-English and small-company — a nudge
// with a "here's how", not policy. (Later these become editable, SOP-cited entries.)
export const DAY_HINT: Record<DayItemKind, { cta: string; tab: string; how: string }> = {
  UAT_SCRIPT_DUE: {
    cta: "Open UAT scripts",
    tab: "",
    how: "The customer test script must be prepared and sent before UAT. The consultant owns it — check it's ready and mark it Sent.",
  },
  CUTOVER_DUE: {
    cta: "Open cutover",
    tab: "",
    how: "UAT is accepted (or go-live is close) but the cutover to production isn't finished. The assigned consultant runs it — open the plan and chase the remaining steps.",
  },
  NO_STATUS: {
    cta: "Build update",
    tab: "status",
    how: "This active customer has no status update yet. Open \"New status update\": the period, cadence and this week's approved hours are filled in — write the current status, set the health, and send it.",
  },
  STATUS_DUE: {
    cta: "Build update",
    tab: "status",
    how: "A status update is due. \"New status update\" starts from the last one — same cadence and health, last progress figure, and every still-open action carried over — with the period and approved hours filled in. Rewrite the current status, check the health and progress, send.",
  },
  PLAN_OVERDUE: {
    cta: "Open plan",
    tab: "plan",
    how: "A plan task is past its date. Ask the owner for a new date and update the plan so the customer view stays honest.",
  },
  ISSUE_DUE: {
    cta: "Open issue",
    tab: "raid",
    how: "An open issue is past its target date — push it forward or resolve it, and note what you're doing about it.",
  },
  ISSUE_OPEN: {
    cta: "Review issue",
    tab: "raid",
    how: "A high-severity issue is open. Give it an owner and a next step so it doesn't stall.",
  },
  ACTION_OVERDUE: {
    cta: "Open minutes",
    tab: "minutes",
    how: "An action item from a meeting is overdue. Chase the owner, or tick it off if it's done.",
  },
  HYGIENE: {
    cta: "Fix it",
    tab: "",
    how: "Something the project record should have is missing or out of date. The link opens the exact field — fill it in and the item disappears.",
  },
};

export const PRIORITY_RANK: Record<DayPriority, number> = { CRIT: 0, WARN: 1, INFO: 2 };

// Days a status update may lapse before it's "due", by cadence.
export function cadenceDays(cadence: string | null | undefined): number | null {
  if (cadence === "MONTHLY") return 30;
  if (cadence === "ADHOC") return null; // ad-hoc = never auto-nudged
  return 7; // WEEKLY / default
}
