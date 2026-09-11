// Where a change request's record lives now: each value is a stage-scoped custom field
// (migration 20260912092000_change_request_stage_set), not a column on ChangeRequest. This module is
// the single mapping between the panel's draft (all text, as the form holds it) and those field keys.
//
// The next step (what / owner / due) is deliberately NOT here: it applies at any stage, so it stays
// on the ChangeRequest row. The old ChangeRequest columns are kept, unused, so the swap is reversible.

import type { CrDraft } from "@/lib/change-request";

export const CR_FIELD_KEY = {
  assessment: "impact_assessment",
  estimateHours: "effort_estimate_hours",
  quoteReference: "quote_ref",
  approvedByName: "approved_by",
  approvedOn: "approved_on",
  approvalReference: "po_reference",
  plannedGoLive: "planned_go_live",
  buildReference: "transports_release",
  unitTestNotes: "test_results",
  unitTestedOn: "tested_on",
  uatSignedOffBy: "uat_signed_off_by",
  uatSignedOffOn: "uat_signed_off_on",
  uatNotes: "uat_notes",
  goLiveOn: "went_live_on",
} as const satisfies Partial<Record<keyof CrDraft, string>>;

export type CrFieldDraftKey = keyof typeof CR_FIELD_KEY;
export const CR_FIELD_DRAFT_KEYS = Object.keys(CR_FIELD_KEY) as CrFieldDraftKey[];
export const CR_FIELD_KEYS: string[] = Object.values(CR_FIELD_KEY);

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};

/** Stored field values (keyed by field key, as the custom-field system holds them: text, a number for
 *  hours, yyyy-MM-dd for dates) → the panel's text draft. */
export function crDraftFromValues(byFieldKey: Record<string, unknown>): Pick<CrDraft, CrFieldDraftKey> {
  const out = {} as Pick<CrDraft, CrFieldDraftKey>;
  for (const k of CR_FIELD_DRAFT_KEYS) out[k] = text(byFieldKey[CR_FIELD_KEY[k]]);
  return out;
}

/** The panel's draft → raw values to store, keyed by field key. `hours` is the parsed estimate (the
 *  draft keeps it as typed, and "7,5" must not reach the number field as 7). An empty string clears
 *  the value, which is how the custom-field system deletes it. */
export function crValuesFromDraft(d: CrDraft, hours: number | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of CR_FIELD_DRAFT_KEYS) out[CR_FIELD_KEY[k]] = d[k];
  out[CR_FIELD_KEY.estimateHours] = hours === null ? "" : hours;
  return out;
}
