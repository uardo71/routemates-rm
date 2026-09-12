import { describe, it, expect } from "vitest";
import { slaBadgeState, SLA_AT_RISK_MS } from "@/app/(app)/tickets/sla";

const NOW = Date.UTC(2026, 8, 12, 9, 0, 0);
const at = (ms: number) => new Date(NOW + ms).toISOString();
const row = (p: Partial<Parameters<typeof slaBadgeState>[0]>) => ({
  statusCategory: "OPEN" as const, firstResponseAt: "", respondBy: "", resolveBy: "", slaApplicable: true, ...p,
});

describe("the SLA badge has four states and no more", () => {
  it("is on track while there is comfortable time left", () => {
    const s = slaBadgeState(row({ respondBy: at(28 * 3_600_000) }), NOW);
    expect(s.kind).toBe("on_track");
    expect(s.show).toBe(true);
    expect(s.label).toBe("On track");
    expect(s.detail).toBe("respond in 1d");
  });

  it("is at risk inside the threshold, and on track exactly on it", () => {
    expect(slaBadgeState(row({ respondBy: at(SLA_AT_RISK_MS - 1) }), NOW).kind).toBe("at_risk");
    expect(slaBadgeState(row({ respondBy: at(SLA_AT_RISK_MS) }), NOW).kind).toBe("on_track");
  });

  it("is breached once the target has passed, and says by how much", () => {
    const s = slaBadgeState(row({ respondBy: at(-3 * 3_600_000) }), NOW);
    expect(s.kind).toBe("breached");
    expect(s.detail).toBe("respond overdue by 3h");
    // The moment the target lands is already breached, not "at risk with 0 left".
    expect(slaBadgeState(row({ respondBy: at(0) }), NOW).kind).toBe("breached");
  });

  it("measures resolve once the ticket has been answered", () => {
    const s = slaBadgeState(row({ firstResponseAt: at(-2 * 3_600_000), respondBy: at(-3 * 3_600_000), resolveBy: at(2 * 3_600_000) }), NOW);
    expect(s.kind).toBe("at_risk");
    expect(s.detail).toBe("resolve in 2h");
  });
});

describe("no SLA is a state of its own, and never renders by itself", () => {
  it("a type with no SLA reads 'No SLA' and draws nothing unless asked", () => {
    const s = slaBadgeState(row({ slaApplicable: false, respondBy: at(-99 * 3_600_000) }), NOW);
    expect(s.kind).toBe("none");
    expect(s.label).toBe("No SLA");
    expect(s.show).toBe(false); // an overdue leftover deadline on a stage-run type stays invisible
  });

  it("a stopped clock and a missing target are the same nothing", () => {
    expect(slaBadgeState(row({ statusCategory: "DONE", respondBy: at(-5 * 3_600_000) }), NOW)).toMatchObject({ kind: "none", show: false });
    expect(slaBadgeState(row({ statusCategory: "CANCELLED", respondBy: at(5 * 3_600_000) }), NOW)).toMatchObject({ kind: "none", show: false });
    expect(slaBadgeState(row({}), NOW)).toMatchObject({ kind: "none", show: false });
  });
});
