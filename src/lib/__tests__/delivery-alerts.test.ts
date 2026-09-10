import { describe, it, expect } from "vitest";
import { DEFAULT_ALERTS_CONFIG, mergeAlertsConfig } from "@/lib/alerts/config";
import { statusOverdueRule, planSlippingRule, issueOverdueRule, goLiveReadinessRule, deliveryDigestRule, evaluateAll, type AlertData, type Alert } from "@/lib/alerts/rules";
import { statusChase, overduePlanTasks, overdueRaidItems, goLiveReadiness, isoWeek, isoWeekday, daysBetweenIso } from "@/lib/delivery-signals";

const TODAY = "2026-09-14"; // a Monday
const cfg = DEFAULT_ALERTS_CONFIG;
const never = () => false;
function ledger() {
  const set = new Set<string>();
  return {
    isSent: (k: string, t: string, p: string) => set.has(`${k}|${t}|${p}`),
    record: (alerts: Alert[]) => alerts.forEach((a) => set.add(`${a.kind}|${a.targetId}|${a.payloadKey}`)),
  };
}
type D = AlertData["delivery"];
const ws = (o: Partial<D["workspaces"][number]> = {}): D["workspaces"][number] => ({
  key: "p1:e1", projectId: "p1", projectName: "Tungsten", engagementId: "e1", engagementName: "BEKO", managerId: "pm",
  active: true, done: false, customerFacing: true, lastReportDateIso: "2026-09-01", cadence: "WEEKLY", sinceIso: "2026-06-01", ...o,
});
const task = (o: Partial<D["planTasks"][number]> = {}): D["planTasks"][number] => ({
  id: "t1", name: "Build interface", projectId: "p1", projectName: "Tungsten", engagementId: null, engagementName: null, managerId: "pm", ownerUserId: "ana",
  status: "IN_PROGRESS", progress: 40, isMilestone: false, dueDate: "2026-09-10", ...o,
});
const raid = (o: Partial<D["raidItems"][number]> = {}): D["raidItems"][number] => ({
  id: "r1", title: "Vendor delay", projectId: "p1", projectName: "Tungsten", engagementId: null, engagementName: null, managerId: "pm", ownerUserId: null,
  status: "OPEN", severity: "MEDIUM", dueDate: "2026-09-10", ...o,
});
const proj = (o: Partial<D["projects"][number]> = {}): D["projects"][number] => ({
  id: "p1", name: "Tungsten", managerId: "pm", active: true, done: false, uatStatus: "NOT_STARTED", uatAccepted: false, endDateIso: "2026-09-25", scripts: [], cutoverLeaves: [], ...o,
});
function data(d: Partial<D> = {}): AlertData {
  return {
    today: TODAY, projects: [], invoices: [], timecards: [], expenses: [], assignments: [], opportunities: [], milestones: [], certifications: [],
    delivery: { baseUrl: "https://psa.example", workspaces: [], planTasks: [], raidItems: [], projects: [], ...d },
  };
}

describe("shared delivery signals", () => {
  it("status chase: due strictly past one cadence, escalates past two, never for ad-hoc or non-customer-facing", () => {
    const base = { cadence: "WEEKLY", sinceIso: "2026-06-01", todayIso: TODAY, customerFacing: true, active: true, done: false };
    expect(statusChase({ ...base, lastReportDateIso: "2026-09-07" }).due).toBe(false); // exactly 7 days: not late
    expect(statusChase({ ...base, lastReportDateIso: "2026-09-06" })).toMatchObject({ due: true, tier: 1 });
    expect(statusChase({ ...base, lastReportDateIso: "2026-08-31" })).toMatchObject({ due: true, tier: 1 }); // 14 days: over 1×, exactly 2× — not yet escalated
    expect(statusChase({ ...base, lastReportDateIso: "2026-08-30" })).toMatchObject({ due: true, tier: 2 }); // 15 days: past 2×
    expect(statusChase({ ...base, lastReportDateIso: null })).toMatchObject({ due: true, neverReported: true, tier: 2 });
    expect(statusChase({ ...base, lastReportDateIso: "2026-08-01", cadence: "ADHOC" })).toMatchObject({ due: false, tracking: "ADHOC" });
    expect(statusChase({ ...base, lastReportDateIso: "2026-08-01", customerFacing: false })).toMatchObject({ due: false, tracking: "OFF" });
    expect(statusChase({ ...base, lastReportDateIso: "2026-08-01", done: true }).due).toBe(false);
  });
  it("plan / raid overdue: due today is not overdue; completed or 100% tasks and milestones never are", () => {
    expect(overduePlanTasks([task({ dueDate: TODAY }), task({ id: "y", dueDate: "2026-09-13" }), task({ id: "m", dueDate: "2026-09-01", isMilestone: true }), task({ id: "d", dueDate: "2026-09-01", progress: 100 })], TODAY).map((t) => t.id)).toEqual(["y"]);
    expect(overdueRaidItems([raid({ dueDate: TODAY }), raid({ id: "c", status: "CLOSED", dueDate: "2026-09-01" }), raid({ id: "late", dueDate: "2026-09-13" })], TODAY).map((r) => r.id)).toEqual(["late"]);
  });
  it("go-live readiness: UAT window at 30 days, cutover at 14 days or on acceptance", () => {
    const base = { active: true, done: false, uatStatus: "NOT_STARTED", uatAccepted: false, todayIso: TODAY, scripts: [], cutoverLeaves: [] };
    expect(goLiveReadiness({ ...base, endDateIso: "2026-10-15" })).toMatchObject({ daysToGoLive: 31, uatWindow: false, uatScriptDue: false, cutoverDue: false });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-10-14" })).toMatchObject({ daysToGoLive: 30, uatWindow: true, uatScriptDue: true, cutoverDue: false });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-09-29" })).toMatchObject({ daysToGoLive: 15, cutoverDue: false });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-09-28" })).toMatchObject({ daysToGoLive: 14, cutoverDue: true, cutoverUrgent: false });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-09-16" })).toMatchObject({ cutoverUrgent: true });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-12-01", uatAccepted: true })).toMatchObject({ cutoverDue: true });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-09-20", scripts: [{ status: "SENT" }], cutoverLeaves: [{ status: "DONE" }, { status: "SKIPPED" }] })).toMatchObject({ uatScriptDue: false, cutoverComplete: true, cutoverDue: false });
    expect(goLiveReadiness({ ...base, endDateIso: "2026-09-20", done: true }).cutoverDue).toBe(false);
  });
  it("ISO week and weekday", () => {
    expect(isoWeek("2026-09-14")).toBe("2026-W38");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeekday("2026-09-14")).toBe(1);
    expect(isoWeekday("2026-09-13")).toBe(7);
    expect(daysBetweenIso("2026-09-01", "2026-09-14")).toBe(13);
  });
});

describe("status_overdue", () => {
  it("fires tier 1 past one cadence and both tiers past two, keyed by the last report date", () => {
    expect(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-09-07" })] }), cfg.rules.status_overdue, never)).toHaveLength(0);
    const one = statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-09-05" })] }), cfg.rules.status_overdue, never);
    expect(one.map((a) => a.payloadKey)).toEqual(["2026-09-05:x1"]);
    expect(one[0].recipients).toEqual([{ userId: "pm" }]);
    expect(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-08-25" })] }), cfg.rules.status_overdue, never).map((a) => a.payloadKey)).toEqual(["2026-08-25:x1", "2026-08-25:x2"]);
  });
  it("never-reported workspaces are due at once; a new report resets the keys; suppression holds", () => {
    expect(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: null })] }), cfg.rules.status_overdue, never).map((a) => a.payloadKey)).toEqual(["first:x1", "first:x2"]);
    const l = ledger();
    l.record(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-08-25" })] }), cfg.rules.status_overdue, never));
    expect(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-08-25" })] }), cfg.rules.status_overdue, l.isSent)).toHaveLength(0);
    expect(statusOverdueRule(data({ workspaces: [ws({ lastReportDateIso: "2026-09-01" })] }), cfg.rules.status_overdue, l.isSent)).toHaveLength(1); // newer report → new key
  });
  it("skips workspaces without a PM, ad-hoc ones, and completed ones", () => {
    expect(statusOverdueRule(data({ workspaces: [ws({ managerId: null, lastReportDateIso: "2026-08-01" })] }), cfg.rules.status_overdue, never)).toHaveLength(0);
    expect(statusOverdueRule(data({ workspaces: [ws({ cadence: "ADHOC", lastReportDateIso: "2026-08-01" })] }), cfg.rules.status_overdue, never)).toHaveLength(0);
    expect(statusOverdueRule(data({ workspaces: [ws({ done: true, lastReportDateIso: "2026-08-01" })] }), cfg.rules.status_overdue, never)).toHaveLength(0);
  });
});

describe("plan_slipping", () => {
  it("once per task per due date, to the PM and the owner; due today is not yet slipping", () => {
    expect(planSlippingRule(data({ planTasks: [task({ dueDate: TODAY })] }), cfg.rules.plan_slipping, never)).toHaveLength(0);
    const a = planSlippingRule(data({ planTasks: [task({ dueDate: "2026-09-13" })] }), cfg.rules.plan_slipping, never);
    expect(a).toHaveLength(1);
    expect(a[0].payloadKey).toBe("2026-09-13");
    expect(a[0].recipients).toEqual([{ userId: "pm" }, { userId: "ana" }]);
    const l = ledger(); l.record(a);
    expect(planSlippingRule(data({ planTasks: [task({ dueDate: "2026-09-13" })] }), cfg.rules.plan_slipping, l.isSent)).toHaveLength(0);
    expect(planSlippingRule(data({ planTasks: [task({ dueDate: "2026-09-12" })] }), cfg.rules.plan_slipping, l.isSent)).toHaveLength(1); // re-planned → re-armed
    expect(planSlippingRule(data({ planTasks: [task({ dueDate: "2026-09-01", ownerUserId: null })] }), cfg.rules.plan_slipping, never)[0].recipients).toEqual([{ userId: "pm" }]);
  });
});

describe("issue_overdue", () => {
  it("escalates high/critical to admins, keys by due date, suppresses", () => {
    const med = issueOverdueRule(data({ raidItems: [raid({ dueDate: "2026-09-10" })] }), cfg.rules.issue_overdue, never);
    expect(med[0].recipients).toEqual([{ userId: "pm" }]);
    const high = issueOverdueRule(data({ raidItems: [raid({ dueDate: "2026-09-10", severity: "CRITICAL", ownerUserId: "ana" })] }), cfg.rules.issue_overdue, never);
    expect(high[0].recipients).toEqual([{ userId: "pm" }, { userId: "ana" }, { action: "users:manage" }]);
    expect(high[0].subject.startsWith("HIGH")).toBe(true);
    expect(issueOverdueRule(data({ raidItems: [raid({ dueDate: TODAY })] }), cfg.rules.issue_overdue, never)).toHaveLength(0);
    const l = ledger(); l.record(med);
    expect(issueOverdueRule(data({ raidItems: [raid({ dueDate: "2026-09-10" })] }), cfg.rules.issue_overdue, l.isSent)).toHaveLength(0);
  });
});

describe("golive_readiness", () => {
  it("UAT script alert keyed by UAT phase; cutover alert keyed by go-live date; both suppressed once sent", () => {
    const a = goLiveReadinessRule(data({ projects: [proj({ endDateIso: "2026-09-20" })] }), cfg.rules.golive_readiness, never);
    expect(a.map((x) => x.payloadKey).sort()).toEqual(["cutover:2026-09-20", "uat:NOT_STARTED"]);
    expect(goLiveReadinessRule(data({ projects: [proj({ endDateIso: "2026-10-30" })] }), cfg.rules.golive_readiness, never)).toHaveLength(0); // too far out
    const l = ledger(); l.record(a);
    expect(goLiveReadinessRule(data({ projects: [proj({ endDateIso: "2026-09-20" })] }), cfg.rules.golive_readiness, l.isSent)).toHaveLength(0);
    expect(goLiveReadinessRule(data({ projects: [proj({ endDateIso: "2026-09-20", uatStatus: "SENT" })] }), cfg.rules.golive_readiness, l.isSent).map((x) => x.payloadKey)).toEqual(["uat:SENT"]); // new phase re-fires
    expect(goLiveReadinessRule(data({ projects: [proj({ endDateIso: "2026-09-20", scripts: [{ status: "SENT" }], cutoverLeaves: [{ status: "DONE" }] })] }), cfg.rules.golive_readiness, never)).toHaveLength(0);
  });
});

describe("delivery_digest", () => {
  it("one per PM per ISO week, only on the configured weekday, with every section", () => {
    const d = data({ workspaces: [ws({ lastReportDateIso: "2026-08-25" })], planTasks: [task({ dueDate: "2026-09-10" })], raidItems: [raid({ dueDate: "2026-09-10" })], projects: [proj({ endDateIso: "2026-09-20" })] });
    const a = deliveryDigestRule(d, cfg.rules.delivery_digest, never);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ targetType: "user", targetId: "pm", payloadKey: "2026-W38", recipients: [{ userId: "pm" }] });
    expect(a[0].subject).toContain("4 things");
    expect(a[0].html).toContain("Status updates due (1)");
    expect(a[0].html).toContain("Go-live in the next 14 days (1)");
    expect(a[0].html).toContain("https://psa.example/delivery/p1?eng=e1&amp;tab=status");
    expect(deliveryDigestRule({ ...d, today: "2026-09-15" }, cfg.rules.delivery_digest, never)).toHaveLength(0); // Tuesday
    expect(deliveryDigestRule({ ...d, today: "2026-09-15" }, mergeAlertsConfig({ rules: { delivery_digest: { enabled: true, weekday: 2 } } }).rules.delivery_digest, never)).toHaveLength(1);
    const l = ledger(); l.record(a);
    expect(deliveryDigestRule(d, cfg.rules.delivery_digest, l.isSent)).toHaveLength(0);
  });
  it("a PM with nothing to do gets no digest", () => {
    expect(deliveryDigestRule(data({ workspaces: [ws({ lastReportDateIso: "2026-09-13" })] }), cfg.rules.delivery_digest, never)).toHaveLength(0);
  });
  it("all delivery rules are part of evaluateAll", () => {
    const d = data({ workspaces: [ws({ lastReportDateIso: "2026-08-25" })], planTasks: [task({ dueDate: "2026-09-10" })], raidItems: [raid({ dueDate: "2026-09-10" })], projects: [proj({ endDateIso: "2026-09-20" })] });
    const kinds = new Set(evaluateAll(d, cfg, never).map((a) => a.kind));
    expect([...kinds].sort()).toEqual(["delivery_digest", "golive_readiness", "issue_overdue", "plan_slipping", "status_overdue"]);
  });
});
