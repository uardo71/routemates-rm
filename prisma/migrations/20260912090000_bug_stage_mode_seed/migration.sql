-- Phase 1: Bug becomes a STAGE-mode type — four stages, three gates, and the three fields a triager
-- needs moved onto the Triage panel. Additive: nothing is deleted and no ticket is touched here;
-- mapping existing Bug tickets onto stages (and archiving the old Bug status list) is a separate step.

CREATE TEMP TABLE _bug_stage (key TEXT, name TEXT, ord INT, starting BOOLEAN, terminal BOOLEAN, descr TEXT);
INSERT INTO _bug_stage VALUES
    ('triage',           'Triage',           0, true,  false, 'Confirm the defect: reproduce it and set its severity.'),
    ('in_progress',      'In progress',      1, false, false, 'The fix is being built.'),
    ('fix_verification', 'Fix verification', 2, false, false, 'The fix is checked in a test environment before it closes.'),
    ('closed',           'Closed',           3, false, true,  'Fixed and verified, or closed without a fix.');

INSERT INTO "TicketStageDef" ("id", "companyId", "typeId", "key", "name", "description", "order", "isStarting", "isTerminal", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."companyId", t."id", s.key, s.name, s.descr, s.ord, s.starting, s.terminal, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketTypeDef" t CROSS JOIN _bug_stage s
WHERE t."key" = 'bug'
ON CONFLICT ("typeId", "key") DO NOTHING;

CREATE TEMP TABLE _bug_gate (stage_key TEXT, key TEXT, label TEXT, ord INT);
INSERT INTO _bug_gate VALUES
    ('triage',           'reproduced',   'Reproduced',                       0),
    ('triage',           'severity_set', 'Severity set',                     1),
    ('fix_verification', 'fix_verified', 'Fix verified in test environment', 0);

INSERT INTO "TicketStageGate" ("id", "companyId", "stageId", "key", "label", "order", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, sd."companyId", sd."id", g.key, g.label, g.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketStageDef" sd
JOIN "TicketTypeDef" t ON t."id" = sd."typeId"
JOIN _bug_gate g ON g.stage_key = sd."key"
WHERE t."key" = 'bug'
ON CONFLICT ("stageId", "key") DO NOTHING;

-- Severity, Environment and Steps to reproduce are what a triager checks "Reproduced" and
-- "Severity set" against, so they belong on the Triage panel rather than the general Details panel.
UPDATE "TicketFieldDef" f
SET "stageId" = sd."id", "updatedAt" = CURRENT_TIMESTAMP
FROM "TicketTypeDef" t, "TicketStageDef" sd
WHERE f."typeId" = t."id" AND t."key" = 'bug'
  AND sd."typeId" = t."id" AND sd."key" = 'triage'
  AND f."key" IN ('severity', 'environment', 'steps')
  AND f."archivedAt" IS NULL;

-- STAGE mode, and no SLA by design (slaApplicable is the flag the code will read; the legacy
-- slaExempt is deliberately left as it was, so this is reversible).
UPDATE "TicketTypeDef" SET "lifecycleMode" = 'STAGE', "slaApplicable" = false WHERE "key" = 'bug';

DROP TABLE _bug_stage;
DROP TABLE _bug_gate;
