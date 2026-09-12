import { describe, it, expect } from "vitest";
import {
  actionHref, attentionActions, enrichAll, filterActions, groupByClient, isTicket, NO_CLIENT,
  type RegisterAction,
} from "@/lib/actions-register";

// The register's new rules: client-first grouping, the attention strip, and the one thing a ticket
// must never do here — complete.

const TODAY = "2026-09-13";
const row = (o: Partial<RegisterAction>): RegisterAction => ({
  id: "a", source: "STATUS", title: "Something", projectId: "p1", projectName: "AFW",
  engagementId: null, engagementName: null, clientId: "c1", clientName: "Acme",
  href: "/delivery/p1?tab=status", owner: "Ana", ownerUserId: "u-ana",
  dueDate: null, createdAt: "2026-09-01T10:00:00.000Z", status: "Open", critical: false, ...o,
});
const ticket = (o: Partial<RegisterAction> = {}): RegisterAction => row({
  id: "t1", source: "TICKET", title: "Posting error", ref: "TKT-00000006",
  projectId: "", projectName: "Support", clientId: "c9", clientName: "Pirelli",
  href: "/tickets/t1", ownerUserId: "u-ana", ...o,
});

describe("a ticket is surfaced here, never resolved here", () => {
  it("never offers completion, however ordinary it looks", () => {
    const [breached, atRisk, gate] = enrichAll([
      ticket({ id: "t1", slaKind: "breached", urgent: true }),
      ticket({ id: "t2", slaKind: "at_risk" }),
      ticket({ id: "t3", stageName: "Triage", gatesWaiting: 2, urgent: true }),
    ], TODAY);
    for (const t of [breached, atRisk, gate]) expect(t.completableHere).toBe(false);
    expect(isTicket("TICKET")).toBe(true);
  });

  it("every other source still completes with one tick, exactly as before", () => {
    const rows = enrichAll([
      row({ id: "s1", source: "STATUS" }),
      row({ id: "m1", source: "MEETING" }),
      row({ id: "p1", source: "PLAN", progress: 40 }),
      row({ id: "r1", source: "RAID" }),
    ], TODAY);
    expect(rows.every((r) => r.completableHere)).toBe(true);
  });

  it("but a CRITICAL item of any source loses the tick and links out instead", () => {
    const rows = enrichAll([
      row({ id: "s1", source: "STATUS", critical: true }),
      row({ id: "r1", source: "RAID", critical: true }),
    ], TODAY);
    expect(rows.every((r) => !r.completableHere)).toBe(true);
  });

  it("a completed action can still be reopened from here — only tickets are absolute", () => {
    const [doneStatus, doneTicket] = enrichAll([
      row({ id: "s1", done: true, critical: true }),
      ticket({ id: "t1", done: true }),
    ], TODAY);
    expect(doneStatus.completableHere).toBe(true);
    expect(doneTicket.completableHere).toBe(false);
  });

  it("links to the ticket itself, and to the right cockpit tab for the rest", () => {
    expect(actionHref("TICKET", "", null, "tkt-1")).toBe("/tickets/tkt-1");
    expect(actionHref("RAID", "p1", null)).toBe("/delivery/p1?tab=raid");
    expect(actionHref("STATUS", "p1", "e1")).toBe("/delivery/p1?eng=e1&tab=status");
    expect(actionHref("PLAN", "p1", null)).toBe("/delivery/p1?tab=plan");
    expect(actionHref("MEETING", "p1", null)).toBe("/delivery/p1?tab=minutes");
  });
});

describe("needs attention: overdue, critical, or urgent in its own right", () => {
  it("takes a breached and a gate-waiting ticket even with no due date", () => {
    const rows = enrichAll([
      ticket({ id: "breached", slaKind: "breached", urgent: true }),
      ticket({ id: "gate", stageName: "Triage", gatesWaiting: 1, urgent: true }),
      ticket({ id: "atrisk", slaKind: "at_risk" }),
      row({ id: "calm" }),
    ], TODAY);
    expect(attentionActions(rows).map((a) => a.id)).toEqual(["breached", "gate"]);
  });

  it("still takes anything overdue or critical, from any source", () => {
    const rows = enrichAll([
      row({ id: "late", dueDate: "2026-09-01" }),
      row({ id: "crit", critical: true }),
      row({ id: "fine", dueDate: "2026-12-01" }),
    ], TODAY);
    expect(attentionActions(rows).map((a) => a.id).sort()).toEqual(["crit", "late"]);
  });

  it("never lists completed work, whatever its due date said", () => {
    const rows = enrichAll([row({ id: "old", dueDate: "2026-01-01", done: true, critical: true })], TODAY);
    expect(attentionActions(rows)).toEqual([]);
  });
});

describe("grouping is by client first, engagement second", () => {
  const rows = enrichAll([
    row({ id: "a1", clientId: "c1", clientName: "Acme", projectId: "p1", projectName: "AFW" }),
    row({ id: "a2", clientId: "c1", clientName: "Acme", projectId: "p2", projectName: "Portal", engagementId: "e1", engagementName: "BEKO" }),
    row({ id: "b1", clientId: "c2", clientName: "Beta", projectId: "p3", projectName: "AFW", dueDate: "2026-09-01" }),
    ticket({ id: "t1", clientId: "c2", clientName: "Beta", urgent: true, slaKind: "breached" }),
    row({ id: "n1", clientId: null, clientName: null, projectId: "p9", projectName: "Internal" }),
  ], TODAY);
  const groups = groupByClient(rows);

  it("puts the client holding the worst item first", () => {
    expect(groups[0].clientName).toBe("Beta"); // holds the overdue one
    expect(groups.map((g) => g.clientName)).toContain("Acme");
  });

  it("names the no-client bucket rather than dropping the rows", () => {
    const none = groups.find((g) => g.clientId === "");
    expect(none?.clientName).toBe(NO_CLIENT);
    expect(none?.actions).toHaveLength(1);
  });

  it("splits a client into its engagements, and groups a ticket under its own client", () => {
    const acme = groups.find((g) => g.clientName === "Acme")!;
    expect(acme.subGroups.map((s) => s.label).sort()).toEqual(["AFW", "BEKO"]);
    const beta = groups.find((g) => g.clientName === "Beta")!;
    expect(beta.actions.map((a) => a.id).sort()).toEqual(["b1", "t1"]);
    // The ticket sits under its own sub-heading, not folded into the project's.
    expect(beta.subGroups.find((s) => s.actions.some((a) => a.source === "TICKET"))?.label).toBe("Support");
  });

  it("counts only open work in a client's header", () => {
    const withDone = enrichAll([
      row({ id: "x1", clientId: "c1", clientName: "Acme" }),
      row({ id: "x2", clientId: "c1", clientName: "Acme", done: true }),
    ], TODAY);
    expect(groupByClient(withDone)[0]).toMatchObject({ openCount: 1 });
    expect(groupByClient(withDone)[0].actions).toHaveLength(2);
  });
});

describe("tickets are filterable like any other type", () => {
  const rows = enrichAll([ticket({ id: "t1" }), row({ id: "s1" })], TODAY);
  it("the type filter narrows to tickets", () => {
    expect(filterActions(rows, { source: "TICKET" }).map((a) => a.id)).toEqual(["t1"]);
    expect(filterActions(rows, { source: "STATUS" }).map((a) => a.id)).toEqual(["s1"]);
  });
  it("search reaches the ticket number and the client name", () => {
    expect(filterActions(rows, { q: "TKT-00000006" }).map((a) => a.id)).toEqual(["t1"]);
    expect(filterActions(rows, { q: "pirelli" }).map((a) => a.id)).toEqual(["t1"]);
  });
});
