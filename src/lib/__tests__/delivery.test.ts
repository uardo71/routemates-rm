import { describe, it, expect } from "vitest";
import { worstRag, ragDimensionsDiffer } from "@/lib/delivery";

describe("worstRag", () => {
  it("returns the worst of the given values, GREEN when nothing is given", () => {
    expect(worstRag()).toBe("GREEN");
    expect(worstRag("GREEN", "GREEN")).toBe("GREEN");
    expect(worstRag("GREEN", "AMBER", "GREEN")).toBe("AMBER");
    expect(worstRag("AMBER", "RED", null, undefined)).toBe("RED");
  });
  it("tells when the dimensions disagree with the overall", () => {
    expect(ragDimensionsDiffer({ overallRag: "GREEN", scheduleRag: "GREEN", budgetRag: "GREEN", scopeRag: "GREEN" })).toBe(false);
    expect(ragDimensionsDiffer({ overallRag: "GREEN", scheduleRag: "AMBER", budgetRag: "GREEN", scopeRag: "GREEN" })).toBe(true);
  });
});
