import { describe, it, expect } from "vitest";
import { poValidityState } from "@/lib/opportunity";

const TODAY = "2026-09-13";

describe("poValidityState", () => {
  it("is none without a PO valid-until date", () => {
    expect(poValidityState(null, TODAY)).toBe("none");
  });
  it("is expired once the date has passed", () => {
    expect(poValidityState("2026-09-12", TODAY)).toBe("expired");
  });
  it("is expiring within the 30-day window, including today and exactly 30 days out", () => {
    expect(poValidityState(TODAY, TODAY)).toBe("expiring");
    expect(poValidityState("2026-10-13", TODAY)).toBe("expiring"); // exactly 30 days
  });
  it("is ok once past the 30-day window", () => {
    expect(poValidityState("2026-10-14", TODAY)).toBe("ok"); // 31 days
  });
});
