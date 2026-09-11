import { describe, it, expect } from "vitest";
import {
  addDaysIso, diffDaysIso, wouldCreateCycle, cascadeShift, finishDelta, slipDays, planSlip, formatSlip,
  weightedProgress, planActualHours,
} from "@/lib/plan-schedule";
import { phaseProgress } from "@/lib/delivery";

describe("date helpers", () => {
  it("adds and diffs whole days across month and year ends", () => {
    expect(addDaysIso("2026-09-28", 5)).toBe("2026-10-03");
    expect(addDaysIso("2026-01-02", -3)).toBe("2025-12-30");
    expect(diffDaysIso("2026-09-01", "2026-09-11")).toBe(10);
    expect(diffDaysIso("2026-09-11", "2026-09-01")).toBe(-10);
  });
});

describe("wouldCreateCycle", () => {
  // a ← b ← c   (b depends on a, c depends on b)
  const tasks = [
    { id: "a", dependsOnId: null },
    { id: "b", dependsOnId: "a" },
    { id: "c", dependsOnId: "b" },
    { id: "d", dependsOnId: null },
  ];
  it("allows a new link that keeps the chain a tree", () => {
    expect(wouldCreateCycle(tasks, "d", "c")).toBe(false);
    expect(wouldCreateCycle(tasks, "c", "a")).toBe(false); // re-point c to a
    expect(wouldCreateCycle(tasks, "a", null)).toBe(false);
  });
  it("refuses a task depending on itself", () => {
    expect(wouldCreateCycle(tasks, "a", "a")).toBe(true);
  });
  it("refuses closing the loop a → c when c already (transitively) depends on a", () => {
    expect(wouldCreateCycle(tasks, "a", "c")).toBe(true);
    expect(wouldCreateCycle(tasks, "a", "b")).toBe(true);
  });
  it("refuses walking into a loop already stored in the data", () => {
    const dirty = [{ id: "x", dependsOnId: "y" }, { id: "y", dependsOnId: "x" }, { id: "z", dependsOnId: null }];
    expect(wouldCreateCycle(dirty, "z", "x")).toBe(true);
  });
});

describe("cascadeShift", () => {
  const t = (id: string, dependsOnId: string | null, startDate: string | null, dueDate: string | null) => ({ id, dependsOnId, startDate, dueDate });
  const plan = [
    t("design", null, "2026-09-01", "2026-09-10"),
    t("build", "design", "2026-09-11", "2026-09-30"),
    t("test", "build", "2026-10-01", "2026-10-10"),
    t("docs", "design", null, "2026-09-20"),
    t("other", null, "2026-09-01", "2026-09-05"),
  ];
  it("moves every downstream task by the same delta, transitively", () => {
    const s = cascadeShift(plan, "design", 3);
    expect(s.map((x) => x.id).sort()).toEqual(["build", "docs", "test"]);
    const build = s.find((x) => x.id === "build")!;
    expect(build).toEqual({ id: "build", startDate: "2026-09-14", dueDate: "2026-10-03", prevStartDate: "2026-09-11", prevDueDate: "2026-09-30" });
    expect(s.find((x) => x.id === "test")!.dueDate).toBe("2026-10-13");
  });
  it("moves earlier too, and leaves an undated side undated", () => {
    const docs = cascadeShift(plan, "design", -2).find((x) => x.id === "docs")!;
    expect(docs.startDate).toBeNull();
    expect(docs.dueDate).toBe("2026-09-18");
  });
  it("does nothing for a zero delta or a task nobody depends on", () => {
    expect(cascadeShift(plan, "design", 0)).toEqual([]);
    expect(cascadeShift(plan, "other", 5)).toEqual([]);
  });
  it("terminates on a loop stored in the data and moves each task once", () => {
    const loop = [t("a", "b", "2026-09-01", "2026-09-02"), t("b", "a", "2026-09-03", "2026-09-04")];
    const s = cascadeShift(loop, "a", 1);
    expect(s.map((x) => x.id)).toEqual(["b"]);
  });
  it("measures the push from the due date only", () => {
    expect(finishDelta("2026-09-10", "2026-09-13")).toBe(3);
    expect(finishDelta("2026-09-10", "2026-09-10")).toBe(0); // start-only resize pushes nobody
    expect(finishDelta(null, "2026-09-10")).toBe(0);
  });
});

describe("slip", () => {
  it("is due date minus baseline end, per task", () => {
    expect(slipDays("2026-09-15", "2026-09-10")).toBe(5);
    expect(slipDays("2026-09-08", "2026-09-10")).toBe(-2);
    expect(slipDays("2026-09-10", "2026-09-10")).toBe(0);
    expect(slipDays(null, "2026-09-10")).toBeNull();
    expect(slipDays("2026-09-10", null)).toBeNull();
  });
  it("plan slip = latest due vs latest baseline end, over baselined tasks only", () => {
    expect(planSlip([
      { dueDate: "2026-09-20", baselineEnd: "2026-09-10" },
      { dueDate: "2026-10-05", baselineEnd: "2026-10-01" },
      { dueDate: "2026-12-31", baselineEnd: null }, // added after baselining: ignored
    ])).toBe(4);
    expect(planSlip([{ dueDate: "2026-09-20", baselineEnd: null }])).toBeNull();
    expect(planSlip([])).toBeNull();
  });
  it("formats with a sign", () => {
    expect(formatSlip(3)).toBe("+3 d");
    expect(formatSlip(-2)).toBe("−2 d");
    expect(formatSlip(0)).toBe("0 d");
  });
});

describe("weightedProgress", () => {
  const t = (progress: number, start: string | null, due: string | null, est?: number | null, isMilestone = false) => ({ progress, isMilestone, startDate: start, dueDate: due, estimatedHours: est });
  it("weights by effort when every task has an estimate", () => {
    // 90h at 100% + 10h at 0% → 90%, even though the 10h task is the longer one on the calendar
    expect(weightedProgress([t(100, "2026-09-01", "2026-09-02", 90), t(0, "2026-09-01", "2026-09-30", 10)])).toEqual({ percent: 90, basis: "effort" });
  });
  it("falls back to duration when an estimate is missing but every task is dated", () => {
    expect(weightedProgress([t(100, "2026-09-01", "2026-09-10", 90), t(0, "2026-09-11", "2026-09-11", null)])).toEqual({ percent: 91, basis: "duration" });
  });
  it("falls back to a plain average when a task has no dates and no estimate", () => {
    expect(weightedProgress([t(100, "2026-09-01", "2026-09-10"), t(0, null, null)])).toEqual({ percent: 50, basis: "count" });
  });
  it("ignores milestones, treats a zero estimate as missing, and clamps progress", () => {
    expect(weightedProgress([t(40, "2026-09-01", "2026-09-02", 8), t(0, "2026-09-30", "2026-09-30", null, true)])).toEqual({ percent: 40, basis: "effort" });
    expect(weightedProgress([t(100, "2026-09-01", "2026-09-01", 0), t(0, "2026-09-02", "2026-09-02", 5)]).basis).toBe("duration");
    expect(weightedProgress([t(150, "2026-09-01", "2026-09-01", 1)]).percent).toBe(100);
    expect(weightedProgress([])).toEqual({ percent: 0, basis: "none" });
  });
  it("phaseProgress is the same number (the plan grid, the deck and the editor agree)", () => {
    const tasks = [t(100, "2026-09-01", "2026-09-02", 30), t(50, "2026-09-03", "2026-09-20", 10)];
    expect(phaseProgress(tasks)).toBe(weightedProgress(tasks).percent);
    expect(phaseProgress(tasks)).toBe(88);
  });
});

describe("planActualHours", () => {
  const approved = [
    { milestoneId: "m1", taskId: "t1", hours: 6 },
    { milestoneId: "m1", taskId: "t2", hours: 4 },
    { milestoneId: "m1", taskId: null, hours: 2.5 },
    { milestoneId: "m2", taskId: null, hours: 8 },
  ];
  it("sums the whole milestone, or only the linked task", () => {
    const m = planActualHours([
      { id: "r1", milestoneId: "m1", taskId: null },
      { id: "r2", milestoneId: "m1", taskId: "t1" },
      { id: "r3", milestoneId: "m2", taskId: "t9" },
      { id: "r4", milestoneId: null, taskId: null },
    ], approved);
    expect(m.get("r1")).toBe(12.5);
    expect(m.get("r2")).toBe(6);
    expect(m.get("r3")).toBe(0);
    expect(m.has("r4")).toBe(false);
  });
});
