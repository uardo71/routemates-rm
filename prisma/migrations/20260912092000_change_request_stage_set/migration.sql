-- Phase 1, migration B: Change request's lifecycle becomes data — seven stages, their gates, and the
-- record's values as stage-scoped custom fields. Existing values are COPIED into the new field system
-- (decision (a)); the ChangeRequest columns stay exactly as they are, unused, so this is reversible.
--
-- Deliberately NOT done here: archiving the Change request status list. Its code still writes a
-- status on every stage move, so archiving waits for its own migration once the panel no longer does.
-- "Rejected" has no stage (agreed gap): such a ticket gets no stage and its status stays its truth.

-- ---------- stages ----------

CREATE TEMP TABLE _cr_stage (key TEXT, name TEXT, ord INT, starting BOOLEAN, terminal BOOLEAN, descr TEXT);
INSERT INTO _cr_stage VALUES
    ('evaluation',   'Evaluation',   0, true,  false, 'Understand the change, size it and get the customer''s go-ahead before anyone builds.'),
    ('development',  'Development',  1, false, false, 'Build the approved change in the development system.'),
    ('unit_testing', 'Unit testing', 2, false, false, 'Prove the change works before the customer sees it.'),
    ('uat',          'UAT',          3, false, false, 'The customer tests in their QA system and signs it off.'),
    ('go_live',      'Go-live',      4, false, false, 'Move the change to production in the agreed slot.'),
    ('closing',      'Closing',      5, false, false, 'Hypercare and wrap-up.'),
    ('closed',       'Closed',       6, false, true,  'Delivered and closed.');

INSERT INTO "TicketStageDef" ("id", "companyId", "typeId", "key", "name", "description", "order", "isStarting", "isTerminal", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."companyId", t."id", s.key, s.name, s.descr, s.ord, s.starting, s.terminal, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketTypeDef" t CROSS JOIN _cr_stage s
WHERE t."key" = 'change_request'
ON CONFLICT ("typeId", "key") DO NOTHING;

-- ---------- gates (the checks the code applies today) ----------

CREATE TEMP TABLE _cr_gate (stage_key TEXT, key TEXT, label TEXT, ord INT);
INSERT INTO _cr_gate VALUES
    ('evaluation',   'impact_assessment', 'Impact assessment written',         0),
    ('evaluation',   'effort_estimated',  'Effort estimated',                  1),
    ('evaluation',   'customer_approval', 'Customer approval recorded',        2),
    ('development',  'developer_assigned','Developer assigned',                0),
    ('development',  'planned_go_live',   'Planned go-live date agreed',       1),
    ('unit_testing', 'unit_test_results', 'Unit test results recorded',        0),
    ('uat',          'uat_sign_off',      'UAT signed off by the customer',    0),
    ('go_live',      'go_live_date',      'Go-live date recorded',             0),
    ('closing',      'closing_summary',   'Closing summary written',           0);

INSERT INTO "TicketStageGate" ("id", "companyId", "stageId", "key", "label", "order", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, sd."companyId", sd."id", g.key, g.label, g.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketStageDef" sd
JOIN "TicketTypeDef" t ON t."id" = sd."typeId"
JOIN _cr_gate g ON g.stage_key = sd."key"
WHERE t."key" = 'change_request'
ON CONFLICT ("stageId", "key") DO NOTHING;

-- ---------- the record, as stage-scoped fields ----------
-- Staff-only (customerVisible false), optional: the gates enforce, not the form — same as today.

CREATE TEMP TABLE _cr_field (stage_key TEXT, key TEXT, name TEXT, kind TEXT, ord INT);
INSERT INTO _cr_field VALUES
    ('evaluation',   'impact_assessment',     'Impact assessment',     'TEXTAREA', 10),
    ('evaluation',   'effort_estimate_hours', 'Effort estimate (hours)','NUMBER',  11),
    ('evaluation',   'quote_ref',             'Quote reference',       'TEXT',     12),
    ('evaluation',   'approved_by',           'Approved by',           'TEXT',     13),
    ('evaluation',   'approved_on',           'Approved on',           'DATE',     14),
    ('evaluation',   'po_reference',          'PO / e-mail reference', 'TEXT',     15),
    ('development',  'planned_go_live',       'Planned go-live',       'DATE',     20),
    ('development',  'transports_release',    'Transports / release',  'TEXTAREA', 21),
    ('unit_testing', 'test_results',          'Test results',          'TEXTAREA', 30),
    ('unit_testing', 'tested_on',             'Tested on',             'DATE',     31),
    ('uat',          'uat_signed_off_by',     'Signed off by',         'TEXT',     40),
    ('uat',          'uat_signed_off_on',     'Signed off on',         'DATE',     41),
    ('uat',          'uat_notes',             'UAT notes',             'TEXTAREA', 42),
    ('go_live',      'went_live_on',          'Went live on',          'DATE',     50);

INSERT INTO "TicketFieldDef" ("id", "companyId", "typeId", "stageId", "key", "name", "kind", "required", "customerVisible", "customerEditable", "order", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."companyId", t."id", sd."id", f.key, f.name, f.kind::"TicketFieldKind", false, false, false, f.ord, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketTypeDef" t
JOIN "TicketStageDef" sd ON sd."typeId" = t."id"
JOIN _cr_field f ON f.stage_key = sd."key"
WHERE t."key" = 'change_request'
ON CONFLICT ("companyId", "typeId", "key") DO NOTHING;

-- The rollback plan already exists as a Change request field: point it at Go-live, don't duplicate it.
UPDATE "TicketFieldDef" f
SET "stageId" = sd."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "TicketTypeDef" t, "TicketStageDef" sd
WHERE f."typeId" = t."id" AND t."key" = 'change_request'
  AND sd."typeId" = t."id" AND sd."key" = 'go_live'
  AND f."key" = 'rollback_plan' AND f."archivedAt" IS NULL AND f."stageId" IS NULL;

-- ---------- copy the existing values in ----------
-- Empty values are skipped; anything already copied is left alone (so this can be re-run).

INSERT INTO "TicketFieldValue" ("id", "ticketId", "fieldId", "value")
SELECT gen_random_uuid()::text, cr."ticketId", f."id", v.val
FROM "ChangeRequest" cr
JOIN "Ticket" k ON k."id" = cr."ticketId"
JOIN "TicketTypeDef" t ON t."id" = k."typeId" AND t."key" = 'change_request'
CROSS JOIN LATERAL (VALUES
    ('impact_assessment',     to_jsonb(cr."assessment")),
    ('effort_estimate_hours', to_jsonb(cr."estimateHours")),
    ('quote_ref',             to_jsonb(cr."quoteReference")),
    ('approved_by',           to_jsonb(cr."approvedByName")),
    ('approved_on',           to_jsonb(to_char(cr."approvedOn", 'YYYY-MM-DD'))),
    ('po_reference',          to_jsonb(cr."approvalReference")),
    ('planned_go_live',       to_jsonb(to_char(cr."plannedGoLive", 'YYYY-MM-DD'))),
    ('transports_release',    to_jsonb(cr."buildReference")),
    ('test_results',          to_jsonb(cr."unitTestNotes")),
    ('tested_on',             to_jsonb(to_char(cr."unitTestedOn", 'YYYY-MM-DD'))),
    ('uat_signed_off_by',     to_jsonb(cr."uatSignedOffBy")),
    ('uat_signed_off_on',     to_jsonb(to_char(cr."uatSignedOffOn", 'YYYY-MM-DD'))),
    ('uat_notes',             to_jsonb(cr."uatNotes")),
    ('went_live_on',          to_jsonb(to_char(cr."goLiveOn", 'YYYY-MM-DD')))
) AS v(field_key, val)
JOIN "TicketFieldDef" f ON f."typeId" = t."id" AND f."key" = v.field_key
WHERE v.val IS NOT NULL
  AND (jsonb_typeof(v.val) <> 'string' OR btrim(v.val #>> '{}') <> '')
ON CONFLICT ("ticketId", "fieldId") DO NOTHING;

-- ---------- the tickets, and the mode ----------
-- Stage keys match the status keys the type already uses, so each ticket keeps its place.

UPDATE "Ticket" k
SET "stageId" = sd."id"
FROM "TicketTypeDef" t, "TicketStatusDef" st, "TicketStageDef" sd
WHERE k."typeId" = t."id" AND t."key" = 'change_request'
  AND k."stageId" IS NULL
  AND st."id" = k."statusId"
  AND sd."typeId" = t."id"
  AND sd."key" = st."key";

UPDATE "TicketTypeDef" SET "lifecycleMode" = 'STAGE' WHERE "key" = 'change_request';

DROP TABLE _cr_stage;
DROP TABLE _cr_gate;
DROP TABLE _cr_field;
