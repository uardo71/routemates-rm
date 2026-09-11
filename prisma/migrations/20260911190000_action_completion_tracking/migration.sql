-- Completed actions stay on record: when they were completed and by whom, for every action source,
-- so the actions register can list them. "By" columns are plain ids (no FK) on purpose: completion
-- history must survive a user being deleted, like the audit log.
ALTER TABLE "PlanTask" ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "completedById" TEXT;
ALTER TABLE "RaidItem" ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "completedById" TEXT;
ALTER TABLE "StatusReportAction" ADD COLUMN "doneById" TEXT, ADD COLUMN "carriedFromId" TEXT;
ALTER TABLE "MeetingActionItem" ADD COLUMN "doneById" TEXT;

-- A status-update action carried into the next update points at the one it continues, so the
-- register shows each action once (its newest copy) instead of once per report.
CREATE INDEX "StatusReportAction_carriedFromId_idx" ON "StatusReportAction"("carriedFromId");
ALTER TABLE "StatusReportAction" ADD CONSTRAINT "StatusReportAction_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "StatusReportAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: already-completed plan tasks and closed issues get their last update as completion time.
UPDATE "PlanTask" SET "completedAt" = "updatedAt" WHERE "completedAt" IS NULL AND ("status" = 'COMPLETED' OR "progress" >= 100);
UPDATE "RaidItem" SET "completedAt" = "updatedAt" WHERE "completedAt" IS NULL AND "status" = 'CLOSED';

-- Backfill the carry chain: an action continues the same-text action of the closest EARLIER status
-- update in the same project and end customer.
WITH ranked AS (
  SELECT a.id, lower(btrim(a.description)) AS d, r."projectId" AS p, r."engagementId" AS e, r."reportDate" AS rd, r."createdAt" AS rc
  FROM "StatusReportAction" a JOIN "StatusReport" r ON r.id = a."reportId"
), links AS (
  SELECT cur.id, (
    SELECT prev.id FROM ranked prev
    WHERE prev.p = cur.p AND prev.e IS NOT DISTINCT FROM cur.e AND prev.d = cur.d
      AND (prev.rd, prev.rc) < (cur.rd, cur.rc)
    ORDER BY prev.rd DESC, prev.rc DESC
    LIMIT 1
  ) AS prev_id
  FROM ranked cur
)
UPDATE "StatusReportAction" s SET "carriedFromId" = links.prev_id
FROM links WHERE s.id = links.id AND links.prev_id IS NOT NULL;
