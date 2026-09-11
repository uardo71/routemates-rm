-- Migration B pointed "Rollback plan" at the Go-live stage. The Change request panel renders a fixed
-- set of values, so a stage-scoped field outside that set would stop being shown anywhere — and this
-- phase is a plumbing swap that must leave the UI identical. Put it back on the general Details panel;
-- it can move onto Go-live when the redesigned stage panel lands and can render arbitrary fields.
UPDATE "TicketFieldDef" f
SET "stageId" = NULL, "updatedAt" = CURRENT_TIMESTAMP
FROM "TicketTypeDef" t
WHERE f."typeId" = t."id" AND t."key" = 'change_request' AND f."key" = 'rollback_plan';
