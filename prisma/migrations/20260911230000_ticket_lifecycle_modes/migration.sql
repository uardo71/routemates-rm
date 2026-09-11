-- Phase 1, migration A: the stage-mode framework, schema only. Additive — no column or row is
-- dropped, and every type stays in STATUS mode until its own seeding migration runs.

CREATE TYPE "TicketLifecycleMode" AS ENUM ('STATUS', 'STAGE');

-- Ticket types: how they track work, and whether SLA applies (slaApplicable supersedes slaExempt,
-- which stays untouched so this is reversible).
ALTER TABLE "TicketTypeDef" ADD COLUMN "lifecycleMode" "TicketLifecycleMode" NOT NULL DEFAULT 'STATUS';
ALTER TABLE "TicketTypeDef" ADD COLUMN "slaApplicable" BOOLEAN NOT NULL DEFAULT true;
UPDATE "TicketTypeDef" SET "slaApplicable" = NOT "slaExempt";

-- A status list retired when its type moves to STAGE mode: archived, never deleted.
ALTER TABLE "TicketStatusDef" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "TicketStatusDef" ADD COLUMN "archivedById" TEXT;

CREATE TABLE "TicketStageDef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isStarting" BOOLEAN NOT NULL DEFAULT false,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketStageDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketStageDef_typeId_key_key" ON "TicketStageDef"("typeId", "key");
CREATE INDEX "TicketStageDef_companyId_idx" ON "TicketStageDef"("companyId");
CREATE INDEX "TicketStageDef_typeId_idx" ON "TicketStageDef"("typeId");
ALTER TABLE "TicketStageDef" ADD CONSTRAINT "TicketStageDef_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "TicketTypeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketStageGate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketStageGate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketStageGate_stageId_key_key" ON "TicketStageGate"("stageId", "key");
CREATE INDEX "TicketStageGate_companyId_idx" ON "TicketStageGate"("companyId");
CREATE INDEX "TicketStageGate_stageId_idx" ON "TicketStageGate"("stageId");
ALTER TABLE "TicketStageGate" ADD CONSTRAINT "TicketStageGate_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "TicketStageDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketGateCheck" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedById" TEXT NOT NULL,
    CONSTRAINT "TicketGateCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketGateCheck_ticketId_gateId_key" ON "TicketGateCheck"("ticketId", "gateId");
CREATE INDEX "TicketGateCheck_gateId_idx" ON "TicketGateCheck"("gateId");
ALTER TABLE "TicketGateCheck" ADD CONSTRAINT "TicketGateCheck_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketGateCheck" ADD CONSTRAINT "TicketGateCheck_gateId_fkey"
    FOREIGN KEY ("gateId") REFERENCES "TicketStageGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A custom field can belong to one stage's panel (null = the general Details panel, as today).
ALTER TABLE "TicketFieldDef" ADD COLUMN "stageId" TEXT;
CREATE INDEX "TicketFieldDef_stageId_idx" ON "TicketFieldDef"("stageId");
ALTER TABLE "TicketFieldDef" ADD CONSTRAINT "TicketFieldDef_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "TicketStageDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Where a STAGE-mode ticket sits. STATUS-mode tickets leave it null and keep using statusId.
ALTER TABLE "Ticket" ADD COLUMN "stageId" TEXT;
CREATE INDEX "Ticket_stageId_idx" ON "Ticket"("stageId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "TicketStageDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
