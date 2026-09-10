import { describe, it, expect } from "vitest";
import { matchPeople, parseRequirements, serializeRequirements, skillCoverage, certificationStatus, daysToExpiry, clampLevel, type PersonSkillsInput } from "@/lib/skills";

describe("matchPeople", () => {
  const people: PersonSkillsInput[] = [
    { userId: "ana", levels: { drc: 4, fr: 3, fi: 5 }, freeHours: 60, minWeekFree: 8 },
    { userId: "ben", levels: { drc: 2, fr: 5 }, freeHours: 120, minWeekFree: 40 },
    { userId: "cat", levels: { drc: 5, fr: 4 }, freeHours: 0, minWeekFree: 0 },
    { userId: "dan", levels: { fi: 3 }, freeHours: 160, minWeekFree: 40 },
  ];
  const reqs = [{ skillId: "drc", minLevel: 3 }, { skillId: "fr", minLevel: 3 }];

  it("who can do a DRC rollout in French: full matches first, ranked by level then free hours", () => {
    const m = matchPeople(people, reqs);
    expect(m.map((x) => x.userId)).toEqual(["cat", "ana", "ben", "dan"]);
    expect(m[0].meetsAll).toBe(true);
    expect(m[1].meetsAll).toBe(true);
    expect(m[2].meetsAll).toBe(false);
    expect(m[2].missing).toEqual([{ skillId: "drc", level: 2, minLevel: 3 }]);
    expect(m[3].missing.map((x) => x.level)).toEqual([null, null]);
  });
  it("a minimum of free hours in the window drops the fully booked person", () => {
    const m = matchPeople(people, reqs, { minFreeHours: 40 });
    expect(m.map((x) => x.userId)).toEqual(["ana", "ben", "dan"]);
  });
  it("with no requirements everyone qualifies and availability decides the order", () => {
    expect(matchPeople(people, []).map((x) => x.userId)).toEqual(["dan", "ben", "ana", "cat"]);
  });
  it("the minimum level is inclusive", () => {
    expect(matchPeople([{ userId: "x", levels: { drc: 3 } }], [{ skillId: "drc", minLevel: 3 }])[0].meetsAll).toBe(true);
    expect(matchPeople([{ userId: "x", levels: { drc: 2 } }], [{ skillId: "drc", minLevel: 3 }])[0].meetsAll).toBe(false);
  });
});

describe("requirements in the URL", () => {
  it("round-trips and defaults a missing level to 3, ignoring unknown or duplicate ids", () => {
    const reqs = parseRequirements("drc:4,fr,drc:2,zzz:5", new Set(["drc", "fr"]));
    expect(reqs).toEqual([{ skillId: "drc", minLevel: 4 }, { skillId: "fr", minLevel: 3 }]);
    expect(serializeRequirements(reqs)).toBe("drc:4,fr:3");
    expect(parseRequirements(null)).toEqual([]);
  });
  it("clamps levels to 1–5", () => {
    expect(clampLevel(9)).toBe(5);
    expect(clampLevel(0)).toBe(1);
    expect(parseRequirements("a:7")[0].minLevel).toBe(5);
  });
});

describe("skillCoverage", () => {
  it("flags skills nobody holds solidly, and single points of failure", () => {
    const c = skillCoverage([
      { skillId: "fi", levels: [5, 4, 2] },
      { skillId: "drc", levels: [4, 2] },
      { skillId: "ps", levels: [2, 1] },
      { skillId: "fr", levels: [] },
    ]);
    expect(c.map((x) => [x.skillId, x.gap, x.covered, x.maxLevel])).toEqual([
      ["fi", "NONE", 2, 5],
      ["drc", "SINGLE", 1, 4],
      ["ps", "MISSING", 0, 2],
      ["fr", "MISSING", 0, 0],
    ]);
  });
});

describe("certifications", () => {
  it("classifies by days to expiry with an inclusive window", () => {
    expect(daysToExpiry("2026-12-09", "2026-09-10")).toBe(90);
    expect(certificationStatus("2026-12-09", "2026-09-10")).toBe("EXPIRING");
    expect(certificationStatus("2026-12-10", "2026-09-10")).toBe("VALID");
    expect(certificationStatus("2026-09-10", "2026-09-10")).toBe("EXPIRING");
    expect(certificationStatus("2026-09-09", "2026-09-10")).toBe("EXPIRED");
    expect(certificationStatus(null, "2026-09-10")).toBe("NO_EXPIRY");
  });
});
