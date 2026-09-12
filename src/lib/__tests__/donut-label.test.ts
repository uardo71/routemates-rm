import { describe, it, expect } from "vitest";

// The donut's centre label is sized from the space it actually has, not guessed from three Tailwind
// steps. This reproduces that arithmetic so the rule itself is pinned: whatever the value grows to
// over the years, the text must still fit inside the ring's hole.
const MONO_ADVANCE_EM = 0.62;
// The label wraps at spaces, so what must fit on one line is the longest unbreakable run.
const longestRun = (label: string) => Math.max(...label.split(/\s+/).map((w) => w.length));
const labelPx = (label: string, size = 112, thickness = 14) => {
  const hole = size - thickness * 2;
  return Math.max(9, Math.min(18, Math.floor((hole - 6) / (Math.max(1, longestRun(label)) * MONO_ADVANCE_EM))));
};
const widthOf = (label: string, px: number) => longestRun(label) * px * MONO_ADVANCE_EM;
const holeOf = (size = 112, thickness = 14) => size - thickness * 2;

describe("the donut centre label always fits the ring", () => {
  it("fits the value that overflowed before (€177,300.00 on a project page)", () => {
    const v = "€177,300.00";
    expect(widthOf(v, labelPx(v))).toBeLessThanOrEqual(holeOf());
    // The old rule picked text-sm (14px) for an 11-character string, which did NOT fit.
    expect(widthOf(v, 14)).toBeGreaterThan(holeOf());
  });

  it("fits amounts as they grow — thousands, millions, a long currency code", () => {
    for (const v of ["€1,000.00", "€177,300.00", "€1,234,567.00", "ALL 947,915.00", "ALL 12,345,678.00"]) {
      expect(widthOf(v, labelPx(v))).toBeLessThanOrEqual(holeOf());
    }
  });

  it("never shrinks past readable, and never inflates a short value past the old maximum", () => {
    // A value this long with no space left to break at is clipped (overflow-hidden) rather than
    // shrunk into illegibility — the whole figure stays available in the tooltip.
    expect(labelPx("€1,234,567,890,123.00")).toBe(9);
    expect(labelPx("7")).toBe(18);
  });

  it("scales with the ring it is drawn in", () => {
    const v = "€177,300.00";
    expect(widthOf(v, labelPx(v, 160, 16))).toBeLessThanOrEqual(holeOf(160, 16));
    expect(labelPx(v, 160, 16)).toBeGreaterThan(labelPx(v, 112, 14));
  });
});
