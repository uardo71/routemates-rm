-- TimeCard status/submit/delete move to the assignment level — a card can span multiple tasks
-- (each task is just an hours sub-row, no independent status). Truncates time-tracking data
-- (dev/demo only, created moments ago in this same session).
DELETE FROM "TimeEntry";
DELETE FROM "TimeCard";

-- DropForeignKey
ALTER TABLE "TimeCard" DROP CONSTRAINT "TimeCard_taskId_fkey";

-- AlterTable
ALTER TABLE "TimeCard" DROP COLUMN "taskId";

-- DropIndex
DROP INDEX "TimeEntry_timeCardId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_timeCardId_taskId_date_key" ON "TimeEntry"("timeCardId", "taskId", "date");
