-- Truncate demo time-tracking data: this is a structural change (per-week Timesheet/Approval ->
-- per-line TimeCard) that can't be faithfully mapped row-for-row. Existing rows are seed/demo
-- data only; re-run `pnpm exec prisma db seed` after this migration.
DELETE FROM "Approval";
DELETE FROM "TimeEntry";
DELETE FROM "Timesheet";

-- Backfill required Assignment date window before enforcing NOT NULL
UPDATE "Assignment" a
SET "startDate" = COALESCE(a."startDate", m."startDate", a."createdAt")
FROM "Milestone" m
WHERE a."milestoneId" = m."id" AND a."startDate" IS NULL;

UPDATE "Assignment" a
SET "endDate" = COALESCE(a."endDate", m."endDate", a."startDate" + INTERVAL '180 days')
FROM "Milestone" m
WHERE a."milestoneId" = m."id" AND a."endDate" IS NULL;

-- DropForeignKey
ALTER TABLE "TimeEntry" DROP CONSTRAINT "TimeEntry_timesheetId_fkey";
ALTER TABLE "Employment" DROP CONSTRAINT "Employment_jobTitleId_fkey";

-- DropIndex
DROP INDEX "TimeEntry_timesheetId_idx";
DROP INDEX "TimeEntry_assignmentId_taskId_entryGroup_idx";

-- DropTable
DROP TABLE "Approval";
DROP TABLE "Timesheet";
DROP TABLE "JobTitle";

-- AlterTable
ALTER TABLE "Employment" DROP COLUMN "jobTitleId";

-- AlterTable
ALTER TABLE "Assignment" ALTER COLUMN "startDate" SET NOT NULL,
ALTER COLUMN "endDate" SET NOT NULL;

-- AlterTable
ALTER TABLE "TimeEntry" DROP COLUMN "entryGroup",
DROP COLUMN "timesheetId",
ADD COLUMN "timeCardId" TEXT NOT NULL;

-- DropEnum
DROP TYPE "TimesheetStatus";
DROP TYPE "ApprovalStatus";

-- CreateEnum
CREATE TYPE "TimeCardStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TimeCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "taskId" TEXT,
    "weekStartDate" TIMESTAMP(3) NOT NULL,
    "status" "TimeCardStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeCard_userId_weekStartDate_idx" ON "TimeCard"("userId", "weekStartDate");

-- CreateIndex
CREATE INDEX "TimeCard_assignmentId_idx" ON "TimeCard"("assignmentId");

-- CreateIndex
CREATE INDEX "TimeCard_approverId_status_idx" ON "TimeCard"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_timeCardId_date_key" ON "TimeEntry"("timeCardId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_timeCardId_idx" ON "TimeEntry"("timeCardId");

-- AddForeignKey
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_timeCardId_fkey" FOREIGN KEY ("timeCardId") REFERENCES "TimeCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
