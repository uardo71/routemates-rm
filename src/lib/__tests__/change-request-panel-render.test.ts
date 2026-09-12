// The Change request lifecycle + record panel, rendered to HTML and snapshotted.
//
// Why: extracting the lifecycle rendering into a component Bug can reuse must not change a single
// character of what Change request draws. The snapshot below was captured from the panel BEFORE that
// extraction; if the refactor alters the markup in any way, this test fails. It stays afterwards as a
// regression guard on the panel's output.
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
  it("renders the lifecycle exactly as before the generic-stage extraction", () => {
    const html = render(
      createElement(ChangeRequestLifecycle, {
        ticketId: "tkt-1", cr: CR, draft: DRAFT, set: () => {},
        editable: true, canManage: true, dirty: false,
        assigneeId: "u-1", resolution: "", users: USERS,
      }),
    );
    expect(html).toMatchSnapshot();
  });

  it("renders the record section exactly as before", () => {
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

  it("renders a read-only, terminal change request the same way too", () => {
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
