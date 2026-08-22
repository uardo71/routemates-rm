-- Project plan: phased tasks/milestones with owner, dates, progress and status.

CREATE TYPE "PlanTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED');

CREATE TABLE "PlanTask" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "projectId"   TEXT NOT NULL,
  "phase"       TEXT,
  "name"        TEXT NOT NULL,
  "owner"       TEXT,
  "startDate"   TIMESTAMP(3),
  "dueDate"     TIMESTAMP(3),
  "progress"    INTEGER NOT NULL DEFAULT 0,
  "status"      "PlanTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "isMilestone" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlanTask_projectId_idx" ON "PlanTask"("projectId");
CREATE INDEX "PlanTask_companyId_idx" ON "PlanTask"("companyId");
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
