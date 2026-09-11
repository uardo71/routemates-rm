import { describe, it, expect } from "vitest";
import { CR_FIELD_KEY, CR_FIELD_KEYS, crDraftFromValues, crValuesFromDraft } from "@/lib/change-request-fields";
import { EMPTY_CR_DRAFT, parseHours, type CrDraft } from "@/lib/change-request";

const FULL: CrDraft = {
  ...EMPTY_CR_DRAFT,
  assessment: "New field on the MIRO screen", estimateHours: "16", quoteReference: "Q-77",
  approvedByName: "M. Rossi", approvedOn: "2026-09-01", approvalReference: "PO-42",
  plannedGoLive: "2026-10-01", buildReference: "DA1K900123",
  unitTestNotes: "All six scenarios pass", unitTestedOn: "2026-09-15",
  uatSignedOffBy: "M. Rossi", uatSignedOffOn: "2026-09-20", uatNotes: "No defects",
  goLiveOn: "2026-10-01",
  nextStep: "Send the estimate", nextStepOwnerId: "u1", nextStepDue: "2026-09-30",
};

describe("the record maps to stage-scoped fields", () => {
  it("round-trips every mapped value through stored field values", () => {
    const raw = crValuesFromDraft(FULL, parseHours(FULL.estimateHours));
    const back = crDraftFromValues(raw);
    for (const k of Object.keys(CR_FIELD_KEY) as (keyof typeof CR_FIELD_KEY)[]) {
      expect(back[k], k).toBe(FULL[k]);
    }
  });
  it("stores the estimate as a number, so a comma decimal survives", () => {
    const raw = crValuesFromDraft({ ...FULL, estimateHours: "7,5" }, parseHours("7,5"));
    expect(raw[CR_FIELD_KEY.estimateHours]).toBe(7.5);
    expect(crDraftFromValues(raw).estimateHours).toBe("7.5");
  });
  it("an empty draft clears every field (empty string = delete the value)", () => {
    const raw = crValuesFromDraft(EMPTY_CR_DRAFT, null);
    expect(new Set(Object.keys(raw))).toEqual(new Set(CR_FIELD_KEYS));
    expect(Object.values(raw).every((v) => v === "")).toBe(true);
  });
  it("missing stored values read as empty text, not undefined", () => {
    const back = crDraftFromValues({});
    expect(back.assessment).toBe("");
    expect(back.goLiveOn).toBe("");
  });
  it("the next step is not a stage field — it stays on the record row", () => {
    const raw = crValuesFromDraft(FULL, 16);
    expect(Object.keys(raw)).not.toContain("next_step");
    expect(Object.values(raw)).not.toContain("Send the estimate");
    expect(CR_FIELD_KEYS).toHaveLength(14);
  });
});
