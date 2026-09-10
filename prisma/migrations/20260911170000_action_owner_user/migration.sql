-- Actions register: link each action-bearing row to one of our people (ownerUserId) while keeping
-- the free-text owner for client-side names. Completion state where it was missing.
ALTER TABLE "PlanTask" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "RaidItem" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "StatusReportAction" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "StatusReportAction" ADD COLUMN "done" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StatusReportAction" ADD COLUMN "doneAt" TIMESTAMP(3);
ALTER TABLE "MeetingActionItem" ADD COLUMN "ownerUserId" TEXT;
ALTER TABLE "MeetingActionItem" ADD COLUMN "doneAt" TIMESTAMP(3);
ALTER TABLE "MeetingActionItem" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "PlanTask" ADD CONSTRAINT "PlanTask_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RaidItem" ADD CONSTRAINT "RaidItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StatusReportAction" ADD CONSTRAINT "StatusReportAction_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PlanTask_ownerUserId_idx" ON "PlanTask"("ownerUserId");
CREATE INDEX "RaidItem_ownerUserId_idx" ON "RaidItem"("ownerUserId");
CREATE INDEX "StatusReportAction_ownerUserId_idx" ON "StatusReportAction"("ownerUserId");
CREATE INDEX "MeetingActionItem_ownerUserId_idx" ON "MeetingActionItem"("ownerUserId");

-- Existing meeting actions get the minutes' date as createdAt so their age is honest.
UPDATE "MeetingActionItem" a SET "createdAt" = m."createdAt" FROM "MeetingMinutes" m WHERE a."minutesId" = m."id";

-- Backfill: exact, case-insensitive, trimmed name match against ACTIVE users of the same company.
-- Ambiguous names (two active users with the same name) are left as text on purpose.
UPDATE "PlanTask" t SET "ownerUserId" = u."id" FROM "User" u
  WHERE t."ownerUserId" IS NULL AND t."owner" IS NOT NULL AND u."active" AND u."companyId" = t."companyId"
    AND lower(trim(u."name")) = lower(trim(t."owner"))
    AND (SELECT count(*) FROM "User" u2 WHERE u2."active" AND u2."companyId" = t."companyId" AND lower(trim(u2."name")) = lower(trim(t."owner"))) = 1;
UPDATE "RaidItem" t SET "ownerUserId" = u."id" FROM "User" u
  WHERE t."ownerUserId" IS NULL AND t."owner" IS NOT NULL AND u."active" AND u."companyId" = t."companyId"
    AND lower(trim(u."name")) = lower(trim(t."owner"))
    AND (SELECT count(*) FROM "User" u2 WHERE u2."active" AND u2."companyId" = t."companyId" AND lower(trim(u2."name")) = lower(trim(t."owner"))) = 1;
UPDATE "StatusReportAction" t SET "ownerUserId" = u."id" FROM "User" u, "StatusReport" r
  WHERE t."reportId" = r."id" AND t."ownerUserId" IS NULL AND t."owner" IS NOT NULL AND u."active" AND u."companyId" = r."companyId"
    AND lower(trim(u."name")) = lower(trim(t."owner"))
    AND (SELECT count(*) FROM "User" u2 WHERE u2."active" AND u2."companyId" = r."companyId" AND lower(trim(u2."name")) = lower(trim(t."owner"))) = 1;
UPDATE "MeetingActionItem" t SET "ownerUserId" = u."id" FROM "User" u, "MeetingMinutes" m
  WHERE t."minutesId" = m."id" AND t."ownerUserId" IS NULL AND t."owner" IS NOT NULL AND u."active" AND u."companyId" = m."companyId"
    AND lower(trim(u."name")) = lower(trim(t."owner"))
    AND (SELECT count(*) FROM "User" u2 WHERE u2."active" AND u2."companyId" = m."companyId" AND lower(trim(u2."name")) = lower(trim(t."owner"))) = 1;
