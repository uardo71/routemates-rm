import { describe, it, expect } from "vitest";
import {
  PROJECT_STATUSES, checkTransition, allowedTransitions, entryBlock, entryChangeBlock, invoiceBlock,
  readinessChecks, closureChecks, gateDecision, type ReadinessInput, type ClosureInput, type ProjectStatusKey,
} from "@/lib/project-stage";

describe("transitions", () => {
  const ALLOWED: [ProjectStatusKey, ProjectStatusKey, "any" | "admin"][] = [
    ["PLANNED", "ACTIVE", "any"], ["PLANNED", "CANCELLED", "any"],
    ["ACTIVE", "ON_HOLD", "any"], ["ACTIVE", "COMPLETED", "any"], ["ACTIVE", "CANCELLED", "any"],
    ["ON_HOLD", "ACTIVE", "any"], ["ON_HOLD", "CANCELLED", "any"],
    ["COMPLETED", "ACTIVE", "admin"],
    ["CANCELLED", "PLANNED", "admin"],
  ];
  const key = (a: string, b: string) => `${a}>${b}`;
  const allowed = new Map(ALLOWED.map(([a, b, who]) => [key(a, b), who]));

  it("allows exactly the listed pairs and refuses every other pair", () => {
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        const who = allowed.get(key(from, to));
        const admin = checkTransition(from, to, { isAdmin: true });
        const pm = checkTransition(from, to, { isAdmin: false });
        expect(admin.ok, `${from} -> ${to} (admin)`).toBe(!!who);
        expect(pm.ok, `${from} -> ${to} (pm)`).toBe(who === "any");
      }
    }
  });
  it("explains a refusal", () => {
    const same = checkTransition("ACTIVE", "ACTIVE", { isAdmin: true });
    expect(same.ok ? "" : same.reason).toMatch(/already Active/);
    const bad = checkTransition("PLANNED", "COMPLETED", { isAdmin: true });
    expect(bad.ok ? "" : bad.reason).toMatch(/can't go from Planned to Completed/);
    const reopen = checkTransition("COMPLETED", "ACTIVE", { isAdmin: false });
    expect(reopen.ok ? "" : reopen.reason).toMatch(/administrator/);
  });
  it("marks the gated moves and hides admin-only reopens from a PM", () => {
    expect(checkTransition("PLANNED", "ACTIVE", { isAdmin: false })).toMatchObject({ ok: true, rule: { gate: "readiness" } });
    expect(checkTransition("ACTIVE", "COMPLETED", { isAdmin: false })).toMatchObject({ ok: true, rule: { gate: "closure" } });
    expect(checkTransition("ON_HOLD", "ACTIVE", { isAdmin: false })).toMatchObject({ ok: true, rule: { to: "ACTIVE" } });
    expect(allowedTransitions("COMPLETED", false)).toEqual([]);
    expect(allowedTransitions("COMPLETED", true).map((r) => r.to)).toEqual(["ACTIVE"]);
    expect(allowedTransitions("CANCELLED", true).map((r) => r.to)).toEqual(["PLANNED"]);
  });
});

describe("the entry gate", () => {
  const p = (status: string, isInternal = false) => ({ name: "Pirelli DRC", status, isInternal });
  it("only ACTIVE projects take time, with a message naming the project and its status", () => {
    expect(entryBlock(p("ACTIVE"))).toBeNull();
    expect(entryBlock(p("ON_HOLD"))).toBe("Pirelli DRC is On hold — ask the PM to reactivate it before logging time.");
    expect(entryBlock(p("PLANNED"))).toMatch(/^Pirelli DRC is Planned/);
    expect(entryBlock(p("COMPLETED"))).toMatch(/^Pirelli DRC is Completed/);
    expect(entryBlock(p("CANCELLED"))).toMatch(/^Pirelli DRC is Cancelled/);
    expect(entryBlock(p("ON_HOLD"), "submitting time")).toMatch(/before submitting time/);
  });
  it("exemption 1: internal projects are never blocked, whatever their status", () => {
    for (const s of PROJECT_STATUSES) expect(entryBlock(p(s, true))).toBeNull();
    expect(entryChangeBlock({ ...p("CANCELLED", true), beforeHours: 0, afterHours: 8, alreadyApproved: false })).toBeNull();
  });
  it("exemption 2: existing approved time is never re-validated", () => {
    expect(entryChangeBlock({ ...p("COMPLETED"), beforeHours: 0, afterHours: 8, alreadyApproved: true })).toBeNull();
  });
  it("judges new writes only: an unchanged cell passes, a changed one is blocked", () => {
    expect(entryChangeBlock({ ...p("ON_HOLD"), beforeHours: 4, afterHours: 4, alreadyApproved: false })).toBeNull();
    expect(entryChangeBlock({ ...p("ON_HOLD"), beforeHours: 4, afterHours: 6, alreadyApproved: false })).toMatch(/On hold/);
    expect(entryChangeBlock({ ...p("ON_HOLD"), beforeHours: 0, afterHours: -2, alreadyApproved: false })).toMatch(/On hold/);
  });
  it("invoicing is refused for PLANNED and CANCELLED only", () => {
    expect(invoiceBlock(p("PLANNED"))).toMatch(/Planned/);
    expect(invoiceBlock(p("CANCELLED"))).toMatch(/Cancelled/);
    expect(invoiceBlock(p("ACTIVE"))).toBeNull();
    expect(invoiceBlock(p("ON_HOLD"))).toBeNull();
    expect(invoiceBlock(p("COMPLETED"))).toBeNull();
  });
});

const READY: ReadinessInput = {
  managerId: "pm", startDate: "2026-09-01", endDate: "2026-12-31", milestoneCount: 2, assignmentCount: 3,
  billingType: "FIXED_PRICE", contractValue: 185000, budgetAmount: null, sponsorContactId: "c1",
  sowNumber: "SOW-1", poNumber: "PO-9", poWaived: false,
};
const failing = (checks: { key: string; ok: boolean }[]) => checks.filter((c) => !c.ok).map((c) => c.key);

describe("Prepare for Delivery (readiness)", () => {
  it("a complete project passes every check", () => {
    expect(failing(readinessChecks(READY))).toEqual([]);
  });
  it.each([
    ["manager", { managerId: null }],
    ["dates", { endDate: null }],
    ["dates", { startDate: null }],
    ["milestones", { milestoneCount: 0 }],
    ["assignments", { assignmentCount: 0 }],
    ["commercials", { contractValue: 0, budgetAmount: null }],
    ["commercials", { billingType: null }],
    ["sponsor", { sponsorContactId: null }],
    ["sow", { sowNumber: "  " }],
    ["po", { poNumber: null }],
  ] as [string, Partial<ReadinessInput>][])("fails only %s when that data is missing", (key, patch) => {
    expect(failing(readinessChecks({ ...READY, ...patch }))).toEqual([key]);
  });
  it("a budget amount stands in for the contract value, and a PO waiver for the PO", () => {
    expect(failing(readinessChecks({ ...READY, contractValue: null, budgetAmount: 5000 }))).toEqual([]);
    expect(failing(readinessChecks({ ...READY, poNumber: null, poWaived: true }))).toEqual([]);
  });
  it("names the missing date in the hint", () => {
    expect(readinessChecks({ ...READY, endDate: null }).find((c) => c.key === "dates")!.hint).toMatch(/end date/);
  });
});

const CLOSED: ClosureInput = {
  todayIso: "2026-09-11", openRaidCount: 0, lastStatusIso: "2026-09-01", uatStatus: "ACCEPTED", uatNotApplicable: false,
  milestones: [{ name: "Build", status: "COMPLETE", writtenOff: false }, { name: "Go-live", status: "INVOICED", writtenOff: false }],
  unbilledHours: 0, unbilledValue: 0, currency: "EUR", wipAcknowledged: false, submittedCardCount: 0,
};

describe("closure", () => {
  it("a finished project passes every check", () => {
    expect(failing(closureChecks(CLOSED))).toEqual([]);
  });
  it.each([
    ["raid", { openRaidCount: 1 }],
    ["status", { lastStatusIso: null }],
    ["status", { lastStatusIso: "2026-08-11" }], // 31 days
    ["uat", { uatStatus: "SENT" }],
    ["milestones", { milestones: [{ name: "Build", status: "ACTIVE", writtenOff: false }] }],
    ["wip", { unbilledHours: 4, unbilledValue: 200 }],
    ["timecards", { submittedCardCount: 2 }],
  ] as [string, Partial<ClosureInput>][])("fails only %s", (key, patch) => {
    expect(failing(closureChecks({ ...CLOSED, ...patch }))).toEqual([key]);
  });
  it("a status update exactly 30 days old still counts", () => {
    expect(failing(closureChecks({ ...CLOSED, lastStatusIso: "2026-08-12" }))).toEqual([]);
  });
  it("UAT not applicable, a written-off milestone and acknowledged WIP each satisfy their check", () => {
    expect(failing(closureChecks({ ...CLOSED, uatStatus: "NOT_STARTED", uatNotApplicable: true }))).toEqual([]);
    expect(failing(closureChecks({ ...CLOSED, milestones: [{ name: "Austria", status: "PLANNED", writtenOff: true }] }))).toEqual([]);
    expect(failing(closureChecks({ ...CLOSED, unbilledHours: 4, unbilledValue: 200, wipAcknowledged: true }))).toEqual([]);
  });
  it("the WIP hint carries the amount", () => {
    expect(closureChecks({ ...CLOSED, unbilledHours: 4, unbilledValue: 200 }).find((c) => c.key === "wip")!.hint).toMatch(/EUR 200\.00 \(4h\)/);
  });
});

describe("override path", () => {
  const red = readinessChecks({ ...READY, sponsorContactId: null });
  it("everything green passes without an override", () => {
    expect(gateDecision(readinessChecks(READY), { isAdmin: false })).toEqual({ ok: true, overridden: false });
  });
  it("failing checks block without a reason, and name what failed", () => {
    const d = gateDecision(red, { isAdmin: true });
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/1 check not met: Client sponsor named/);
    expect(gateDecision(red, { isAdmin: true, overrideReason: "   " }).ok).toBe(false);
  });
  it("only an admin can override, and only with a reason", () => {
    expect(gateDecision(red, { isAdmin: false, overrideReason: "Customer asked to start" })).toMatchObject({ ok: false });
    expect(gateDecision(red, { isAdmin: true, overrideReason: "Customer asked to start" })).toEqual({ ok: true, overridden: true });
  });
});

describe("clearing", () => {
  it("clearing a draft cell to zero is always allowed, even on a closed project", () => {
    expect(entryChangeBlock({ name: "Pirelli DRC", status: "COMPLETED", isInternal: false, beforeHours: 4, afterHours: 0, alreadyApproved: false })).toBeNull();
  });
});
