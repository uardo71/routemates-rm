-- UAT test scripts
CREATE TYPE "UatResult" AS ENUM ('NOT_RUN', 'OK', 'KO', 'REDO');
CREATE TYPE "UatScriptStatus" AS ENUM ('DRAFT', 'READY', 'SENT');
CREATE TYPE "UatIssueStatus" AS ENUM ('OPEN', 'CLOSED');

ALTER TABLE "Project" ADD COLUMN "uatScriptStatus" "UatScriptStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Project" ADD COLUMN "uatScriptSentAt" TIMESTAMP(3);

CREATE TABLE "UatArea" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "overview" TEXT,
    "dataRequirements" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UatArea_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UatArea_projectId_idx" ON "UatArea"("projectId");
CREATE INDEX "UatArea_companyId_idx" ON "UatArea"("companyId");

CREATE TABLE "UatTestCase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "description" TEXT,
    "prerequisites" TEXT,
    "expectedResults" TEXT,
    "runBy" TEXT,
    "dateRun" TIMESTAMP(3),
    "result" "UatResult" NOT NULL DEFAULT 'NOT_RUN',
    "reasonForFailure" TEXT,
    "docNo" TEXT,
    "comments" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UatTestCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UatTestCase_areaId_idx" ON "UatTestCase"("areaId");
CREATE INDEX "UatTestCase_projectId_idx" ON "UatTestCase"("projectId");
CREATE INDEX "UatTestCase_companyId_idx" ON "UatTestCase"("companyId");

CREATE TABLE "UatIssue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "areaRef" TEXT,
    "testRef" TEXT,
    "type" TEXT,
    "description" TEXT,
    "correctiveAction" TEXT,
    "assigned" TEXT,
    "status" "UatIssueStatus" NOT NULL DEFAULT 'OPEN',
    "dateRaised" TIMESTAMP(3),
    "dateClosed" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UatIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UatIssue_projectId_idx" ON "UatIssue"("projectId");
CREATE INDEX "UatIssue_companyId_idx" ON "UatIssue"("companyId");

ALTER TABLE "UatArea" ADD CONSTRAINT "UatArea_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UatArea" ADD CONSTRAINT "UatArea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "UatArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatIssue" ADD CONSTRAINT "UatIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UatIssue" ADD CONSTRAINT "UatIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
