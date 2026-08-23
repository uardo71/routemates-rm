-- Cutover plan (go-live runbook)
CREATE TYPE "CutoverStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'SKIPPED');

CREATE TABLE "CutoverTask" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engagementId" TEXT,
    "macroActivity" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "description" TEXT,
    "responsible" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "status" "CutoverStatus" NOT NULL DEFAULT 'PENDING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutoverTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CutoverTask_projectId_idx" ON "CutoverTask"("projectId");
CREATE INDEX "CutoverTask_companyId_idx" ON "CutoverTask"("companyId");

ALTER TABLE "CutoverTask" ADD CONSTRAINT "CutoverTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CutoverTask" ADD CONSTRAINT "CutoverTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CutoverTask" ADD CONSTRAINT "CutoverTask_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
