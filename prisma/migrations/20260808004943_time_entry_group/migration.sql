-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "entryGroup" TEXT;

-- CreateIndex
CREATE INDEX "TimeEntry_assignmentId_taskId_entryGroup_idx" ON "TimeEntry"("assignmentId", "taskId", "entryGroup");
