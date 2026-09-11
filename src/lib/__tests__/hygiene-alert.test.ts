import { describe, it, expect } from "vitest";
import { hygieneWeeklyRule, type AlertData, type IsSent } from "@/lib/alerts/rules";
import { DEFAULT_ALERTS_CONFIG } from "@/lib/alerts/config";
import type { HygieneProjectRow, HygieneRows } from "@/lib/hygiene";

const MONDAY = "2026-09-14";
const P = (o: Partial<HygieneProjectRow> = {}): HygieneProjectRow => ({
  id: "p1", name: "Pirelli DRC", clientId: "c1", clientName: "Pirelli", status: "ACTIVE", isInternal: false,
  managerId: "pm", endDate: "2026-12-31", poNumber: "PO-1", poWaived: false, budgetHours: 100, approvedHours: 20,
  sponsorContactId: "s1", lastStatusIso: "2026-09-10", openIssueCount: 0, hasWonOpportunity: true, ...o,
});
const data = (hygiene: HygieneRows, today = MONDAY): AlertData => ({
  today, projects: [], invoices: [], timecards: [], expenses: [], assignments: [], opportunities: [], milestones: [], certifications: [],
  delivery: { baseUrl: "https://psa.example", workspaces: [], planTasks: [], raidItems: [], projects: [] },
  hygiene,
});
const never: IsSent = () => false;
const cfg = DEFAULT_ALERTS_CONFIG.rules.hygiene_weekly;

describe("hygiene_weekly", () => {
  it("sends one email per PM, about their own failing checks, with deep links", () => {
    const rows = { projects: [P({ poNumber: null }), P({ id: "p2", name: "Beko", clientId: "c2", endDate: null }), P({ id: "p3", name: "Other", clientId: "c3", managerId: "pm2", poNumber: null })], milestones: [] };
    const out = hygieneWeeklyRule(data(rows), cfg, never);
    expect(out.map((a) => a.targetId).sort()).toEqual(["pm", "pm2"]);
    const pm = out.find((a) => a.targetId === "pm")!;
    expect(pm.recipients).toEqual([{ userId: "pm" }]);
    expect(pm.payloadKey).toBe("2026-W38");
    expect(pm.html).toContain("https://psa.example/projects/p1/edit#field-poNumber");
    expect(pm.html).toContain("Beko");
    expect(pm.html).not.toContain("Other");
  });
  it("only on the configured weekday", () => {
    const rows = { projects: [P({ poNumber: null })], milestones: [] };
    expect(hygieneWeeklyRule(data(rows, "2026-09-15"), cfg, never)).toEqual([]);
    expect(hygieneWeeklyRule(data(rows, "2026-09-15"), { ...cfg, weekday: 2 }, never)).toHaveLength(1);
  });
  it("never twice in the same week, and never when switched off or clean", () => {
    const rows = { projects: [P({ poNumber: null })], milestones: [] };
    expect(hygieneWeeklyRule(data(rows), cfg, (k, id, key) => k === "hygiene_weekly" && id === "pm" && key === "2026-W38")).toEqual([]);
    expect(hygieneWeeklyRule(data(rows), { ...cfg, enabled: false }, never)).toEqual([]);
    expect(hygieneWeeklyRule(data({ projects: [P()], milestones: [] }), cfg, never)).toEqual([]);
  });
  it("items with no manager go to the administrators", () => {
    const out = hygieneWeeklyRule(data({ projects: [P({ managerId: null })], milestones: [] }), cfg, never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ targetId: "unowned", recipients: [{ action: "users:manage" }] });
  });
});
