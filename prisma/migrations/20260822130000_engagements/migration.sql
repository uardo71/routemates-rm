-- Engagements: an end-customer breakdown that lives only in the delivery cockpit (never a Project).
-- Governance items can be optionally scoped to an engagement.

CREATE TABLE "Engagement" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Engagement_projectId_idx" ON "Engagement"("projectId");
CREATE INDEX "Engagement_companyId_idx" ON "Engagement"("companyId");
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- engagementId on the governance tables
ALTER TABLE "StatusReport"   ADD COLUMN "engagementId" TEXT;
ALTER TABLE "PlanTask"       ADD COLUMN "engagementId" TEXT;
ALTER TABLE "RaidItem"       ADD COLUMN "engagementId" TEXT;
ALTER TABLE "MeetingMinutes" ADD COLUMN "engagementId" TEXT;
ALTER TABLE "Document"       ADD COLUMN "engagementId" TEXT;

CREATE INDEX "StatusReport_engagementId_idx"   ON "StatusReport"("engagementId");
CREATE INDEX "PlanTask_engagementId_idx"       ON "PlanTask"("engagementId");
CREATE INDEX "RaidItem_engagementId_idx"       ON "RaidItem"("engagementId");
CREATE INDEX "MeetingMinutes_engagementId_idx" ON "MeetingMinutes"("engagementId");
CREATE INDEX "Document_engagementId_idx"        ON "Document"("engagementId");

ALTER TABLE "StatusReport"   ADD CONSTRAINT "StatusReport_engagementId_fkey"   FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanTask"       ADD CONSTRAINT "PlanTask_engagementId_fkey"       FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RaidItem"       ADD CONSTRAINT "RaidItem_engagementId_fkey"       FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document"       ADD CONSTRAINT "Document_engagementId_fkey"        FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
