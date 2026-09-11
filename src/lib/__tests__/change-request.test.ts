import { describe, it, expect } from "vitest";
import {
  CR_FLOW, asCrStage, crMoveKind, nextStage, exitChecks, decideCrMove, timeInStages, formatDuration, nextStepState,
  type CrRecord, type CrStageKey,
} from "@/lib/change-request";

const EMPTY: CrRecord = {
  assessment: null, estimateHours: null, approvedByName: null, approvedOn: null, assigneeId: null, plannedGoLive: null,
  unitTestNotes: null, evidence: {}, uatSignedOffBy: null, uatSignedOffOn: null, goLiveOn: null, resolution: null,
};
const FULL: CrRecord = {
  assessment: "New field on the MIRO screen", estimateHours: 16, approvedByName: "M. Rossi", approvedOn: "2026-09-01",
  assigneeId: "u1", plannedGoLive: "2026-10-01", unitTestNotes: "All six scenarios pass", evidence: {},
  uatSignedOffBy: "M. Rossi", uatSignedOffOn: "2026-09-20", goLiveOn: "2026-10-01", resolution: "Live, no issues in hypercare",
};
const failing = (checks: { key: string; ok: boolean }[]) => checks.filter((c) => !c.ok).map((c) => c.key);

describe("stage moves", () => {
  it("goes forward one stage at a time", () => {
    for (let i = 0; i < CR_FLOW.length - 1; i++) expect(crMoveKind(CR_FLOW[i], CR_FLOW[i + 1])).toEqual({ ok: true, kind: "FORWARD" });
    const skip = crMoveKind("evaluation", "unit_testing");
    expect(skip.ok ? "" : skip.reason).toMatch(/one stage at a time — the next stage is Development/);
  });
  it("goes back to any earlier stage", () => {
    expect(crMoveKind("uat", "development")).toEqual({ ok: true, kind: "BACK" });
    expect(crMoveKind("closing", "evaluation")).toEqual({ ok: true, kind: "BACK" });
  });
  it("rejects from any open stage, never from an end state", () => {
    for (const s of ["evaluation", "development", "unit_testing", "uat", "go_live", "closing"] as CrStageKey[]) {
      expect(crMoveKind(s, "rejected")).toEqual({ ok: true, kind: "REJECT" });
    }
    expect(crMoveKind("closed", "rejected").ok).toBe(false);
  });
  it("reopens Closed into Closing and Rejected into Evaluation only", () => {
    expect(crMoveKind("closed", "closing")).toEqual({ ok: true, kind: "REOPEN" });
    expect(crMoveKind("rejected", "evaluation")).toEqual({ ok: true, kind: "REOPEN" });
    expect(crMoveKind("closed", "evaluation").ok).toBe(false);
    expect(crMoveKind("rejected", "development").ok).toBe(false);
  });
  it("refuses a move to the stage it is in", () => {
    const same = crMoveKind("uat", "uat");
    expect(same.ok ? "" : same.reason).toMatch(/already in UAT/);
  });
  it("knows the next stage and the stage keys", () => {
    expect(nextStage("evaluation")).toBe("development");
    expect(nextStage("closing")).toBe("closed");
    expect(nextStage("closed")).toBeNull();
    expect(nextStage("rejected")).toBeNull();
    expect(asCrStage("go_live")).toBe("go_live");
    expect(asCrStage("submitted")).toBeNull();
    expect(asCrStage(null)).toBeNull();
  });
});

describe("exit checks", () => {
  it.each([
    ["evaluation", ["assessment", "estimate", "approval"]],
    ["development", ["developer", "plannedGoLive"]],
    ["unit_testing", ["unitTest"]],
    ["uat", ["uatSignOff"]],
    ["go_live", ["goLive"]],
    ["closing", ["closingSummary"]],
  ] as [CrStageKey, string[]][])("an empty record fails every %s check", (stage, keys) => {
    expect(failing(exitChecks(stage, EMPTY))).toEqual(keys);
  });
  it("a complete record passes every stage", () => {
    for (const s of CR_FLOW) expect(failing(exitChecks(s, FULL))).toEqual([]);
  });
  it("approval and UAT sign-off need both the name and the date", () => {
    expect(failing(exitChecks("evaluation", { ...FULL, approvedOn: null }))).toEqual(["approval"]);
    expect(failing(exitChecks("evaluation", { ...FULL, approvedByName: "  " }))).toEqual(["approval"]);
    expect(failing(exitChecks("uat", { ...FULL, uatSignedOffOn: null }))).toEqual(["uatSignOff"]);
  });
  it("a zero estimate doesn't count", () => {
    expect(failing(exitChecks("evaluation", { ...FULL, estimateHours: 0 }))).toEqual(["estimate"]);
  });
  it("evidence filed under Unit testing stands in for the notes; evidence elsewhere doesn't", () => {
    expect(failing(exitChecks("unit_testing", { ...FULL, unitTestNotes: " ", evidence: { unit_testing: 1 } }))).toEqual([]);
    expect(failing(exitChecks("unit_testing", { ...FULL, unitTestNotes: null, evidence: { uat: 2 } }))).toEqual(["unitTest"]);
  });
  it("Closed and Rejected have no exit checks", () => {
    expect(exitChecks("closed", EMPTY)).toEqual([]);
    expect(exitChecks("rejected", EMPTY)).toEqual([]);
  });
});

describe("deciding a move", () => {
  const team = { canManage: true, involved: false };
  const outsiderOnTicket = { canManage: false, involved: true };

  it("forward with every check green goes through", () => {
    expect(decideCrMove({ from: "uat", to: "go_live", record: FULL, ...outsiderOnTicket })).toMatchObject({ ok: true, kind: "FORWARD", overridden: false });
  });
  it("forward with red checks is blocked and names them", () => {
    const d = decideCrMove({ from: "evaluation", to: "development", record: EMPTY, ...team });
    expect(d.ok).toBe(false);
    expect(d.ok ? "" : d.error).toMatch(/^3 checks not met: Impact assessment written; Effort estimated; Customer approval recorded\.$/);
    expect(d.failing).toHaveLength(3);
  });
  it("the support team can go ahead with a written override; someone only on the ticket can't", () => {
    const rec = { ...FULL, approvedOn: null };
    expect(decideCrMove({ from: "evaluation", to: "development", record: rec, ...outsiderOnTicket, overrideReason: "Approved on the call" }).ok).toBe(false);
    expect(decideCrMove({ from: "evaluation", to: "development", record: rec, ...team, overrideReason: "Approved on the call" })).toMatchObject({ ok: true, overridden: true });
    expect(decideCrMove({ from: "evaluation", to: "development", record: rec, ...team, overrideReason: "  " }).ok).toBe(false);
  });
  it("going back needs a reason, from the team or someone on the ticket", () => {
    const noWhy = decideCrMove({ from: "uat", to: "development", record: FULL, ...outsiderOnTicket });
    expect(noWhy.ok ? "" : noWhy.error).toMatch(/Say why it goes back to Development/);
    expect(decideCrMove({ from: "uat", to: "development", record: FULL, ...outsiderOnTicket, note: "Defect in scenario 3" })).toMatchObject({ ok: true, kind: "BACK" });
  });
  it("rejecting and reopening are the team's call, with a reason", () => {
    expect(decideCrMove({ from: "evaluation", to: "rejected", record: EMPTY, ...outsiderOnTicket, note: "Too expensive" }).ok).toBe(false);
    expect(decideCrMove({ from: "evaluation", to: "rejected", record: EMPTY, ...team }).ok).toBe(false);
    expect(decideCrMove({ from: "evaluation", to: "rejected", record: EMPTY, ...team, note: "Too expensive" })).toMatchObject({ ok: true, kind: "REJECT" });
    expect(decideCrMove({ from: "closed", to: "closing", record: FULL, ...team, note: "Posting error in production" })).toMatchObject({ ok: true, kind: "REOPEN" });
  });
  it("nobody outside the team and the ticket can move it, and illegal jumps fail whatever the rights", () => {
    expect(decideCrMove({ from: "uat", to: "go_live", record: FULL, canManage: false, involved: false }).ok).toBe(false);
    expect(decideCrMove({ from: "evaluation", to: "uat", record: FULL, ...team, overrideReason: "urgent" }).ok).toBe(false);
  });
});

describe("time in stage", () => {
  const events = [
    { toKey: "evaluation", at: "2026-09-01T09:00:00.000Z" },
    { toKey: "development", at: "2026-09-03T09:00:00.000Z" },
    { toKey: "unit_testing", at: "2026-09-04T09:00:00.000Z" },
    { toKey: "development", at: "2026-09-05T09:00:00.000Z" },
  ];
  const DAY = 86_400_000;
  it("sums every visit and counts the open stage up to now, in any input order", () => {
    const t = timeInStages([...events].reverse(), "2026-09-06T09:00:00.000Z");
    expect(t).toEqual({ evaluation: 2 * DAY, development: 2 * DAY, unit_testing: DAY });
  });
  it("stops counting once closed or rejected", () => {
    const t = timeInStages([...events, { toKey: "rejected", at: "2026-09-05T21:00:00.000Z" }], "2026-12-31T00:00:00.000Z");
    expect(t.development).toBe(DAY + DAY / 2);
    expect(t.rejected).toBeUndefined();
  });
  it("formats a duration in the largest whole unit", () => {
    expect(formatDuration(30 * 60_000)).toBe("<1h");
    expect(formatDuration(5 * 3_600_000)).toBe("5h");
    expect(formatDuration(49 * 3_600_000)).toBe("2d");
  });
});

describe("next step", () => {
  it("is overdue after its due date, due today on it, upcoming before, and none without a date", () => {
    expect(nextStepState(null, "2026-09-11")).toBe("none");
    expect(nextStepState("2026-09-10", "2026-09-11")).toBe("overdue");
    expect(nextStepState("2026-09-11", "2026-09-11")).toBe("today");
    expect(nextStepState("2026-09-12", "2026-09-11")).toBe("upcoming");
  });
});
