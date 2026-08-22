-- Delivery Cockpit (PM governance): playbook checklist, status reports, RAID log.

CREATE TYPE "RagStatus" AS ENUM ('GREEN', 'AMBER', 'RED');
CREATE TYPE "RaidType" AS ENUM ('RISK', 'ASSUMPTION', 'ISSUE', 'DEPENDENCY', 'DECISION');
CREATE TYPE "RaidStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');
CREATE TYPE "RaidSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "PlaybookTask" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "phase"       TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "offsetDays"  INTEGER,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlaybookTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlaybookTask_companyId_idx" ON "PlaybookTask"("companyId");
ALTER TABLE "PlaybookTask" ADD CONSTRAINT "PlaybookTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProjectChecklistItem" (
  "id"            TEXT NOT NULL,
  "projectId"     TEXT NOT NULL,
  "phase"         TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "description"   TEXT,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "done"          BOOLEAN NOT NULL DEFAULT false,
  "dueDate"       TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "completedById" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectChecklistItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectChecklistItem_projectId_idx" ON "ProjectChecklistItem"("projectId");
ALTER TABLE "ProjectChecklistItem" ADD CONSTRAINT "ProjectChecklistItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectChecklistItem" ADD CONSTRAINT "ProjectChecklistItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StatusReport" (
  "id"              TEXT NOT NULL,
  "companyId"       TEXT NOT NULL,
  "projectId"       TEXT NOT NULL,
  "reportDate"      TIMESTAMP(3) NOT NULL,
  "periodStart"     TIMESTAMP(3),
  "periodEnd"       TIMESTAMP(3),
  "cadence"         TEXT,
  "overallRag"      "RagStatus" NOT NULL DEFAULT 'GREEN',
  "scheduleRag"     "RagStatus" NOT NULL DEFAULT 'GREEN',
  "budgetRag"       "RagStatus" NOT NULL DEFAULT 'GREEN',
  "scopeRag"        "RagStatus" NOT NULL DEFAULT 'GREEN',
  "summary"         TEXT,
  "accomplishments" TEXT,
  "nextSteps"       TEXT,
  "decisionsNeeded" TEXT,
  "milestoneNotes"  TEXT,
  "sentAt"          TIMESTAMP(3),
  "authorId"        TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StatusReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StatusReport_projectId_idx" ON "StatusReport"("projectId");
CREATE INDEX "StatusReport_companyId_idx" ON "StatusReport"("companyId");
ALTER TABLE "StatusReport" ADD CONSTRAINT "StatusReport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StatusReport" ADD CONSTRAINT "StatusReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatusReport" ADD CONSTRAINT "StatusReport_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RaidItem" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "type"        "RaidType" NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "severity"    "RaidSeverity",
  "status"      "RaidStatus" NOT NULL DEFAULT 'OPEN',
  "owner"       TEXT,
  "dueDate"     TIMESTAMP(3),
  "response"    TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RaidItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RaidItem_projectId_idx" ON "RaidItem"("projectId");
CREATE INDEX "RaidItem_companyId_idx" ON "RaidItem"("companyId");
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
