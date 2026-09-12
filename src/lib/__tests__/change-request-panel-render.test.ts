// The Change request lifecycle + record panel, rendered to HTML and snapshotted.
//
// The snapshots began life proving that extracting the shared lifecycle component changed nothing.
// They have since been regenerated twice ON PURPOSE — Phase 2 (the restyle) and Phase 3 (one panel
// per ticket, showing the stage the stepper is on). They guard the CURRENT intended output, and the
// outright assertions below guard the two rules a careless snapshot update could otherwise erase:
// an unmet gate is never a red cross, and only ONE stage is ever rendered at a time.
//
// Server-side deps are mocked away: this renders the client component only (its dialog is closed, so
// no router or toast is reached).
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock("sonner", () => ({ toast: { success() {}, error() {}, warning() {} } }));
vi.mock("@/app/(app)/tickets/cr-actions", () => ({ moveChangeRequestAction: async () => ({}) }));

import { ChangeRequestLifecycle, CrRecordSection, type CrView } from "@/app/(app)/tickets/[id]/change-request-panel";
import { EMPTY_CR_DRAFT, type CrDraft } from "@/lib/change-request";

const DRAFT: CrDraft = {
  ...EMPTY_CR_DRAFT,
  assessment: "Add the split-payment flag to the MIRO screen",
  estimateHours: "16",
  approvedByName: "M. Rossi",
  approvedOn: "2026-09-01",
  nextStep: "Send the estimate for approval",
  nextStepOwnerId: "u-2",
  nextStepDue: "2026-09-30",
};

const CR: CrView = {
  stage: "evaluation",
  statusName: "Evaluation",
  saved: DRAFT,
  events: [
    { id: "e1", fromKey: null, toKey: "evaluation", move: "START", note: "", overrideReason: "", byName: "Enida Selita", at: "2026-09-11T15:21:00.000Z" },
    { id: "e2", fromKey: "evaluation", toKey: "development", move: "FORWARD", note: "Approved on the call", overrideReason: "Customer confirmed by phone", byName: "Uard Bejtja", at: "2026-09-11T22:34:00.000Z" },
  ],
  timeInStage: { evaluation: 25_200_000 },
  stageSince: "2026-09-11T15:21:00.000Z",
  loggedMinutes: 150,
  evidence: { unit_testing: 1 },
  todayIso: "2026-09-12",
};

// The same change request with the customer's approval NOT yet recorded, so one of Evaluation's
// exit checks is unmet. Its only job is to put an incomplete gate mark in the stored snapshot: an
// empty ring. Work that is simply not done yet must never render as a red cross — that was the
// pattern this redesign set out to remove, and without this fixture no test would notice it coming
// back.
const DRAFT_UNMET: CrDraft = { ...DRAFT, approvedByName: "", approvedOn: "" };

const USERS = [{ id: "u-1", name: "Uard Bejtja" }, { id: "u-2", name: "Enida Selita" }];

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  // One tag per line, so a snapshot diff points at the element that changed.
  return renderToStaticMarkup(node).replace(/></g, ">\n<");
}

describe("Change request panel markup", () => {
  it("renders the lifecycle with only the current stage's record, never every stage at once", () => {
    const html = render(
      createElement(ChangeRequestLifecycle, {
        ticketId: "tkt-1", cr: CR, draft: DRAFT, set: () => {},
        editable: true, canManage: true, dirty: false,
        assigneeId: "u-1", resolution: "", users: USERS,
      }),
    );
    // The stage it is in — Evaluation — brings its own fields into the one panel.
    expect(html).toContain("Impact assessment and proposed solution");
    // ...and no other stage's fields are anywhere on the page. This is the whole point of Phase 3:
    // the old panel stacked Evaluation, Customer approval, Development, Unit testing, UAT and
    // Go-live on every change request, which was the duplicate lifecycle the redesign set out to kill.
    for (const otherStage of ["Transports / release", "Tested on", "Signed off by", "Went live on"]) {
      expect(html).not.toContain(otherStage);
    }
    expect(html).toMatchSnapshot();
  });

  it("renders one stage's record on its own", () => {
    const html = render(
      createElement(CrRecordSection, {
        draft: DRAFT, set: () => {}, editable: true, loggedMinutes: 150, stage: "evaluation",
      }),
    );
    expect(html).toMatchSnapshot();
  });

  it("marks an unmet gate with an empty ring, never a red cross", () => {
    const html = render(
      createElement(ChangeRequestLifecycle, {
        ticketId: "tkt-3", cr: { ...CR, saved: DRAFT_UNMET }, draft: DRAFT_UNMET, set: () => {},
        editable: true, canManage: true, dirty: false,
        assigneeId: "u-1", resolution: "", users: USERS,
      }),
    );
    // Asserted outright as well as snapshotted, so the intent survives a careless snapshot update.
    expect(html).toContain('class="size-[18px] shrink-0 rounded-full border-[1.6px] border-input"');
    expect(html).not.toContain("circle-x");
    expect(html).toMatchSnapshot();
  });

  it("renders a read-only, terminal change request", () => {
    const html = render(
      createElement(ChangeRequestLifecycle, {
        ticketId: "tkt-2", cr: { ...CR, stage: "closed", statusName: "Closed" }, draft: DRAFT, set: () => {},
        editable: false, canManage: false, dirty: true,
        assigneeId: "", resolution: "Live, no issues", users: USERS,
      }),
    );
    expect(html).toMatchSnapshot();
  });
});
