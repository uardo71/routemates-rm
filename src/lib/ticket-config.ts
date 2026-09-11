import type { TicketStatusCategory, TicketFieldKind } from "@prisma/client";

// Pure, client+server-safe configuration vocabulary for the ticketing platform.
// The actual per-company configuration lives in the DB (TicketTypeDef / TicketStatusDef /
// TicketFieldDef); this module holds the fixed vocabulary, the colour palette, and the default
// seed used the first time a company opens the module.

// ---------- Status category (semantic bucket) ----------

export const STATUS_CATEGORIES: TicketStatusCategory[] = ["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"];
export const STATUS_CATEGORY_LABEL: Record<TicketStatusCategory, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  CANCELLED: "Cancelled",
};
/** Open categories keep SLA clocks running and count as "active" on lists/boards. */
export function isOpenCategory(c: TicketStatusCategory): boolean {
  return c === "OPEN" || c === "IN_PROGRESS";
}

// ---------- Custom field kinds ----------

export const FIELD_KINDS: TicketFieldKind[] = ["TEXT", "TEXTAREA", "NUMBER", "DATE", "SELECT", "MULTISELECT", "CHECKBOX", "USER"];
export const FIELD_KIND_LABEL: Record<TicketFieldKind, string> = {
  TEXT: "Text",
  TEXTAREA: "Long text",
  NUMBER: "Number",
  DATE: "Date",
  SELECT: "Dropdown",
  MULTISELECT: "Multi-select",
  CHECKBOX: "Checkbox",
  USER: "Person",
};
export function fieldNeedsOptions(k: TicketFieldKind): boolean {
  return k === "SELECT" || k === "MULTISELECT";
}

// ---------- Colour palette (literal class sets — never build Tailwind classes at runtime) ----------

export type StatusColor =
  | "slate" | "gray" | "violet" | "indigo" | "sky" | "blue" | "cyan" | "teal"
  | "emerald" | "green" | "lime" | "amber" | "orange" | "rose" | "red" | "fuchsia";

export const STATUS_COLOR_NAMES: StatusColor[] = [
  "slate", "gray", "violet", "indigo", "sky", "blue", "cyan", "teal",
  "emerald", "green", "lime", "amber", "orange", "rose", "red", "fuchsia",
];

type ColorSet = { chip: string; dot: string; column: string };
export const STATUS_COLOR_CLASSES: Record<StatusColor, ColorSet> = {
  slate: { chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300", dot: "bg-slate-500", column: "border-t-slate-400" },
  gray: { chip: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/50", column: "border-t-muted-foreground/40" },
  violet: { chip: "bg-violet-500/15 text-violet-700 dark:text-violet-400", dot: "bg-violet-500", column: "border-t-violet-500" },
  indigo: { chip: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400", dot: "bg-indigo-500", column: "border-t-indigo-500" },
  sky: { chip: "bg-sky-500/15 text-sky-700 dark:text-sky-400", dot: "bg-sky-500", column: "border-t-sky-500" },
  blue: { chip: "bg-blue-500/15 text-blue-700 dark:text-blue-400", dot: "bg-blue-500", column: "border-t-blue-500" },
  cyan: { chip: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400", dot: "bg-cyan-500", column: "border-t-cyan-500" },
  teal: { chip: "bg-teal-500/15 text-teal-700 dark:text-teal-400", dot: "bg-teal-500", column: "border-t-teal-500" },
  emerald: { chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500", column: "border-t-emerald-500" },
  green: { chip: "bg-green-500/15 text-green-700 dark:text-green-400", dot: "bg-green-500", column: "border-t-green-500" },
  lime: { chip: "bg-lime-500/15 text-lime-700 dark:text-lime-500", dot: "bg-lime-500", column: "border-t-lime-500" },
  amber: { chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", dot: "bg-amber-500", column: "border-t-amber-500" },
  orange: { chip: "bg-orange-500/15 text-orange-700 dark:text-orange-400", dot: "bg-orange-500", column: "border-t-orange-500" },
  rose: { chip: "bg-rose-500/15 text-rose-700 dark:text-rose-400", dot: "bg-rose-500", column: "border-t-rose-500" },
  red: { chip: "bg-red-500/15 text-red-700 dark:text-red-400", dot: "bg-red-500", column: "border-t-red-500" },
  fuchsia: { chip: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400", dot: "bg-fuchsia-500", column: "border-t-fuchsia-500" },
};
export function statusColor(name: string | null | undefined): ColorSet {
  return STATUS_COLOR_CLASSES[(name as StatusColor)] ?? STATUS_COLOR_CLASSES.gray;
}

// ---------- Type icons (string keys → resolved in the client icon registry) ----------

export const TYPE_ICON_KEYS = ["incident", "service", "change", "problem", "question", "bug", "task", "ticket"] as const;
export type TypeIconKey = (typeof TYPE_ICON_KEYS)[number];

// ---------- Default seed configuration ----------

export type SeedStatus = {
  key: string; name: string; color: StatusColor; category: TicketStatusCategory;
  isInitial?: boolean; customerVisible?: boolean; customerCanSet?: boolean;
};
export type SeedField = {
  key: string; name: string; kind: TicketFieldKind; options?: string[];
  required?: boolean; customerVisible?: boolean; customerEditable?: boolean;
};
export type SeedType = {
  key: string; name: string; description?: string; icon: TypeIconKey; color: StatusColor;
  isDefault?: boolean; customerCanCreate?: boolean; slaExempt?: boolean; statuses: SeedStatus[]; fields?: SeedField[];
};

// A generic support workflow reused by several types.
const SUPPORT_FLOW: SeedStatus[] = [
  { key: "new", name: "New", color: "violet", category: "OPEN", isInitial: true },
  { key: "in_progress", name: "In progress", color: "sky", category: "IN_PROGRESS", customerCanSet: true },
  { key: "on_hold", name: "On hold", color: "amber", category: "IN_PROGRESS" },
  { key: "waiting_customer", name: "Waiting for customer", color: "orange", category: "IN_PROGRESS" },
  { key: "resolved", name: "Resolved", color: "emerald", category: "DONE" },
  { key: "closed", name: "Closed", color: "gray", category: "DONE", customerCanSet: true },
  { key: "cancelled", name: "Cancelled", color: "slate", category: "CANCELLED", customerVisible: false },
];

export const DEFAULT_TICKET_CONFIG: SeedType[] = [
  {
    key: "incident", name: "Incident", icon: "incident", color: "rose", isDefault: true,
    description: "Something is broken or degraded and needs to be restored.",
    statuses: [
      { key: "new", name: "New", color: "violet", category: "OPEN", isInitial: true },
      { key: "investigating", name: "Investigating", color: "sky", category: "IN_PROGRESS", customerCanSet: true },
      { key: "identified", name: "Identified", color: "blue", category: "IN_PROGRESS" },
      { key: "monitoring", name: "Monitoring", color: "cyan", category: "IN_PROGRESS" },
      { key: "resolved", name: "Resolved", color: "emerald", category: "DONE" },
      { key: "closed", name: "Closed", color: "gray", category: "DONE", customerCanSet: true },
      { key: "cancelled", name: "Cancelled", color: "slate", category: "CANCELLED", customerVisible: false },
    ],
  },
  {
    key: "service_request", name: "Service request", icon: "service", color: "sky", customerCanCreate: true,
    description: "A request for access, information, or a standard change.",
    statuses: [
      { key: "new", name: "New", color: "violet", category: "OPEN", isInitial: true },
      { key: "approved", name: "Approved", color: "blue", category: "IN_PROGRESS" },
      { key: "in_progress", name: "In progress", color: "sky", category: "IN_PROGRESS" },
      { key: "fulfilled", name: "Fulfilled", color: "emerald", category: "DONE" },
      { key: "closed", name: "Closed", color: "gray", category: "DONE", customerCanSet: true },
      { key: "rejected", name: "Rejected", color: "red", category: "CANCELLED" },
    ],
  },
  {
    key: "change_request", name: "Change request", icon: "change", color: "indigo", customerCanCreate: true, slaExempt: true,
    description: "A change to be evaluated, developed, unit tested, accepted in UAT and taken live. No SLA — tracked by stage.",
    // The stage keys are load-bearing: src/lib/change-request.ts gates moves between them.
    statuses: [
      { key: "evaluation", name: "Evaluation", color: "violet", category: "OPEN", isInitial: true },
      { key: "development", name: "Development", color: "blue", category: "IN_PROGRESS" },
      { key: "unit_testing", name: "Unit testing", color: "cyan", category: "IN_PROGRESS" },
      { key: "uat", name: "UAT", color: "amber", category: "IN_PROGRESS" },
      { key: "go_live", name: "Go-live", color: "teal", category: "IN_PROGRESS" },
      { key: "closing", name: "Closing", color: "lime", category: "IN_PROGRESS" },
      { key: "closed", name: "Closed", color: "emerald", category: "DONE" },
      { key: "rejected", name: "Rejected", color: "red", category: "CANCELLED" },
    ],
    fields: [
      { key: "risk", name: "Risk", kind: "SELECT", options: ["Low", "Medium", "High"], customerVisible: true },
      { key: "change_window", name: "Change window", kind: "DATE", customerVisible: true },
      { key: "rollback_plan", name: "Rollback plan", kind: "TEXTAREA", customerVisible: false },
    ],
  },
  {
    key: "bug", name: "Bug", icon: "bug", color: "red", customerCanCreate: true,
    description: "A defect in delivered software.",
    statuses: [
      { key: "new", name: "New", color: "violet", category: "OPEN", isInitial: true },
      { key: "triaged", name: "Triaged", color: "amber", category: "OPEN" },
      { key: "in_progress", name: "In progress", color: "sky", category: "IN_PROGRESS", customerCanSet: true },
      { key: "in_review", name: "In review", color: "blue", category: "IN_PROGRESS" },
      { key: "fixed", name: "Fixed", color: "teal", category: "IN_PROGRESS" },
      { key: "verified", name: "Verified", color: "emerald", category: "DONE" },
      { key: "closed", name: "Closed", color: "gray", category: "DONE", customerCanSet: true },
      { key: "wont_fix", name: "Won't fix", color: "slate", category: "CANCELLED" },
    ],
    fields: [
      { key: "severity", name: "Severity", kind: "SELECT", options: ["Minor", "Major", "Critical"], customerVisible: true, customerEditable: true },
      { key: "environment", name: "Environment", kind: "SELECT", options: ["Dev", "QA", "Pre-prod", "Production"], customerVisible: true, customerEditable: true },
      { key: "steps", name: "Steps to reproduce", kind: "TEXTAREA", customerVisible: true, customerEditable: true },
    ],
  },
  {
    key: "task", name: "Task", icon: "task", color: "teal", customerCanCreate: false,
    description: "Internal work item, not customer-facing.",
    statuses: [
      { key: "todo", name: "To do", color: "slate", category: "OPEN", isInitial: true, customerVisible: false },
      { key: "in_progress", name: "In progress", color: "sky", category: "IN_PROGRESS", customerVisible: false },
      { key: "blocked", name: "Blocked", color: "rose", category: "IN_PROGRESS", customerVisible: false },
      { key: "done", name: "Done", color: "emerald", category: "DONE", customerVisible: false },
      { key: "cancelled", name: "Cancelled", color: "gray", category: "CANCELLED", customerVisible: false },
    ],
  },
  {
    key: "problem", name: "Problem", icon: "problem", color: "orange", customerCanCreate: false,
    description: "Root-cause investigation behind one or more incidents.",
    statuses: SUPPORT_FLOW,
  },
  {
    key: "question", name: "Question", icon: "question", color: "cyan", customerCanCreate: true,
    description: "A how-to or informational query.",
    statuses: [
      { key: "open", name: "Open", color: "violet", category: "OPEN", isInitial: true },
      { key: "answered", name: "Answered", color: "emerald", category: "IN_PROGRESS" },
      { key: "closed", name: "Closed", color: "gray", category: "DONE", customerCanSet: true },
    ],
  },
];
