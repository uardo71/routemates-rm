import { describe, it, expect } from "vitest";
import { bucketForAge, summarizeAge, groupUnbilled, totalsByProject, TIME_BILLED_TYPES, type UnbilledEntry } from "@/lib/wip";

function entry(o: Partial<UnbilledEntry> = {}): UnbilledEntry {
  return {
    entryId: "e1", projectId: "p1", projectName: "Project One", clientName: "Client A",
    milestoneId: "m1", milestoneName: "Phase 1", userName: "Ada",
    date: "2026-01-15", month: "2026-01", hours: 1, rate: 100, value: 100, ageDays: 0, ...o,
  };
}

describe("bucketForAge", () => {
  it("places ages in the right bucket at every boundary", () => {
    expect(bucketForAge(0)).toBe("0-30");
    expect(bucketForAge(30)).toBe("0-30"); // inclusive upper edge
    expect(bucketForAge(31)).toBe("31-60");
    expect(bucketForAge(60)).toBe("31-60");
    expect(bucketForAge(61)).toBe("61-90");
    expect(bucketForAge(90)).toBe("61-90"); // 90 is NOT yet "90+"
    expect(bucketForAge(91)).toBe("90+"); // the number this view exists to surface
    expect(bucketForAge(365)).toBe("90+");
  });
});

describe("summarizeAge", () => {
  it("always returns all four buckets in order, even when empty", () => {
    const b = summarizeAge([]);
    expect(b.map((x) => x.key)).toEqual(["0-30", "31-60", "61-90", "90+"]);
    expect(b.every((x) => x.hours === 0 && x.value === 0 && x.entries === 0)).toBe(true);
  });

  it("accumulates hours, value and counts into the right buckets", () => {
    const b = summarizeAge([
      entry({ ageDays: 10, hours: 2, value: 200 }),
      entry({ ageDays: 45, hours: 3, value: 300 }),
      entry({ ageDays: 100, hours: 4, value: 400 }),
      entry({ ageDays: 200, hours: 1, value: 100 }),
    ]);
    const byKey = Object.fromEntries(b.map((x) => [x.key, x]));
    expect(byKey["0-30"]).toMatchObject({ hours: 2, value: 200, entries: 1 });
    expect(byKey["31-60"]).toMatchObject({ hours: 3, value: 300, entries: 1 });
    expect(byKey["61-90"]).toMatchObject({ hours: 0, value: 0, entries: 0 });
    expect(byKey["90+"]).toMatchObject({ hours: 5, value: 500, entries: 2 }); // both stale entries
  });
});

describe("groupUnbilled", () => {
  const entries = [
    entry({ entryId: "a", ageDays: 10, hours: 2, value: 200, month: "2026-01" }),
    entry({ entryId: "b", ageDays: 120, hours: 1, value: 100, month: "2026-01" }),
    entry({ entryId: "c", ageDays: 5, hours: 3, value: 300, month: "2026-02" }),
    entry({ entryId: "d", projectId: "p2", projectName: "Project Two", milestoneId: "m2", milestoneName: "Phase 2", hours: 10, value: 5000, ageDays: 2 }),
  ];

  it("nests project → milestone → month and totals each level", () => {
    const g = groupUnbilled(entries);
    expect(g).toHaveLength(2);
    // Sorted by value, so the 5000 project comes first.
    expect(g[0].projectId).toBe("p2");
    const p1 = g.find((x) => x.projectId === "p1")!;
    expect(p1.hours).toBe(6); // 2 + 1 + 3
    expect(p1.value).toBe(600);
    expect(p1.milestones).toHaveLength(1);
    expect(p1.milestones[0].months.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
    expect(p1.milestones[0].months[0].entries).toBe(2); // a + b in January
  });

  it("carries the OLDEST entry's age up to milestone and project level", () => {
    const p1 = groupUnbilled(entries).find((x) => x.projectId === "p1")!;
    expect(p1.oldestAgeDays).toBe(120); // not 10 or 5
    expect(p1.milestones[0].oldestAgeDays).toBe(120);
    expect(p1.milestones[0].months[0].oldestAgeDays).toBe(120); // January holds the stale entry
    expect(p1.milestones[0].months[1].oldestAgeDays).toBe(5); // February is fresh
  });

  it("returns nothing for no entries", () => {
    expect(groupUnbilled([])).toEqual([]);
  });
});

describe("totalsByProject", () => {
  it("sums hours and value per project", () => {
    const t = totalsByProject([
      entry({ hours: 2, value: 200 }),
      entry({ hours: 3, value: 300 }),
      entry({ projectId: "p2", hours: 1, value: 50 }),
    ]);
    expect(t.get("p1")).toEqual({ hours: 5, value: 500 });
    expect(t.get("p2")).toEqual({ hours: 1, value: 50 });
    expect(t.get("nope")).toBeUndefined();
  });
});

describe("TIME_BILLED_TYPES", () => {
  it("excludes FIXED_PRICE — its salesPrice is a lump sum, not an hourly rate", () => {
    // Regression guard: valuing fixed-price hours against milestone.salesPrice multiplied a whole
    // EUR 9,300 contract by every hour worked (148.8h -> EUR 1,383,840).
    expect(TIME_BILLED_TYPES).not.toContain("FIXED_PRICE");
    expect([...TIME_BILLED_TYPES].sort()).toEqual(["RETAINER", "TIME_AND_MATERIALS"]);
  });
});
