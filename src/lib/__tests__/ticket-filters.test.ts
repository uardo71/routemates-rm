import { describe, it, expect } from "vitest";
import { filterRows, normalizeFilters, MISSING_ID, type TicketFilters } from "@/app/(app)/tickets/filters";
import type { TicketRow } from "@/app/(app)/tickets/serialize";
import { createDropNotices, WORKFLOW_REJECTION, INTERNAL_NOTE_REFUSED } from "@/lib/ticket";

const row = (p: Partial<TicketRow>): TicketRow => ({
  id: "t", number: "TKT-00000001", title: "Posting error", typeId: "ty", typeName: "Incident", typeColor: null, typeIcon: null,
  priority: "MEDIUM", statusId: "st", statusName: "New", statusColor: null, statusCategory: "OPEN", slaApplicable: true,
  requesterId: "u-req", assigneeId: null, clientId: null, requesterName: "Requester", assigneeName: null, clientName: null, projectName: null,
  category: "", systemRef: "", moduleRef: "", dueDate: "", respondBy: "", resolveBy: "", firstResponseAt: "", resolvedAt: "",
  createdAt: "2026-09-01T00:00:00.000Z", fields: {}, ...p,
});
const ids = (rows: TicketRow[]) => rows.map((r) => r.id);

// Two different people called Mario Rossi, two different clients called Acme.
const ROWS = [
  row({ id: "a", assigneeId: "u-mario-1", assigneeName: "Mario Rossi", requesterId: "u-mario-1", requesterName: "Mario Rossi", clientId: "c-acme-it", clientName: "Acme" }),
  row({ id: "b", assigneeId: "u-mario-2", assigneeName: "Mario Rossi", requesterId: "u-mario-2", requesterName: "Mario Rossi", clientId: "c-acme-de", clientName: "Acme" }),
  row({ id: "c", assigneeId: null, clientId: "c-other", clientName: "Other" }),
];

describe("people and clients are matched by account id, never by name", () => {
  it("'Assigned to me' and 'Raised by me' only match the signed-in account", () => {
    expect(ids(filterRows(ROWS, { mine: "assigned" }, "u-mario-1"))).toEqual(["a"]);
    expect(ids(filterRows(ROWS, { mine: "requested" }, "u-mario-2"))).toEqual(["b"]);
  });
  it("an assignee filter picks one of two same-named people", () => {
    expect(ids(filterRows(ROWS, { assigneeIds: ["u-mario-2"] }, "x"))).toEqual(["b"]);
  });
  it("a client filter — and the workspace export's pinned client — picks one of two same-named clients", () => {
    expect(ids(filterRows(ROWS, { clientIds: ["c-acme-it"] }, "x"))).toEqual(["a"]);
    expect(ids(filterRows(ROWS, { clientIds: ["c-acme-de"] }, "x"))).toEqual(["b"]);
  });
  it("an empty filter list doesn't filter", () => {
    expect(ids(filterRows(ROWS, { assigneeIds: [], clientIds: [] }, "x"))).toEqual(["a", "b", "c"]);
  });
});

describe("views saved with names are translated to ids when read", () => {
  const people = [{ id: "u-mario-1", name: "Mario Rossi" }, { id: "u-mario-2", name: "Mario Rossi" }, { id: "u-anna", name: "Anna" }];
  const clients = [{ id: "c-acme-it", name: "Acme" }, { id: "c-acme-de", name: "Acme" }, { id: "c-other", name: "Other" }];

  it("a name becomes the account ids that carry it, and the name lists are dropped", () => {
    const f = normalizeFilters({ assigneeNames: ["Anna"], clientNames: ["Other"], onlyOpen: true }, people, clients);
    expect(f).toEqual({ assigneeIds: ["u-anna"], clientIds: ["c-other"], onlyOpen: true } satisfies TicketFilters);
  });
  it("a name shared by two accounts keeps both — exactly what the old name filter matched", () => {
    expect(normalizeFilters({ assigneeNames: ["Mario Rossi"] }, people, clients).assigneeIds).toEqual(["u-mario-1", "u-mario-2"]);
  });
  it("a name nobody has any more keeps matching nothing", () => {
    const f = normalizeFilters({ assigneeNames: ["Gone Person"] }, people, clients);
    expect(f.assigneeIds).toEqual([`${MISSING_ID}Gone Person`]);
    expect(filterRows(ROWS, f, "x")).toEqual([]);
  });
  it("already-id filters pass through untouched, and junk input yields empty filters", () => {
    expect(normalizeFilters({ assigneeIds: ["u-anna"] }, people, clients)).toEqual({ assigneeIds: ["u-anna"] });
    expect(normalizeFilters(null, people, clients)).toEqual({});
  });
});

describe("refusals name what was not kept, and why", () => {
  it("create: requester and assignee each get their own message", () => {
    expect(createDropNotices(["requester", "assignee"], "team")).toEqual([
      "Requester not saved — you're not on this client's team, so you are recorded as the requester.",
      "Assignee not saved — you're not on this client's team, so the ticket was left unassigned.",
    ]);
  });
  it("create without a client explains who may triage it; unknown codes are ignored", () => {
    expect(createDropNotices(["assignee", "bogus"], "noclient")).toEqual([
      "Assignee not saved — only admins and PMs can triage a ticket that has no client, so the ticket was left unassigned.",
    ]);
    expect(createDropNotices([""], "team")).toEqual([]);
  });
  it("save and comment messages say what was refused and why", () => {
    expect(WORKFLOW_REJECTION.priority).toMatch(/^Priority change not saved — only managers/);
    expect(WORKFLOW_REJECTION.assignee).toMatch(/^Assignee change not saved — only managers/);
    expect(INTERNAL_NOTE_REFUSED).toMatch(/^Posted as a regular comment — only managers .* can mark notes internal\.$/);
  });
});
