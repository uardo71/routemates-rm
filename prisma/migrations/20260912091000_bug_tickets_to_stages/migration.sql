-- Phase 1: existing Bug tickets move onto the seeded Bug stages, and the old Bug status list is
-- archived. Nothing is deleted: every ticket keeps its statusId and every status row stays, so the
-- old status still displays read-only and switching the type back restores it.
--
-- Mapping (agreed with the owner, and what scripts/migrate-bug-stage-mode.ts dry-runs): a status in
-- a finished category (DONE or CANCELLED — Closed, Verified, Won't fix) lands on the Closed stage;
-- anything still in flight (New, Triaged, In progress, In review, Fixed) lands on Triage. Reading the
-- CATEGORY rather than a fixed list of keys means a status an admin added later maps sensibly too.
--
-- A no-op where there are no Bug tickets (both environments at the time of writing). Idempotent:
-- only tickets without a stage are moved, only un-archived statuses are archived.

UPDATE "Ticket" k
SET "stageId" = sd."id"
FROM "TicketTypeDef" t, "TicketStatusDef" st, "TicketStageDef" sd
WHERE k."typeId" = t."id"
  AND t."key" = 'bug'
  AND k."stageId" IS NULL
  AND st."id" = k."statusId"
  AND sd."typeId" = t."id"
  AND sd."key" = CASE WHEN st."category"::text IN ('DONE', 'CANCELLED') THEN 'closed' ELSE 'triage' END;

UPDATE "TicketStatusDef" s
SET "archivedAt" = CURRENT_TIMESTAMP, "archivedById" = 'system'
FROM "TicketTypeDef" t
WHERE s."typeId" = t."id"
  AND t."key" = 'bug'
  AND s."archivedAt" IS NULL;
