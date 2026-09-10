-- Programme-level status tracking: opt a multi-engagement project's "Overall" scope into the
-- status-update chase (it was silently exempt).
ALTER TABLE "Project" ADD COLUMN "trackOverallStatus" BOOLEAN NOT NULL DEFAULT false;
