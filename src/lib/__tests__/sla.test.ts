import { describe, it, expect } from "vitest";
import { pickPolicy, normalizeTargets, targetsLabel, labelFromTimestamps, DEFAULT_SLA_TARGETS, SLA_SOURCE_LABEL } from "@/lib/sla";
import { filterRows } from "@/app/(app)/tickets/filters";
import type { TicketRow } from "@/app/(app)/tickets/serialize";

const CLIENT = { clientId: "c-1", targets: { CRITICAL: { respond: 1, resolve: 4 }, HIGH: { respond: 2, resolve: 8 }, MEDIUM: { respond: 3, resolve: 12 }, LOW: { respond: 4, resolve: 24 } } };
const COMPANY = { clientId: null, targets: { CRITICAL: { respond: 6, resolve: 12 }, HIGH: { respond: 6, resolve: 12 }, MEDIUM: { respond: 6, resolve: 12 }, LOW: { respond: 6, resolve: 12 } } };

describe("which policy applies: client override > company policy > built-in default", () => {
  it("takes the client's own override when it has one", () => {
    const r = pickPolicy([COMPANY, CLIENT], "c-1");
    expect(r.source).toBe("client");
    expect(r.targets.MEDIUM).toEqual({ respond: 3, resolve: 12 });
  });
  it("falls back to the company policy for a client without an override", () => {
    const r = pickPolicy([COMPANY, CLIENT], "c-2");
    expect(r.source).toBe("company");
    expect(r.targets.MEDIUM).toEqual({ respond: 6, resolve: 12 });
  });
  it("falls back to the built-in default when the company has no policy", () => {
    const r = pickPolicy([CLIENT], "c-2");
    expect(r.source).toBe("builtin");
    expect(r.targets).toEqual(DEFAULT_SLA_TARGETS);
    expect(pickPolicy([], null).source).toBe("builtin");
  });
  it("a ticket with no client never picks up another client's override", () => {
    expect(pickPolicy([CLIENT], null).source).toBe("builtin");
    expect(pickPolicy([COMPANY, CLIENT], null).source).toBe("company");
  });
  it("fills gaps in a half-configured policy from the built-in default", () => {
    const partial = { clientId: null, targets: { MEDIUM: { respond: 2 } } };
    const r = pickPolicy([partial], null);
    expect(r.targets.MEDIUM).toEqual({ respond: 2, resolve: DEFAULT_SLA_TARGETS.MEDIUM.resolve });
    expect(r.targets.LOW).toEqual(DEFAULT_SLA_TARGETS.LOW);
    expect(normalizeTargets({ MEDIUM: { respond: -5, resolve: "x" } }).MEDIUM).toEqual(DEFAULT_SLA_TARGETS.MEDIUM);
  });
  it("labels each source in the words the screens show", () => {
    expect(SLA_SOURCE_LABEL.client).toBe("Client override");
    expect(SLA_SOURCE_LABEL.company).toBe("Company policy");
    expect(SLA_SOURCE_LABEL.builtin).toBe("Built-in default");
  });
  it("renders targets and stored timestamps the same way", () => {
    expect(targetsLabel(pickPolicy([CLIENT], "c-1").targets, "MEDIUM")).toBe("respond 3h · resolve 12h");
    expect(labelFromTimestamps("2026-09-01T00:00:00.000Z", "2026-09-01T03:00:00.000Z", "2026-09-01T12:00:00.000Z")).toBe("respond 3h · resolve 12h");
  });
});

const row = (p: Partial<TicketRow>): TicketRow => ({
  id: "t", number: "TKT-1", title: "x", typeId: "ty", typeName: "Bug", typeColor: null, typeIcon: null,
  priority: "MEDIUM", statusId: "st", statusName: "Triage", statusColor: null, statusCategory: "OPEN", slaApplicable: true,
  requesterId: "u", assigneeId: null, clientId: null, requesterName: "R", assigneeName: null, clientName: null, projectName: null,
  category: "", systemRef: "", moduleRef: "", dueDate: "", respondBy: "", resolveBy: "", firstResponseAt: "", resolvedAt: "",
  createdAt: "2026-09-01T00:00:00.000Z", fields: {}, ...p,
});

describe("a type with no SLA is never measured against one", () => {
  const longPast = new Date(Date.now() - 86_400_000).toISOString();
  it("a breached ticket of an SLA type is still breached", () => {
    const rows = [row({ id: "sla", respondBy: longPast })];
    expect(filterRows(rows, { focus: "breached" }, "u").map((r) => r.id)).toEqual(["sla"]);
  });
  it("the same overdue deadline on a no-SLA type does not count as breached", () => {
    // Bug kept its deadlines from before the type moved to stages; they stay in the database, unused.
    const rows = [row({ id: "bug", respondBy: longPast, slaApplicable: false })];
    expect(filterRows(rows, { focus: "breached" }, "u")).toEqual([]);
  });
});
