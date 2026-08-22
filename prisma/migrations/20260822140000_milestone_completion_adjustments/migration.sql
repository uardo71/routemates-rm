-- Milestone completion (note + timestamp) and a value-adjustment log.

ALTER TABLE "Milestone" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Milestone" ADD COLUMN "completionNote" TEXT;

CREATE TABLE "MilestoneAdjustment" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "milestoneId"   TEXT NOT NULL,
  "amount"        DECIMAL(12,2) NOT NULL,
  "reason"        TEXT NOT NULL,
  "opportunityId" TEXT,
  "createdById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MilestoneAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MilestoneAdjustment_milestoneId_idx" ON "MilestoneAdjustment"("milestoneId");
CREATE INDEX "MilestoneAdjustment_companyId_idx" ON "MilestoneAdjustment"("companyId");
ALTER TABLE "MilestoneAdjustment" ADD CONSTRAINT "MilestoneAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MilestoneAdjustment" ADD CONSTRAINT "MilestoneAdjustment_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MilestoneAdjustment" ADD CONSTRAINT "MilestoneAdjustment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MilestoneAdjustment" ADD CONSTRAINT "MilestoneAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
