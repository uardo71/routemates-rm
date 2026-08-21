-- UAT acceptance becomes a phased workflow with history.

CREATE TYPE "ProjectUatStatus" AS ENUM ('NOT_STARTED', 'SENT', 'ACCEPTED', 'CHANGES_REQUESTED');

ALTER TABLE "Project" ADD COLUMN "uatStatus" "ProjectUatStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- Existing accepted projects move to the ACCEPTED phase.
UPDATE "Project" SET "uatStatus" = 'ACCEPTED' WHERE "uatAccepted" = true;

CREATE TABLE "ProjectUatEvent" (
  "id"        TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "status"    "ProjectUatStatus" NOT NULL,
  "note"      TEXT,
  "actorId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectUatEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectUatEvent_projectId_idx" ON "ProjectUatEvent"("projectId");
ALTER TABLE "ProjectUatEvent"
  ADD CONSTRAINT "ProjectUatEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUatEvent"
  ADD CONSTRAINT "ProjectUatEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed an ACCEPTED history entry for already-accepted projects that have a recorder, so the
-- timeline isn't empty for them.
INSERT INTO "ProjectUatEvent" ("id", "projectId", "status", "note", "actorId", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'ACCEPTED', p."uatNotes", p."uatRecordedById", COALESCE(p."uatRecordedAt", CURRENT_TIMESTAMP)
FROM "Project" p
WHERE p."uatAccepted" = true AND p."uatRecordedById" IS NOT NULL;
