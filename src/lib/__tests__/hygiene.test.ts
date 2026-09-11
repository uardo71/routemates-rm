import { describe, it, expect } from "vitest";
import {
  wonNotStarted, activeNoPo, activeNoEnd, onHoldNoIssue, noStatusEver, statusStale, milestoneOverdue,
  milestoneOpenAfterAssignments, approvedNoBudget, clientNoSponsor, activeNoManager, evaluateHygiene, hygieneCounts,
  type HygieneProjectRow, type HygieneMilestoneRow, type HygieneRows,
} from "@/lib/hygiene";

const TODAY = "2026-09-11";
const P = (o: Partial<HygieneProjectRow> = {}): HygieneProjectRow => ({
  id: "p1", name: "Pirelli DRC", clientId: "c1", clientName: "Pirelli", status: "ACTIVE", isInternal: false,
  managerId: "pm", endDate: "2026-12-31", poNumber: "PO-1", poWaived: false, budgetHours: 100, approvedHours: 20,
  sponsorContactId: "s1", lastStatusIso: "2026-09-01", openIssueCount: 0, hasWonOpportunity: true, ...o,
});
const M = (o: Partial<HygieneMilestoneRow> = {}): HygieneMilestoneRow => ({
  id: "m1", name: "Build", projectId: "p1", endDate: "2026-12-31", status: "ACTIVE", writtenOff: false, timeEntryOpen: true, assignmentEndDates: ["2026-12-31"], ...o,
});
const rows = (projects: HygieneProjectRow[], milestones: HygieneMilestoneRow[] = []): HygieneRows => ({ projects, milestones });

describe("a clean portfolio has no hygiene items", () => {
  it("evaluates to nothing", () => {
    expect(evaluateHygiene(rows([P()], [M()]), TODAY)).toEqual([]);
  });
});

describe("each predicate at its boundary", () => {
  it("won deal whose project is still PLANNED", () => {
    expect(wonNotStarted(rows([P({ status: "PLANNED" })]))).toHaveLength(1);
    expect(wonNotStarted(rows([P({ status: "PLANNED", hasWonOpportunity: false })]))).toHaveLength(0);
    expect(wonNotStarted(rows([P({ status: "ACTIVE" })]))).toHaveLength(0);
    expect(wonNotStarted(rows([P({ status: "PLANNED" })]))[0].fixHref).toBe("/projects/p1?lifecycle=start");
  });
  it("ACTIVE with no PO and no waiver", () => {
    expect(activeNoPo(rows([P({ poNumber: null })]))).toHaveLength(1);
    expect(activeNoPo(rows([P({ poNumber: "  " })]))).toHaveLength(1);
    expect(activeNoPo(rows([P({ poNumber: null, poWaived: true })]))).toHaveLength(0);
    expect(activeNoPo(rows([P({ poNumber: null, status: "ON_HOLD" })]))).toHaveLength(0);
    expect(activeNoPo(rows([P({ poNumber: null })]))[0].fixHref).toBe("/projects/p1/edit#field-poNumber");
  });
  it("ACTIVE with no end date", () => {
    expect(activeNoEnd(rows([P({ endDate: null })]))).toHaveLength(1);
    expect(activeNoEnd(rows([P({ endDate: null, status: "PLANNED" })]))).toHaveLength(0);
  });
  it("ON_HOLD with no open issue explaining why", () => {
    expect(onHoldNoIssue(rows([P({ status: "ON_HOLD", openIssueCount: 0 })]))).toHaveLength(1);
    expect(onHoldNoIssue(rows([P({ status: "ON_HOLD", openIssueCount: 1 })]))).toHaveLength(0);
    expect(onHoldNoIssue(rows([P({ status: "ACTIVE", openIssueCount: 0 })]))).toHaveLength(0);
  });
  it("no status update ever (active or on hold only)", () => {
    expect(noStatusEver(rows([P({ lastStatusIso: null })]))).toHaveLength(1);
    expect(noStatusEver(rows([P({ lastStatusIso: null, status: "ON_HOLD" })]))).toHaveLength(1);
    expect(noStatusEver(rows([P({ lastStatusIso: null, status: "PLANNED" })]))).toHaveLength(0);
  });
  it("stale status: exactly 30 days is not stale, 31 is", () => {
    expect(statusStale(rows([P({ lastStatusIso: "2026-08-12" })]), TODAY)).toHaveLength(0); // 30 days
    expect(statusStale(rows([P({ lastStatusIso: "2026-08-11" })]), TODAY)).toHaveLength(1); // 31 days
    expect(statusStale(rows([P({ lastStatusIso: null })]), TODAY)).toHaveLength(0); // that's "no status ever"
  });
  it("milestone past its end date and not complete: ending today is not overdue", () => {
    expect(milestoneOverdue(rows([P()], [M({ endDate: TODAY })]), TODAY)).toHaveLength(0);
    expect(milestoneOverdue(rows([P()], [M({ endDate: "2026-09-10" })]), TODAY)).toHaveLength(1);
    expect(milestoneOverdue(rows([P()], [M({ endDate: "2026-09-10", status: "COMPLETE" })]), TODAY)).toHaveLength(0);
    expect(milestoneOverdue(rows([P()], [M({ endDate: "2026-09-10", status: "INVOICED" })]), TODAY)).toHaveLength(0);
    expect(milestoneOverdue(rows([P()], [M({ endDate: "2026-09-10", writtenOff: true })]), TODAY)).toHaveLength(0);
    expect(milestoneOverdue(rows([P({ status: "COMPLETED" })], [M({ endDate: "2026-09-10" })]), TODAY)).toHaveLength(0);
  });
  it("every assignment ended but the milestone still takes time: ending today still counts as working", () => {
    expect(milestoneOpenAfterAssignments(rows([P()], [M({ assignmentEndDates: ["2026-09-10", "2026-08-01"] })]), TODAY)).toHaveLength(1);
    expect(milestoneOpenAfterAssignments(rows([P()], [M({ assignmentEndDates: ["2026-09-10", TODAY] })]), TODAY)).toHaveLength(0);
    expect(milestoneOpenAfterAssignments(rows([P()], [M({ assignmentEndDates: ["2026-09-10"], timeEntryOpen: false })]), TODAY)).toHaveLength(0);
    expect(milestoneOpenAfterAssignments(rows([P()], [M({ assignmentEndDates: [] })]), TODAY)).toHaveLength(0);
  });
  it("approved time with no budget hours", () => {
    expect(approvedNoBudget(rows([P({ budgetHours: null })]))).toHaveLength(1);
    expect(approvedNoBudget(rows([P({ budgetHours: 0 })]))).toHaveLength(1);
    expect(approvedNoBudget(rows([P({ budgetHours: null, approvedHours: 0 })]))).toHaveLength(0);
  });
  it("client with no sponsor on any live project: one item per client", () => {
    const two = rows([P({ id: "a", name: "A", sponsorContactId: null }), P({ id: "b", name: "B", sponsorContactId: null })]);
    expect(clientNoSponsor(two)).toHaveLength(1);
    expect(clientNoSponsor(two)[0]).toMatchObject({ projectId: "a", subjectId: "c1" });
    expect(clientNoSponsor(rows([P({ id: "a", sponsorContactId: null }), P({ id: "b", sponsorContactId: "s1" })]))).toHaveLength(0);
    expect(clientNoSponsor(rows([P({ sponsorContactId: null, status: "COMPLETED" })]))).toHaveLength(0);
  });
  it("ACTIVE with no manager", () => {
    expect(activeNoManager(rows([P({ managerId: null })]))).toHaveLength(1);
    expect(activeNoManager(rows([P({ managerId: null, status: "PLANNED" })]))).toHaveLength(0);
  });
  it("internal projects are never on the worklist", () => {
    const internal = P({ isInternal: true, managerId: null, poNumber: null, endDate: null, lastStatusIso: null, budgetHours: null, sponsorContactId: null });
    expect(evaluateHygiene(rows([internal], [M({ endDate: "2026-01-01" })]), TODAY)).toEqual([]);
  });
});

describe("the worklist", () => {
  it("orders by check and counts per check", () => {
    const items = evaluateHygiene(rows([P({ managerId: null, poNumber: null }), P({ id: "p2", name: "Beko", clientId: "c2", poNumber: null })]), TODAY);
    expect(items.map((i) => i.key)).toEqual(["active_no_manager", "active_no_po", "active_no_po"]);
    expect(Object.fromEntries(hygieneCounts(items))).toEqual({ active_no_manager: 1, active_no_po: 2 });
  });
});
