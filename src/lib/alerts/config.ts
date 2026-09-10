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
    },
  };
}
