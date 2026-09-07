-- Configurable ticketing + customer portal.
-- The Ticket table is empty at this point, so type/status enum columns are dropped and replaced
-- with FK references to the new configuration tables without a data migration.

-- 1. Customer portal role (value only added here; not used within this migration)
ALTER TYPE "SystemRole" ADD VALUE 'CUSTOMER';

-- 2. New configuration enums
CREATE TYPE "TicketStatusCategory" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');
CREATE TYPE "TicketFieldKind" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'CHECKBOX', 'USER');

-- 3. Portal users belong to a client
ALTER TABLE "User" ADD COLUMN "clientId" TEXT;
CREATE INDEX "User_clientId_idx" ON "User"("clientId");
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Configuration tables
CREATE TABLE "TicketTypeDef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "customerCanCreate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketTypeDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketTypeDef_companyId_key_key" ON "TicketTypeDef"("companyId", "key");
CREATE INDEX "TicketTypeDef_companyId_idx" ON "TicketTypeDef"("companyId");

CREATE TABLE "TicketStatusDef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "category" "TicketStatusCategory" NOT NULL DEFAULT 'OPEN',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "customerCanSet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketStatusDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketStatusDef_typeId_key_key" ON "TicketStatusDef"("typeId", "key");
CREATE INDEX "TicketStatusDef_companyId_idx" ON "TicketStatusDef"("companyId");
CREATE INDEX "TicketStatusDef_typeId_idx" ON "TicketStatusDef"("typeId");

CREATE TABLE "TicketFieldDef" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TicketFieldKind" NOT NULL DEFAULT 'TEXT',
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "customerEditable" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketFieldDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketFieldDef_companyId_typeId_key_key" ON "TicketFieldDef"("companyId", "typeId", "key");
CREATE INDEX "TicketFieldDef_companyId_idx" ON "TicketFieldDef"("companyId");

CREATE TABLE "TicketFieldValue" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    CONSTRAINT "TicketFieldValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketFieldValue_ticketId_fieldId_key" ON "TicketFieldValue"("ticketId", "fieldId");
CREATE INDEX "TicketFieldValue_fieldId_idx" ON "TicketFieldValue"("fieldId");

CREATE TABLE "TicketView" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "columns" JSONB NOT NULL DEFAULT '[]',
    "sort" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TicketView_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketView_companyId_idx" ON "TicketView"("companyId");
CREATE INDEX "TicketView_ownerId_idx" ON "TicketView"("ownerId");

-- 5. Rework Ticket: swap enum columns for FK references
DROP INDEX "Ticket_companyId_status_idx";
ALTER TABLE "Ticket" DROP COLUMN "type";
ALTER TABLE "Ticket" DROP COLUMN "status";
ALTER TABLE "Ticket" ADD COLUMN "typeId" TEXT NOT NULL;
ALTER TABLE "Ticket" ADD COLUMN "statusId" TEXT NOT NULL;
CREATE INDEX "Ticket_companyId_statusId_idx" ON "Ticket"("companyId", "statusId");
CREATE INDEX "Ticket_typeId_idx" ON "Ticket"("typeId");
CREATE INDEX "Ticket_statusId_idx" ON "Ticket"("statusId");
CREATE INDEX "Ticket_clientId_idx" ON "Ticket"("clientId");

-- 6. Staff-only internal comments
ALTER TABLE "TicketComment" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;

-- 7. Old fixed enums are no longer referenced
DROP TYPE "TicketType";
DROP TYPE "TicketStatus";

-- 8. Foreign keys
ALTER TABLE "TicketTypeDef" ADD CONSTRAINT "TicketTypeDef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketStatusDef" ADD CONSTRAINT "TicketStatusDef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketStatusDef" ADD CONSTRAINT "TicketStatusDef_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketTypeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketFieldDef" ADD CONSTRAINT "TicketFieldDef_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketFieldDef" ADD CONSTRAINT "TicketFieldDef_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketTypeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketFieldValue" ADD CONSTRAINT "TicketFieldValue_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketFieldValue" ADD CONSTRAINT "TicketFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "TicketFieldDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketView" ADD CONSTRAINT "TicketView_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketView" ADD CONSTRAINT "TicketView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketTypeDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatusDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
