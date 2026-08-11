-- Optional task-level resource planning.
-- AssignmentPlan gains an optional taskId: NULL = assignment-level plan, set = a task breakdown row.

ALTER TABLE "AssignmentPlan" ADD COLUMN "taskId" TEXT;

ALTER TABLE "AssignmentPlan"
  ADD CONSTRAINT "AssignmentPlan_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Replace the old one-row-per-(assignment, week) unique with a task-aware one.
-- NULLS NOT DISTINCT (Postgres 15+) treats NULL taskId values as equal, so the invariant holds:
-- at most one assignment-level row (taskId NULL) AND at most one row per task, per (assignment, week).
DROP INDEX "AssignmentPlan_assignmentId_weekStartDate_key";

CREATE UNIQUE INDEX "AssignmentPlan_assignmentId_taskId_weekStartDate_key"
  ON "AssignmentPlan" ("assignmentId", "taskId", "weekStartDate") NULLS NOT DISTINCT;

CREATE INDEX "AssignmentPlan_taskId_idx" ON "AssignmentPlan" ("taskId");
