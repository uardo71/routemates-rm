import { describe, it, expect } from "vitest";
import {
  closeTarget, decideStageMove, earlierStages, gateChecks, nextStage, reopenTarget, sortStages,
  stageByKey, stageIndex, stageMoveKind, stageTimes, startingStage, type StageDef,
} from "@/lib/ticket-stages";

// The Bug stage set as migration 20260912090000 seeds it.
const BUG: StageDef[] = [
  { key: "triage", name: "Triage", description: "Confirm the defect.", order: 0, isStarting: true, isTerminal: false, gates: [
    { key: "reproduced", label: "Reproduced", description: null },
    { key: "severity_set", label: "Severity set", description: null },
  ] },
  { key: "in_progress", name: "In progress", description: null, order: 1, isStarting: false, isTerminal: false, gates: [] },
  { key: "fix_verification", name: "Fix verification", description: null, order: 2, isStarting: false, isTerminal: false, gates: [
    { key: "fix_verified", label: "Fix verified in test environment", description: null },
  ] },
  { key: "closed", name: "Closed", description: null, order: 3, isStarting: false, isTerminal: true, gates: [] },
];

const move = (from: string, to: string, extra: Partial<Parameters<typeof decideStageMove>[0]> = {}) =>
  decideStageMove({ stages: BUG, from, to, ticked: [], canManage: true, involved: true, ...extra });

describe("stage order", () => {
  it("sorts by order, breaking ties by key", () => {
    const tied: StageDef[] = [
      { key: "b", name: "B", description: null, order: 1, isStarting: false, isTerminal: false, gates: [] },
      { key: "a", name: "A", description: null, order: 1, isStarting: false, isTerminal: false, gates: [] },
    ];
    expect(sortStages(tied).map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("finds the starting stage, falling back to the first one", () => {
    expect(startingStage(BUG)?.key).toBe("triage");
    expect(startingStage(BUG.map((s) => ({ ...s, isStarting: false })))?.key).toBe("triage");
    expect(startingStage([])).toBeNull();
  });

  it("walks forward, backward and by index", () => {
    expect(nextStage(BUG, "triage")?.key).toBe("in_progress");
    expect(nextStage(BUG, "closed")).toBeNull();
    expect(earlierStages(BUG, "fix_verification").map((s) => s.key)).toEqual(["triage", "in_progress"]);
    expect(earlierStages(BUG, "triage")).toEqual([]);
    expect(stageIndex(BUG, "fix_verification")).toBe(2);
    expect(stageByKey(BUG, "nope")).toBeNull();
  });
});

describe("closing early and reopening", () => {
  it("offers the terminal stage as an escape only when it isn't already the next stage", () => {
    expect(closeTarget(BUG, "triage")?.key).toBe("closed");
    expect(closeTarget(BUG, "in_progress")?.key).toBe("closed");
    // From Fix verification, Closed IS the next stage — closing there is the gated forward move.
    expect(closeTarget(BUG, "fix_verification")).toBeNull();
    expect(closeTarget(BUG, "closed")).toBeNull();
  });

  it("reopens a terminal stage into the last open stage before it", () => {
    expect(reopenTarget(BUG, "closed")?.key).toBe("fix_verification");
    expect(reopenTarget(BUG, "triage")).toBeNull();
  });
});

describe("stageMoveKind", () => {
  it("names each legal move", () => {
    expect(stageMoveKind(BUG, "triage", "in_progress")).toEqual({ ok: true, kind: "FORWARD" });
    expect(stageMoveKind(BUG, "fix_verification", "triage")).toEqual({ ok: true, kind: "BACK" });
    expect(stageMoveKind(BUG, "triage", "closed")).toEqual({ ok: true, kind: "CLOSE" });
    expect(stageMoveKind(BUG, "fix_verification", "closed")).toEqual({ ok: true, kind: "FORWARD" });
    expect(stageMoveKind(BUG, "closed", "fix_verification")).toEqual({ ok: true, kind: "REOPEN" });
  });

  it("refuses a skip, a no-op, an unknown stage and a wrong reopen", () => {
    expect(stageMoveKind(BUG, "triage", "fix_verification")).toEqual({
      ok: false, reason: "A ticket moves one stage at a time — the next stage is In progress.",
    });
    expect(stageMoveKind(BUG, "triage", "triage")).toEqual({ ok: false, reason: "The ticket is already in Triage." });
    expect(stageMoveKind(BUG, "triage", "nope")).toEqual({ ok: false, reason: "Unknown stage." });
    expect(stageMoveKind(BUG, "nope", "triage").ok).toBe(false);
    expect(stageMoveKind(BUG, "closed", "triage")).toEqual({
      ok: false, reason: "A closed ticket can only be reopened into Fix verification.",
    });
  });
});

describe("gateChecks", () => {
  it("is green only where a gate has been ticked", () => {
    expect(gateChecks(stageByKey(BUG, "triage"), ["reproduced"])).toEqual([
      { key: "reproduced", label: "Reproduced", ok: true, hint: "Tick this once it's done." },
      { key: "severity_set", label: "Severity set", ok: false, hint: "Tick this once it's done." },
    ]);
    expect(gateChecks(stageByKey(BUG, "in_progress"), [])).toEqual([]);
    expect(gateChecks(null, ["reproduced"])).toEqual([]);
  });

  it("prefers the gate's own description as the hint", () => {
    const stage: StageDef = { ...BUG[0], gates: [{ key: "g", label: "G", description: "  Attach the log.  " }] };
    expect(gateChecks(stage, [])[0].hint).toBe("Attach the log.");
  });
});

describe("decideStageMove", () => {
  it("lets a forward move through once every gate is ticked", () => {
    expect(move("triage", "in_progress", { ticked: ["reproduced", "severity_set"] })).toEqual({
      ok: true, kind: "FORWARD", overridden: false, failing: [],
    });
  });

  it("blocks a forward move on the gates that are not ticked, and names them", () => {
    const r = move("triage", "in_progress", { ticked: ["reproduced"] });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe("1 check not met: Severity set.");
    expect(r.failing.map((c) => c.key)).toEqual(["severity_set"]);

    const none = move("triage", "in_progress");
    expect(none.ok === false && none.error).toBe("2 checks not met: Reproduced; Severity set.");
  });

  it("lets the support team go ahead with a written override, and nobody else", () => {
    expect(move("triage", "in_progress", { overrideReason: "Customer confirmed on the call" })).toMatchObject({
      ok: true, kind: "FORWARD", overridden: true,
    });
    const notTeam = move("triage", "in_progress", { canManage: false, overrideReason: "please" });
    expect(notTeam.ok === false && notTeam.error).toBe(
      "Only the client's support team can go ahead with checks not met (Reproduced; Severity set).",
    );
    // A blank override is no override — the failing-checks error stands.
    expect(move("triage", "in_progress", { overrideReason: "   " }).ok).toBe(false);
  });

  it("needs a reason to send a ticket back", () => {
    const bare = move("fix_verification", "triage");
    expect(bare.ok === false && bare.error).toBe("Say why it goes back to Triage.");
    expect(move("fix_verification", "triage", { note: "Fails on the second scenario" })).toMatchObject({ ok: true, kind: "BACK" });
    expect(move("fix_verification", "triage", { note: "no" }).ok).toBe(false);
  });

  it("keeps closing early and reopening with the support team, and needs a reason for both", () => {
    expect(move("triage", "closed", { note: "Not a defect — works as designed" })).toMatchObject({ ok: true, kind: "CLOSE" });
    const noNote = move("triage", "closed");
    expect(noNote.ok === false && noNote.error).toBe("Say why it goes straight to Closed.");
    const notTeam = move("triage", "closed", { canManage: false, note: "Not a defect" });
    expect(notTeam.ok === false && notTeam.error).toBe("Only the client's support team can close a ticket from here.");

    expect(move("closed", "fix_verification", { note: "Came back in production" })).toMatchObject({ ok: true, kind: "REOPEN" });
    const reopenNotTeam = move("closed", "fix_verification", { canManage: false, note: "Came back" });
    expect(reopenNotTeam.ok === false && reopenNotTeam.error).toBe("Only the client's support team can reopen a ticket from here.");
  });

  it("lets someone on the ticket move it forward, and turns away a bystander", () => {
    expect(move("triage", "in_progress", { canManage: false, involved: true, ticked: ["reproduced", "severity_set"] }).ok).toBe(true);
    const bystander = move("triage", "in_progress", { canManage: false, involved: false, ticked: ["reproduced", "severity_set"] });
    expect(bystander.ok === false && bystander.error).toBe("Only the client's support team or the people on this ticket can move it.");
  });

  it("refuses an illegal move before anything else", () => {
    expect(move("triage", "fix_verification", { note: "skip ahead" }).ok).toBe(false);
  });
});

describe("stageTimes", () => {
  const H = 3_600_000;
  it("sums every visit to a stage and counts the open one up to now", () => {
    const events = [
      { toKey: "triage", at: "2026-09-10T00:00:00.000Z" },
      { toKey: "in_progress", at: "2026-09-10T02:00:00.000Z" },
      { toKey: "triage", at: "2026-09-10T05:00:00.000Z" },
      { toKey: "in_progress", at: "2026-09-10T06:00:00.000Z" },
    ];
    expect(stageTimes(BUG, events, "2026-09-10T10:00:00.000Z")).toEqual({ triage: 3 * H, in_progress: 7 * H });
  });

  it("stops the clock on a terminal stage and ignores stages it doesn't know", () => {
    const events = [
      { toKey: "triage", at: "2026-09-10T00:00:00.000Z" },
      { toKey: "gone", at: "2026-09-10T01:00:00.000Z" },
      { toKey: "closed", at: "2026-09-10T02:00:00.000Z" },
    ];
    expect(stageTimes(BUG, events, "2026-09-12T00:00:00.000Z")).toEqual({ triage: 1 * H });
  });

  it("reads events in time order however they arrive", () => {
    const events = [
      { toKey: "in_progress", at: "2026-09-10T02:00:00.000Z" },
      { toKey: "triage", at: "2026-09-10T00:00:00.000Z" },
    ];
    expect(stageTimes(BUG, events, "2026-09-10T03:00:00.000Z")).toEqual({ triage: 2 * H, in_progress: 1 * H });
  });
});
