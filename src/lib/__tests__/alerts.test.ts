import { describe, it, expect } from "vitest";
import { DEFAULT_ALERTS_CONFIG, mergeAlertsConfig, type AlertsConfig } from "@/lib/alerts/config";
import {
  projectBudgetRule, invoiceOverdueRule, approvalStaleRule, expiryRule, milestoneOverdueRule,
  evaluateAll, daysBetween, type AlertData, type Alert,
} from "@/lib/alerts/rules";

const TODAY = "2026-09-10";
const cfg: AlertsConfig = DEFAULT_ALERTS_CONFIG;
const never = () => false;
/** A ledger-backed `isSent`, plus a helper that records what a run produced — the "already sent" case. */
function ledger() {
  const set = new Set<string>();
  return {
    isSent: (k: string, t: string, p: string) => set.has(`${k}|${t}|${p}`),
    record: (alerts: Alert[]) => alerts.forEach((a) => set.add(`${a.kind}|${a.targetId}|${a.payloadKey}`)),
  };
}
function data(o: Partial<AlertData> = {}): AlertData {
  return { today: TODAY, projects: [], invoices: [], timecards: [], expenses: [], assignments: [], opportunities: [], milestones: [], ...o };
}
const project = (o: Partial<AlertData["projects"][number]> = {}): AlertData["projects"][number] => ({
  id: "p1", number: "PR-0000001", name: "AFW", managerId: "pm", status: "ACTIVE",
  budgetHours: 100, budgetAmount: 10000, approvedHours: 0, internalCost: 0, currency: "EUR", ...o,
});

describe("daysBetween", () => {
  it("counts whole days at UTC midnight regardless of time-of-day", () => {
    expect(daysBetween("2026-09-01", "2026-09-10")).toBe(9);
    expect(daysBetween("2026-09-10T23:59:00.000Z", "2026-09-10")).toBe(0);
    expect(daysBetween("2026-09-12", "2026-09-10")).toBe(-2);
  });
});

describe("project budget", () => {
  it("fires at exactly the threshold, not just below it", () => {
    expect(projectBudgetRule(data({ projects: [project({ approvedHours: 79.9 })] }), cfg.rules.project_budget, never)).toHaveLength(0);
    const at80 = projectBudgetRule(data({ projects: [project({ approvedHours: 80 })] }), cfg.rules.project_budget, never);
    expect(at80.map((a) => a.payloadKey)).toEqual(["hours:80"]);
    expect(at80[0].recipients).toEqual([{ userId: "pm" }]);
  });

  it("crossing 100% fires both tiers, each keyed by its threshold", () => {
    const a = projectBudgetRule(data({ projects: [project({ approvedHours: 120 })] }), cfg.rules.project_budget, never);
    expect(a.map((x) => x.payloadKey).sort()).toEqual(["hours:100", "hours:80"]);
  });

  it("tracks hours and amount independently", () => {
    const a = projectBudgetRule(data({ projects: [project({ approvedHours: 10, internalCost: 8500 })] }), cfg.rules.project_budget, never);
    expect(a.map((x) => x.payloadKey)).toEqual(["amount:80"]);
  });

  it("is silent once sent — the second daily run produces nothing", () => {
    const l = ledger();
    const d = data({ projects: [project({ approvedHours: 85 })] });
    const first = projectBudgetRule(d, cfg.rules.project_budget, l.isSent);
    expect(first).toHaveLength(1);
    l.record(first);
    expect(projectBudgetRule(d, cfg.rules.project_budget, l.isSent)).toHaveLength(0);
    // …but a NEW threshold crossed later still fires.
    const later = projectBudgetRule(data({ projects: [project({ approvedHours: 101 })] }), cfg.rules.project_budget, l.isSent);
    expect(later.map((x) => x.payloadKey)).toEqual(["hours:100"]);
  });

  it("ignores projects with no manager, no budget, or already closed", () => {
    expect(projectBudgetRule(data({ projects: [project({ approvedHours: 200, managerId: null })] }), cfg.rules.project_budget, never)).toHaveLength(0);
    expect(projectBudgetRule(data({ projects: [project({ approvedHours: 200, budgetHours: null, budgetAmount: null })] }), cfg.rules.project_budget, never)).toHaveLength(0);
    expect(projectBudgetRule(data({ projects: [project({ approvedHours: 200, status: "COMPLETED" })] }), cfg.rules.project_budget, never)).toHaveLength(0);
  });

  it("respects the enable switch", () => {
    expect(projectBudgetRule(data({ projects: [project({ approvedHours: 200 })] }), { enabled: false, thresholds: [80] }, never)).toHaveLength(0);
  });
});

describe("invoice overdue", () => {
  const inv = (o: Partial<AlertData["invoices"][number]> = {}): AlertData["invoices"][number] => ({
    id: "i1", invoiceNumber: "INV-0007", clientName: "BEKO", status: "ISSUED", dueDate: "2026-09-09", outstanding: 1000, currency: "EUR", ...o,
  });

  it("fires the +1 tier the day after due, and nothing on the due date itself", () => {
    expect(invoiceOverdueRule(data({ invoices: [inv({ dueDate: TODAY })] }), cfg.rules.invoice_overdue, never)).toHaveLength(0);
    const a = invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-09-09" })] }), cfg.rules.invoice_overdue, never);
    expect(a.map((x) => x.payloadKey)).toEqual(["d1"]);
    expect(a[0].recipients).toEqual([{ action: "invoices:manage" }]);
  });

  it("13 days late is still only the +1 tier; 14 adds the second; 30 the third", () => {
    expect(invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-08-28" })] }), cfg.rules.invoice_overdue, never).map((x) => x.payloadKey)).toEqual(["d1"]);
    expect(invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-08-27" })] }), cfg.rules.invoice_overdue, never).map((x) => x.payloadKey)).toEqual(["d1", "d14"]);
    expect(invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-08-11" })] }), cfg.rules.invoice_overdue, never).map((x) => x.payloadKey)).toEqual(["d1", "d14", "d30"]);
  });

  it("suppresses tiers already sent but lets a newly-reached tier through", () => {
    const l = ledger();
    l.record(invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-09-01" })] }), cfg.rules.invoice_overdue, l.isSent)); // d1 sent
    const later = invoiceOverdueRule(data({ invoices: [inv({ dueDate: "2026-08-20" })] }), cfg.rules.invoice_overdue, l.isSent);
    expect(later.map((x) => x.payloadKey)).toEqual(["d14"]);
  });

  it("never nags about paid, draft, void, or settled invoices", () => {
    expect(invoiceOverdueRule(data({ invoices: [inv({ status: "PAID", dueDate: "2026-01-01" })] }), cfg.rules.invoice_overdue, never)).toHaveLength(0);
    expect(invoiceOverdueRule(data({ invoices: [inv({ status: "DRAFT", dueDate: "2026-01-01" })] }), cfg.rules.invoice_overdue, never)).toHaveLength(0);
    expect(invoiceOverdueRule(data({ invoices: [inv({ outstanding: 0, dueDate: "2026-01-01" })] }), cfg.rules.invoice_overdue, never)).toHaveLength(0);
    expect(invoiceOverdueRule(data({ invoices: [inv({ dueDate: null })] }), cfg.rules.invoice_overdue, never)).toHaveLength(0);
  });
});

describe("approvals waiting", () => {
  const tc = (o: Partial<AlertData["timecards"][number]> = {}): AlertData["timecards"][number] => ({
    id: "t1", userName: "Sindi", approverId: "pm", submittedAt: "2026-09-07T09:00:00.000Z", weekStartDate: "2026-08-31T00:00:00.000Z", status: "SUBMITTED", ...o,
  });
  const ex = (o: Partial<AlertData["expenses"][number]> = {}): AlertData["expenses"][number] => ({
    id: "e1", ownerName: "Iljona", amount: 42, currency: "EUR", createdAt: "2026-09-06T12:00:00.000Z", status: "PENDING", ...o,
  });

  it("fires at the limit (3 days) and not at 2", () => {
    expect(approvalStaleRule(data({ timecards: [tc({ submittedAt: "2026-09-08T00:00:00.000Z" })] }), cfg.rules.approval_stale, never)).toHaveLength(0);
    const a = approvalStaleRule(data({ timecards: [tc()] }), cfg.rules.approval_stale, never);
    expect(a).toHaveLength(1);
    expect(a[0].recipients).toEqual([{ userId: "pm" }]);
  });

  it("falls back to anyone who can approve when a timecard has no approver", () => {
    const a = approvalStaleRule(data({ timecards: [tc({ approverId: null })] }), cfg.rules.approval_stale, never);
    expect(a[0].recipients).toEqual([{ action: "timesheet:approve:any" }]);
  });

  it("covers pending expenses, to expense managers", () => {
    const a = approvalStaleRule(data({ expenses: [ex()] }), cfg.rules.approval_stale, never);
    expect(a).toHaveLength(1);
    expect(a[0].targetType).toBe("expense");
    expect(a[0].recipients).toEqual([{ action: "expenses:manage" }]);
  });

  it("only nags once per item, and only for items still waiting", () => {
    const l = ledger();
    const d = data({ timecards: [tc()], expenses: [ex()] });
    l.record(approvalStaleRule(d, cfg.rules.approval_stale, l.isSent));
    expect(approvalStaleRule(d, cfg.rules.approval_stale, l.isSent)).toHaveLength(0);
    expect(approvalStaleRule(data({ timecards: [tc({ status: "APPROVED" })], expenses: [ex({ status: "APPROVED" })] }), cfg.rules.approval_stale, never)).toHaveLength(0);
  });
});

describe("expiring soon", () => {
  const asg = (o: Partial<AlertData["assignments"][number]> = {}): AlertData["assignments"][number] => ({
    id: "a1", userId: "u1", userName: "Indri", milestoneName: "AFW", projectName: "Tungsten", projectManagerId: "pm", endDate: "2026-10-10T00:00:00.000Z", status: "ACTIVE", ...o,
  });
  const opp = (o: Partial<AlertData["opportunities"][number]> = {}): AlertData["opportunities"][number] => ({
    id: "o1", name: "Pirelli France", ownerId: "sales", poNumber: "PO-9", poValidUntil: "2026-10-01T00:00:00.000Z", stage: "WON", projectManagerId: "pm", ...o,
  });

  it("fires inside the 30-day window, including the edges, and not at 31", () => {
    expect(expiryRule(data({ assignments: [asg({ endDate: "2026-10-10" })] }), cfg.rules.expiry, never)).toHaveLength(1); // exactly 30
    expect(expiryRule(data({ assignments: [asg({ endDate: TODAY })] }), cfg.rules.expiry, never)).toHaveLength(1); // today
    expect(expiryRule(data({ assignments: [asg({ endDate: "2026-10-11" })] }), cfg.rules.expiry, never)).toHaveLength(0); // 31
    expect(expiryRule(data({ assignments: [asg({ endDate: "2026-09-01" })] }), cfg.rules.expiry, never)).toHaveLength(0); // already ended
  });

  it("goes to the PM and the person, de-duplicated when they're the same", () => {
    expect(expiryRule(data({ assignments: [asg()] }), cfg.rules.expiry, never)[0].recipients).toEqual([{ userId: "pm" }, { userId: "u1" }]);
    expect(expiryRule(data({ assignments: [asg({ userId: "pm" })] }), cfg.rules.expiry, never)[0].recipients).toEqual([{ userId: "pm" }]);
  });

  it("covers a won opportunity's PO validity, to the PM and the owner", () => {
    const a = expiryRule(data({ opportunities: [opp()] }), cfg.rules.expiry, never);
    expect(a).toHaveLength(1);
    expect(a[0].targetType).toBe("opportunity");
    expect(a[0].recipients).toEqual([{ userId: "pm" }, { userId: "sales" }]);
    expect(expiryRule(data({ opportunities: [opp({ stage: "NEGOTIATION" })] }), cfg.rules.expiry, never)).toHaveLength(0);
    expect(expiryRule(data({ opportunities: [opp({ poValidUntil: null })] }), cfg.rules.expiry, never)).toHaveLength(0);
  });

  it("is silent once sent, but re-fires if the date is moved", () => {
    const l = ledger();
    l.record(expiryRule(data({ assignments: [asg()] }), cfg.rules.expiry, l.isSent));
    expect(expiryRule(data({ assignments: [asg()] }), cfg.rules.expiry, l.isSent)).toHaveLength(0);
    expect(expiryRule(data({ assignments: [asg({ endDate: "2026-10-05" })] }), cfg.rules.expiry, l.isSent)).toHaveLength(1);
  });
});

describe("milestone overdue", () => {
  const ms = (o: Partial<AlertData["milestones"][number]> = {}): AlertData["milestones"][number] => ({
    id: "m1", name: "Go-live", projectName: "Pirelli", projectManagerId: "pm", endDate: "2026-09-09T00:00:00.000Z", status: "ACTIVE", ...o,
  });

  it("fires the day after the end date, not on it", () => {
    expect(milestoneOverdueRule(data({ milestones: [ms({ endDate: TODAY })] }), cfg.rules.milestone_overdue, never)).toHaveLength(0);
    const a = milestoneOverdueRule(data({ milestones: [ms()] }), cfg.rules.milestone_overdue, never);
    expect(a).toHaveLength(1);
    expect(a[0].recipients).toEqual([{ userId: "pm" }]);
  });

  it("leaves complete/invoiced milestones and undated ones alone", () => {
    expect(milestoneOverdueRule(data({ milestones: [ms({ status: "COMPLETE" })] }), cfg.rules.milestone_overdue, never)).toHaveLength(0);
    expect(milestoneOverdueRule(data({ milestones: [ms({ status: "INVOICED" })] }), cfg.rules.milestone_overdue, never)).toHaveLength(0);
    expect(milestoneOverdueRule(data({ milestones: [ms({ endDate: null })] }), cfg.rules.milestone_overdue, never)).toHaveLength(0);
    expect(milestoneOverdueRule(data({ milestones: [ms({ projectManagerId: null })] }), cfg.rules.milestone_overdue, never)).toHaveLength(0);
  });

  it("is silent once sent; re-planning the date re-fires", () => {
    const l = ledger();
    l.record(milestoneOverdueRule(data({ milestones: [ms()] }), cfg.rules.milestone_overdue, l.isSent));
    expect(milestoneOverdueRule(data({ milestones: [ms()] }), cfg.rules.milestone_overdue, l.isSent)).toHaveLength(0);
    expect(milestoneOverdueRule(data({ milestones: [ms({ endDate: "2026-09-05" })] }), cfg.rules.milestone_overdue, l.isSent)).toHaveLength(1);
  });
});

describe("evaluateAll + config", () => {
  it("the master switch silences every rule", () => {
    const d = data({ projects: [project({ approvedHours: 200 })], milestones: [{ id: "m", name: "x", projectName: "y", projectManagerId: "pm", endDate: "2026-01-01", status: "ACTIVE" }] });
    expect(evaluateAll(d, cfg, never).length).toBeGreaterThan(0);
    expect(evaluateAll(d, { ...cfg, enabled: false }, never)).toHaveLength(0);
  });

  it("a stored partial/garbled config merges onto sane defaults", () => {
    const m = mergeAlertsConfig({ rules: { project_budget: { thresholds: [100, 50] }, approval_stale: { staleDays: -1 } } });
    expect(m.rules.project_budget.thresholds).toEqual([50, 100]); // sorted
    expect(m.rules.project_budget.enabled).toBe(true);
    expect(m.rules.approval_stale.staleDays).toBe(3); // negative rejected
    expect(m.rules.invoice_overdue.days).toEqual([1, 14, 30]);
    expect(mergeAlertsConfig("junk").enabled).toBe(true);
  });
});
