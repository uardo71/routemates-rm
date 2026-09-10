import { describe, it, expect } from "vitest";
import { worstRag, ragDimensionsDiffer, phaseProgress, paginate, defaultPeriod, actionsToCarry, progressMismatch } from "@/lib/delivery";

describe("worstRag", () => {
  it("returns the worst of the given values, GREEN when nothing is given", () => {
    expect(worstRag()).toBe("GREEN");
    expect(worstRag("GREEN", "GREEN")).toBe("GREEN");
    expect(worstRag("GREEN", "AMBER", "GREEN")).toBe("AMBER");
    expect(worstRag("AMBER", "RED", null, undefined)).toBe("RED");
  });
  it("tells when the dimensions disagree with the overall", () => {
    expect(ragDimensionsDiffer({ overallRag: "GREEN", scheduleRag: "GREEN", budgetRag: "GREEN", scopeRag: "GREEN" })).toBe(false);
    expect(ragDimensionsDiffer({ overallRag: "GREEN", scheduleRag: "AMBER", budgetRag: "GREEN", scopeRag: "GREEN" })).toBe(true);
  });
});

describe("phaseProgress", () => {
  const t = (progress: number, start: string | null, due: string | null, isMilestone = false) => ({ progress, isMilestone, startDate: start, dueDate: due });
  it("weights by duration in days (inclusive)", () => {
    // 10-day task at 100% + 1-day task at 0% → 10/11 ≈ 91%, not the unweighted 50%
    expect(phaseProgress([t(100, "2026-09-01", "2026-09-10"), t(0, "2026-09-11", "2026-09-11")])).toBe(91);
  });
  it("falls back to the plain average when a task has no dates", () => {
    expect(phaseProgress([t(100, "2026-09-01", "2026-09-10"), t(0, null, null)])).toBe(50);
  });
  it("ignores milestones and returns 0 for an empty phase", () => {
    expect(phaseProgress([t(40, "2026-09-01", "2026-09-02"), t(0, "2026-09-30", "2026-09-30", true)])).toBe(40);
    expect(phaseProgress([])).toBe(0);
    expect(phaseProgress([t(0, "2026-09-30", "2026-09-30", true)])).toBe(0);
  });
  it("treats a due date before the start as a one-day task rather than a negative weight", () => {
    expect(phaseProgress([t(100, "2026-09-10", "2026-09-01"), t(0, "2026-09-01", "2026-09-01")])).toBe(50);
  });
});

describe("paginate", () => {
  it("splits into pages of the given size and never returns zero pages", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(paginate([1, 2], 30)).toEqual([[1, 2]]);
    expect(paginate([], 30)).toEqual([[]]);
  });
});

describe("status-report seeding", () => {
  it("weekly period is the 7 days ending on the report date", () => {
    expect(defaultPeriod("WEEKLY", "2026-09-11")).toEqual({ periodStart: "2026-09-05", periodEnd: "2026-09-11" });
    expect(defaultPeriod(null, "2026-09-11")).toEqual({ periodStart: "2026-09-05", periodEnd: "2026-09-11" });
  });
  it("monthly continues from the previous period, else from the 1st", () => {
    expect(defaultPeriod("MONTHLY", "2026-09-30", "2026-08-31")).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
    expect(defaultPeriod("MONTHLY", "2026-09-15")).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-09-15" });
    expect(defaultPeriod("MONTHLY", "2026-09-15", "2026-09-20")).toEqual({ periodStart: "2026-09-01", periodEnd: "2026-09-15" }); // stale previous period
  });
  it("ad-hoc only proposes a period when there is a previous one to continue from", () => {
    expect(defaultPeriod("ADHOC", "2026-09-11", "2026-09-01")).toEqual({ periodStart: "2026-09-02", periodEnd: "2026-09-11" });
    expect(defaultPeriod("ADHOC", "2026-09-11")).toEqual({ periodStart: "", periodEnd: "" });
  });
  it("carries open actions and those closed after the last report, drops the rest", () => {
    const acts = [
      { id: "open", done: false, doneAt: null },
      { id: "closed-after", done: true, doneAt: "2026-09-08T10:00:00.000Z" },
      { id: "closed-before", done: true, doneAt: "2026-09-01T10:00:00.000Z" },
      { id: "closed-same-day", done: true, doneAt: "2026-09-04T18:00:00.000Z" },
    ];
    expect(actionsToCarry(acts, "2026-09-04").map((a) => a.id)).toEqual(["open", "closed-after"]);
  });
  it("flags a report more than 15 points away from the plan, never when either is unknown", () => {
    expect(progressMismatch(60, 40)).toBe(true);
    expect(progressMismatch(55, 40)).toBe(false);
    expect(progressMismatch(25, 40)).toBe(false);
    expect(progressMismatch(null, 40)).toBe(false);
    expect(progressMismatch(60, null)).toBe(false);
  });
});

