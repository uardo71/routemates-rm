// Admin-editable behaviour for the operational alerts (see rules.ts for what each rule checks and
// run.ts for the daily runner). Pure — no Prisma — so both the rule predicates and the settings UI
// can import it. Stored as one JSON blob in AppSetting under the key "alerts" (settings.ts).

export type AlertsConfig = {
  /** Master switch. Off ⇒ the daily run evaluates nothing. */
  enabled: boolean;
  emailEnabled: boolean;
  teamsEnabled: boolean;
  rules: {
    /** Approved hours vs budgetHours, and internal cost vs budgetAmount, each crossing these %s. */
    project_budget: { enabled: boolean; thresholds: number[] };
    /** Days past dueDate at which an unpaid issued invoice is flagged. */
    invoice_overdue: { enabled: boolean; days: number[] };
    /** Timecards / expenses waiting for a decision longer than this many days. */
    approval_stale: { enabled: boolean; staleDays: number };
    /** Assignment end dates and customer PO expiries within this many days. */
    expiry: { enabled: boolean; days: number };
    /** Milestone endDate passed while not COMPLETE/INVOICED. */
    milestone_overdue: { enabled: boolean };
    /** A person's certification reaches each of these many days before expiryDate. */
    certification_expiry: { enabled: boolean; days: number[] };
    /** Status update past its cadence (1× and 2× tiers) → the PM. */
    status_overdue: { enabled: boolean };
    /** Open plan tasks past due, once per task per due date → PM + owner. */
    plan_slipping: { enabled: boolean };
    /** RAID items past due; HIGH/CRITICAL also reach admins. */
    issue_overdue: { enabled: boolean };
    /** UAT script not sent in the UAT window; cutover incomplete near go-live. */
    golive_readiness: { enabled: boolean };
    /** Weekly per-PM digest of everything needing attention (ISO weekday, 1 = Monday). */
    delivery_digest: { enabled: boolean; weekday: number };
    /** Weekly per-PM list of their failing data-hygiene checks (ISO weekday, 1 = Monday). */
    hygiene_weekly: { enabled: boolean; weekday: number };
  };
};

export const DEFAULT_ALERTS_CONFIG: AlertsConfig = {
  enabled: true,
  emailEnabled: true,
  teamsEnabled: true,
  rules: {
    project_budget: { enabled: true, thresholds: [80, 100] },
    invoice_overdue: { enabled: true, days: [1, 14, 30] },
    approval_stale: { enabled: true, staleDays: 3 },
    expiry: { enabled: true, days: 30 },
    milestone_overdue: { enabled: true },
    certification_expiry: { enabled: true, days: [90, 30] },
    status_overdue: { enabled: true },
    plan_slipping: { enabled: true },
    issue_overdue: { enabled: true },
    golive_readiness: { enabled: true },
    delivery_digest: { enabled: true, weekday: 1 },
    hygiene_weekly: { enabled: true, weekday: 1 },
  },
};

export type AlertKind = keyof AlertsConfig["rules"];

export const ALERT_RULE_META: Record<AlertKind, { label: string; description: string; recipients: string }> = {
  project_budget: {
    label: "Project budget",
    description: "Approved hours cross a % of the project's budget hours, or internal cost crosses a % of its budget amount. Fires once per threshold.",
    recipients: "the project manager",
  },
  invoice_overdue: {
    label: "Invoice overdue",
    description: "An issued invoice with money outstanding is past its due date by each listed number of days. Fires once per tier.",
    recipients: "everyone who manages invoices",
  },
  approval_stale: {
    label: "Approvals waiting",
    description: "A submitted timecard, or a pending expense, has waited longer than the limit for a decision. Fires once per item.",
    recipients: "the approver (timecards) · expense managers (expenses)",
  },
  expiry: {
    label: "Expiring soon",
    description: "An active assignment's end date, or a won opportunity's PO validity, falls within the window. Re-fires if the date is moved.",
    recipients: "the project manager and the person / opportunity owner",
  },
  milestone_overdue: {
    label: "Milestone overdue",
    description: "A milestone's end date has passed and it is neither complete nor invoiced. Re-fires if the date is re-planned.",
    recipients: "the project manager",
  },
  certification_expiry: {
    label: "Certification expiring",
    description: "A person's certification is within each listed number of days of its expiry date. Fires once per tier; a renewed expiry date starts over.",
    recipients: "the person and everyone who manages users",
  },
  status_overdue: {
    label: "Status update overdue",
    description: "A customer-facing workspace is past its cadence (weekly / monthly) without a status update, or has never had one. Fires at one cadence and again at two.",
    recipients: "the project manager",
  },
  plan_slipping: {
    label: "Plan task overdue",
    description: "An open plan task is past its due date. Once per task per due date — re-planning it re-arms the alert.",
    recipients: "the project manager and the task owner",
  },
  issue_overdue: {
    label: "Issue past due",
    description: "An open RAID item is past its target date. High and critical ones also reach the administrators.",
    recipients: "the project manager, the owner, and admins for high/critical",
  },
  golive_readiness: {
    label: "Go-live readiness",
    description: "UAT is under way or within 30 days but no test script is sent; or go-live is within 14 days (or UAT accepted) and the cutover isn't finished.",
    recipients: "the project manager",
  },
  delivery_digest: {
    label: "Monday digest",
    description: "One email per project manager listing workspaces needing a status update, overdue tasks, issues past due and go-live items in the next 14 days, with links. Once per week.",
    recipients: "each project manager, about their own projects",
  },
  hygiene_weekly: {
    label: "Weekly hygiene",
    description: "One email per project manager listing the data-hygiene checks failing on their projects (missing PO, stale status, milestones past their end date…), each with a link to the field that fixes it. Projects with no manager go to the administrators. Once per week.",
    recipients: "each project manager, about their own projects · admins for unmanaged ones",
  },
};

/** Deep-merges a stored (possibly older/partial) config onto the defaults so every field has a value. */
export function mergeAlertsConfig(stored: unknown): AlertsConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<AlertsConfig> & { rules?: Partial<AlertsConfig["rules"]> };
  const d = DEFAULT_ALERTS_CONFIG;
  const nums = (v: unknown, fallback: number[]) =>
    Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n)) && v.length > 0 ? [...(v as number[])].sort((a, b) => a - b) : fallback;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const r: Partial<AlertsConfig["rules"]> = s.rules ?? {};
  return {
    enabled: bool(s.enabled, d.enabled),
    emailEnabled: bool(s.emailEnabled, d.emailEnabled),
    teamsEnabled: bool(s.teamsEnabled, d.teamsEnabled),
    rules: {
      project_budget: { enabled: bool(r.project_budget?.enabled, true), thresholds: nums(r.project_budget?.thresholds, d.rules.project_budget.thresholds) },
      invoice_overdue: { enabled: bool(r.invoice_overdue?.enabled, true), days: nums(r.invoice_overdue?.days, d.rules.invoice_overdue.days) },
      approval_stale: { enabled: bool(r.approval_stale?.enabled, true), staleDays: num(r.approval_stale?.staleDays, d.rules.approval_stale.staleDays) },
      expiry: { enabled: bool(r.expiry?.enabled, true), days: num(r.expiry?.days, d.rules.expiry.days) },
      milestone_overdue: { enabled: bool(r.milestone_overdue?.enabled, true) },
      certification_expiry: { enabled: bool(r.certification_expiry?.enabled, true), days: nums(r.certification_expiry?.days, d.rules.certification_expiry.days) },
      status_overdue: { enabled: bool(r.status_overdue?.enabled, true) },
      plan_slipping: { enabled: bool(r.plan_slipping?.enabled, true) },
      issue_overdue: { enabled: bool(r.issue_overdue?.enabled, true) },
      golive_readiness: { enabled: bool(r.golive_readiness?.enabled, true) },
      delivery_digest: { enabled: bool(r.delivery_digest?.enabled, true), weekday: (() => { const w = num(r.delivery_digest?.weekday, 1); return w >= 1 && w <= 7 ? Math.round(w) : 1; })() },
      hygiene_weekly: { enabled: bool(r.hygiene_weekly?.enabled, true), weekday: (() => { const w = num(r.hygiene_weekly?.weekday, 1); return w >= 1 && w <= 7 ? Math.round(w) : 1; })() },
    },
  };
}
