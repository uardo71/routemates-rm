import { describe, it, expect } from "vitest";
import { enrichAction, enrichAll, filterActions, sortActions, summarizeActions, daysBetween, type RegisterAction } from "@/lib/actions-register";

const TODAY = "2026-09-11";
const base = (o: Partial<RegisterAction> = {}): RegisterAction => ({
  id: "a1", source: "RAID", title: "Fix the interface", projectId: "p1", projectName: "AFW", engagementId: null, engagementName: null,
  owner: "Ana", ownerUserId: "u-ana", dueDate: "2026-09-15", createdAt: "2026-09-01T10:00:00.000Z", status: "Open", critical: false, ...o,
});

describe("age and overdue math", () => {
  it("counts whole days at UTC midnight regardless of time-of-day", () => {
    expect(daysBetween("2026-09-01T23:59:00.000Z", "2026-09-11")).toBe(10);
    expect(daysBetween("2026-09-11", "2026-09-11")).toBe(0);
  });
  it("is overdue only after the due date — due today is not late", () => {
    expect(enrichAction(base({ dueDate: "2026-09-10" }), TODAY)).toMatchObject({ overdueDays: 1, isOverdue: true });
    expect(enrichAction(base({ dueDate: "2026-09-11" }), TODAY)).toMatchObject({ overdueDays: 0, isOverdue: false });
    expect(enrichAction(base({ dueDate: "2026-09-15" }), TODAY)).toMatchObject({ overdueDays: -4, isOverdue: false });
    expect(enrichAction(base({ dueDate: null }), TODAY)).toMatchObject({ overdueDays: null, isOverdue: false });
  });
  it("age is days since raised, never negative, and unassigned means neither a user nor a name", () => {
    expect(enrichAction(base({ createdAt: "2026-09-01T10:00:00.000Z" }), TODAY).ageDays).toBe(10);
    expect(enrichAction(base({ createdAt: "2026-09-12T00:00:00.000Z" }), TODAY).ageDays).toBe(0);
    expect(enrichAction(base({ owner: null, ownerUserId: null }), TODAY).unassigned).toBe(true);
    expect(enrichAction(base({ owner: "Client PM", ownerUserId: null }), TODAY).unassigned).toBe(false);
  });
});

describe("ordering, filtering, summary", () => {
  const rows = enrichAll([
    base({ id: "late10", dueDate: "2026-09-01" }),
    base({ id: "late2-critical", dueDate: "2026-09-09", critical: true }),
    base({ id: "late2", dueDate: "2026-09-09" }),
    base({ id: "today", dueDate: TODAY }),
    base({ id: "soon", dueDate: "2026-09-20" }),
    base({ id: "undated-old", dueDate: null, createdAt: "2026-06-01T00:00:00.000Z", owner: null, ownerUserId: null, source: "MEETING", projectId: "p2", projectName: "Tungsten" }),
    base({ id: "undated-new", dueDate: null, createdAt: "2026-09-10T00:00:00.000Z", ownerUserId: "u-ben", owner: "Ben", source: "PLAN" }),
  ], TODAY);

  it("sorts worst first: most overdue, critical before non-critical on a tie, then oldest undated last", () => {
    expect(rows.map((r) => r.id)).toEqual(["late10", "late2-critical", "late2", "today", "soon", "undated-old", "undated-new"]);
  });
  it("filters: mine / unassigned / overdue / project / source / text", () => {
    expect(filterActions(rows, { mineUserId: "u-ana" }).map((r) => r.id)).toEqual(["late10", "late2-critical", "late2", "today", "soon"]);
    expect(filterActions(rows, { unassigned: true }).map((r) => r.id)).toEqual(["undated-old"]);
    expect(filterActions(rows, { overdue: true }).map((r) => r.id)).toEqual(["late10", "late2-critical", "late2"]);
    expect(filterActions(rows, { projectId: "p2" }).map((r) => r.id)).toEqual(["undated-old"]);
    expect(filterActions(rows, { source: "PLAN" }).map((r) => r.id)).toEqual(["undated-new"]);
    expect(filterActions(rows, { q: "tungsten" }).map((r) => r.id)).toEqual(["undated-old"]);
  });
  it("sorts by column in both directions", () => {
    expect(sortActions(rows, "due", "asc").map((r) => r.id).slice(0, 2)).toEqual(["late10", "late2-critical"]);
    expect(sortActions(rows, "age", "desc")[0].id).toBe("undated-old");
    expect(sortActions(rows, "owner", "asc")[0].owner).toBeNull();
  });
  it("summarises overdue / unassigned / due this week", () => {
    expect(summarizeActions(rows)).toEqual({ total: 7, overdue: 3, unassigned: 1, dueThisWeek: 1 });
  });
});
