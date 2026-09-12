import { describe, it, expect } from "vitest";
import {
  attentionScore, filterClients, isQuiet, lastActivityLabel, needsAttention, sortClients, summarize,
  type ClientRow,
} from "@/lib/support-overview";

const row = (p: Partial<ClientRow>): ClientRow => ({
  id: p.name ?? "c", name: "Acme", open: 0, unassigned: 0, breached: 0, critical: 0, resolved7d: 0,
  oldestOpenDays: null, lastActivity: "", team: [], leadCount: 0, ...p,
});

const LATE = row({ name: "Late", open: 3, breached: 2 });
const SEVERE = row({ name: "Severe", open: 5, critical: 1 });
const ORPHAN = row({ name: "Orphan", open: 4, unassigned: 2 });
const BUSY = row({ name: "Busy", open: 9 });
const QUIET = row({ name: "Quiet" });

describe("what needs a human", () => {
  it("counts late, severe or unowned work as attention — plain open work is not", () => {
    expect([LATE, SEVERE, ORPHAN].every(needsAttention)).toBe(true);
    expect(needsAttention(BUSY)).toBe(false);
    expect(needsAttention(QUIET)).toBe(false);
  });
  it("quiet means nothing open, which is not the same as needing nothing", () => {
    expect(isQuiet(QUIET)).toBe(true);
    expect(isQuiet(BUSY)).toBe(false); // busy but all owned and on time
  });
  it("ranks breached over critical over unassigned, with open work breaking the tie", () => {
    expect(attentionScore(LATE)).toBeGreaterThan(attentionScore(SEVERE));
    expect(attentionScore(SEVERE)).toBeGreaterThan(attentionScore(ORPHAN));
    expect(attentionScore(ORPHAN)).toBeGreaterThan(attentionScore(BUSY));
    expect(attentionScore(BUSY)).toBeGreaterThan(attentionScore(QUIET));
  });
});

describe("the table's order", () => {
  const ROWS = [QUIET, BUSY, ORPHAN, SEVERE, LATE];
  it("puts the worst account first by default", () => {
    expect(sortClients(ROWS, "attention", "desc").map((r) => r.name)).toEqual(["Late", "Severe", "Orphan", "Busy", "Quiet"]);
  });
  it("sorts by a column and flips direction", () => {
    expect(sortClients(ROWS, "open", "desc").map((r) => r.open)).toEqual([9, 5, 4, 3, 0]);
    expect(sortClients(ROWS, "open", "asc").map((r) => r.open)).toEqual([0, 3, 4, 5, 9]);
    expect(sortClients(ROWS, "name", "asc").map((r) => r.name)).toEqual(["Busy", "Late", "Orphan", "Quiet", "Severe"]);
  });
  it("an account with nothing open has no age, and never outranks a real age", () => {
    const aged = [row({ name: "Old", open: 1, oldestOpenDays: 40 }), row({ name: "New", open: 1, oldestOpenDays: 2 }), QUIET];
    expect(sortClients(aged, "oldest", "desc").map((r) => r.name)).toEqual(["Old", "New", "Quiet"]);
    expect(sortClients(aged, "oldest", "asc").map((r) => r.name)).toEqual(["Quiet", "New", "Old"]);
  });
  it("does not mutate what it was given", () => {
    const before = ROWS.map((r) => r.name);
    sortClients(ROWS, "open", "asc");
    expect(ROWS.map((r) => r.name)).toEqual(before);
  });
});

describe("the chips filter, they don't just count", () => {
  const ROWS = [QUIET, BUSY, ORPHAN, SEVERE, LATE];
  it("each chip narrows to exactly the accounts it counted", () => {
    const s = summarize(ROWS);
    for (const focus of ["attention", "breached", "unassigned", "critical", "quiet"] as const) {
      expect(filterClients(ROWS, { focus }).length).toBe(s.counts[focus]);
    }
    expect(filterClients(ROWS, { focus: "breached" }).map((r) => r.name)).toEqual(["Late"]);
    expect(filterClients(ROWS, { focus: "attention" }).map((r) => r.name)).toEqual(["Orphan", "Severe", "Late"]);
  });
  it("search matches the account name or anyone on its team", () => {
    const rows = [row({ name: "Pirelli", team: ["Iljona Selita"] }), row({ name: "Tungsten", team: ["Borana Dishani"] })];
    expect(filterClients(rows, { q: "pir" }).map((r) => r.name)).toEqual(["Pirelli"]);
    expect(filterClients(rows, { q: "borana" }).map((r) => r.name)).toEqual(["Tungsten"]);
    expect(filterClients(rows, { q: "  " }).length).toBe(2);
  });
  it("totals add up the tickets, counts add up the accounts", () => {
    const s = summarize(ROWS);
    expect(s).toMatchObject({ clients: 5, open: 21, breached: 2, unassigned: 2, critical: 1 });
    expect(s.counts).toMatchObject({ attention: 3, breached: 1, unassigned: 1, critical: 1, quiet: 1 });
  });
});

describe("last activity reads in words", () => {
  const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
  it("says today, yesterday, days, months — or nothing at all", () => {
    expect(lastActivityLabel("", NOW)).toBe("no activity");
    expect(lastActivityLabel(new Date(NOW - 3_600_000).toISOString(), NOW)).toBe("today");
    expect(lastActivityLabel(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe("yesterday");
    expect(lastActivityLabel(new Date(NOW - 5 * 86_400_000).toISOString(), NOW)).toBe("5d ago");
    expect(lastActivityLabel(new Date(NOW - 70 * 86_400_000).toISOString(), NOW)).toBe("2mo ago");
  });
});
