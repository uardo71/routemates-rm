-- Change requests: a gated stage lifecycle with no SLA, a record of what each stage produced, stage
-- history, a next step, and stage-tagged attachments.

ALTER TABLE "TicketTypeDef" ADD COLUMN "slaExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TicketAttachment" ADD COLUMN "stageKey" TEXT;

CREATE TABLE "ChangeRequest" (
    "ticketId" TEXT NOT NULL,
    "assessment" TEXT,
    "estimateHours" DECIMAL(8,2),
    "quoteReference" TEXT,
    "approvedByName" TEXT,
    "approvedOn" TIMESTAMP(3),
    "approvalReference" TEXT,
    "plannedGoLive" TIMESTAMP(3),
    "buildReference" TEXT,
    "unitTestNotes" TEXT,
    "unitTestedOn" TIMESTAMP(3),
    "uatSignedOffBy" TEXT,
    "uatSignedOffOn" TIMESTAMP(3),
    "uatNotes" TEXT,
    "goLiveOn" TIMESTAMP(3),
    "nextStep" TEXT,
    "nextStepOwnerId" TEXT,
    "nextStepDue" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY ("ticketId")
);
ALTER TABLE "ChangeRequest" ADD CONSTRAINT "ChangeRequest_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChangeRequestStageEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromKey" TEXT,
    "toKey" TEXT NOT NULL,
    "move" TEXT NOT NULL,
    "note" TEXT,
    "overrideReason" TEXT,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeRequestStageEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeRequestStageEvent_ticketId_at_idx" ON "ChangeRequestStageEvent"("ticketId", "at");
ALTER TABLE "ChangeRequestStageEvent" ADD CONSTRAINT "ChangeRequestStageEvent_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- the change_request type's workflow becomes the lifecycle ----------

UPDATE "TicketTypeDef" SET "slaExempt" = true WHERE "key" = 'change_request';

CREATE TEMP TABLE _cr_stage (key TEXT, name TEXT, color TEXT, category TEXT, ord INT);
INSERT INTO _cr_stage VALUES
    ('evaluation',   'Evaluation',   'violet',  'OPEN',        0),
    ('development',  'Development',  'blue',    'IN_PROGRESS', 1),
    ('unit_testing', 'Unit testing', 'cyan',    'IN_PROGRESS', 2),
    ('uat',          'UAT',          'amber',   'IN_PROGRESS', 3),
    ('go_live',      'Go-live',      'teal',    'IN_PROGRESS', 4),
    ('closing',      'Closing',      'lime',    'IN_PROGRESS', 5),
    ('closed',       'Closed',       'emerald', 'DONE',        6),
    ('rejected',     'Rejected',     'red',     'CANCELLED',   7);

INSERT INTO "TicketStatusDef" ("id", "companyId", "typeId", "key", "name", "color", "category", "order",
                               "isInitial", "customerVisible", "customerCanSet", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."companyId", t."id", s.key, s.name, s.color, s.category::"TicketStatusCategory", s.ord,
       false, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TicketTypeDef" t CROSS JOIN _cr_stage s
WHERE t."key" = 'change_request'
ON CONFLICT ("typeId", "key") DO NOTHING;

-- Existing rows with a stage key (the old "closed" and "rejected") take the canonical definition.
UPDATE "TicketStatusDef" sd
SET "name" = s.name, "color" = s.color, "category" = s.category::"TicketStatusCategory", "order" = s.ord,
    "customerCanSet" = false, "updatedAt" = CURRENT_TIMESTAMP
FROM "TicketTypeDef" t, _cr_stage s
WHERE sd."typeId" = t."id" AND t."key" = 'change_request' AND sd."key" = s.key;

-- Tickets in the old statuses move to the matching stage; the old statuses go.
CREATE TEMP TABLE _cr_map (old_key TEXT, new_key TEXT);
INSERT INTO _cr_map VALUES
    ('submitted', 'evaluation'), ('under_review', 'evaluation'),
    ('approved', 'development'), ('scheduled', 'development'),
    ('implemented', 'go_live');

UPDATE "Ticket" k SET "statusId" = nw."id"
FROM "TicketStatusDef" od, _cr_map m, "TicketStatusDef" nw, "TicketTypeDef" t
WHERE k."statusId" = od."id" AND od."typeId" = t."id" AND t."key" = 'change_request'
  AND od."key" = m.old_key AND nw."typeId" = t."id" AND nw."key" = m.new_key;

DELETE FROM "TicketStatusDef" od
USING "TicketTypeDef" t, _cr_map m
WHERE od."typeId" = t."id" AND t."key" = 'change_request' AND od."key" = m.old_key
  AND NOT EXISTS (SELECT 1 FROM "Ticket" k WHERE k."statusId" = od."id");

-- Statuses an admin added to the type keep working, listed after the lifecycle.
UPDATE "TicketStatusDef" sd SET "order" = 20 + sd."order"
FROM "TicketTypeDef" t
WHERE sd."typeId" = t."id" AND t."key" = 'change_request' AND sd."key" NOT IN (SELECT key FROM _cr_stage);

UPDATE "TicketStatusDef" sd SET "isInitial" = (sd."key" = 'evaluation')
FROM "TicketTypeDef" t
WHERE sd."typeId" = t."id" AND t."key" = 'change_request';

-- No SLA on change requests.
UPDATE "Ticket" k SET "respondBy" = NULL, "resolveBy" = NULL
FROM "TicketTypeDef" t
WHERE k."typeId" = t."id" AND t."slaExempt";

-- Every existing change request gets its record and a starting stage event.
INSERT INTO "ChangeRequest" ("ticketId", "createdAt", "updatedAt")
SELECT k."id", k."createdAt", CURRENT_TIMESTAMP
FROM "Ticket" k JOIN "TicketTypeDef" t ON t."id" = k."typeId"
WHERE t."key" = 'change_request'
ON CONFLICT DO NOTHING;

INSERT INTO "ChangeRequestStageEvent" ("id", "ticketId", "fromKey", "toKey", "move", "byId", "at")
SELECT gen_random_uuid()::text, k."id", NULL, sd."key", 'START', k."createdById", k."createdAt"
FROM "Ticket" k
JOIN "TicketTypeDef" t ON t."id" = k."typeId"
JOIN "TicketStatusDef" sd ON sd."id" = k."statusId"
WHERE t."key" = 'change_request';

DROP TABLE _cr_stage;
DROP TABLE _cr_map;
