-- Realign status reports (progress %, corrective actions, structured next-actions), add the
-- program/sub-project hierarchy, and add meeting minutes.

-- Status report: new fields + structured next-actions
ALTER TABLE "StatusReport" ADD COLUMN "progressPercent" INTEGER;
ALTER TABLE "StatusReport" ADD COLUMN "correctiveActions" TEXT;

CREATE TABLE "StatusReportAction" (
  "id"          TEXT NOT NULL,
  "reportId"    TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "owner"       TEXT,
  "dueDate"     TIMESTAMP(3),
  "critical"    BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatusReportAction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StatusReportAction_reportId_idx" ON "StatusReportAction"("reportId");
ALTER TABLE "StatusReportAction" ADD CONSTRAINT "StatusReportAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "StatusReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Program hierarchy on projects
ALTER TABLE "Project" ADD COLUMN "parentProjectId" TEXT;
ALTER TABLE "Project" ADD COLUMN "endCustomer" TEXT;
CREATE INDEX "Project_parentProjectId_idx" ON "Project"("parentProjectId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Meeting minutes
CREATE TABLE "MeetingMinutes" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "date"        TIMESTAMP(3) NOT NULL,
  "title"       TEXT NOT NULL,
  "attendees"   TEXT,
  "notes"       TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MeetingMinutes_projectId_idx" ON "MeetingMinutes"("projectId");
CREATE INDEX "MeetingMinutes_companyId_idx" ON "MeetingMinutes"("companyId");
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MeetingActionItem" (
  "id"          TEXT NOT NULL,
  "minutesId"   TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "owner"       TEXT,
  "dueDate"     TIMESTAMP(3),
  "done"        BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MeetingActionItem_minutesId_idx" ON "MeetingActionItem"("minutesId");
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
