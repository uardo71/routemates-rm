-- A plan that means something: effort, a link to the work people log time against, a frozen
-- baseline, and finish-to-start dependencies. `ownerUserId` already exists (action_owner_user).
ALTER TABLE "PlanTask"
  ADD COLUMN "estimatedHours" DECIMAL(8,2),
  ADD COLUMN "milestoneId" TEXT,
  ADD COLUMN "taskId" TEXT,
  ADD COLUMN "baselineStart" TIMESTAMP(3),
  ADD COLUMN "baselineEnd" TIMESTAMP(3),
  ADD COLUMN "dependsOnId" TEXT;

CREATE INDEX "PlanTask_milestoneId_idx" ON "PlanTask"("milestoneId");
CREATE INDEX "PlanTask_dependsOnId_idx" ON "PlanTask"("dependsOnId");

ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "PlanTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
