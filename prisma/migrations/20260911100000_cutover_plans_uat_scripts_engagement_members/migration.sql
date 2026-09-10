-- Cutover plans and UAT test scripts become first-class containers (many per project, each
-- optionally tied to an end-customer Engagement), and Engagements get assigned members.
-- Every existing project keeps its data: one plan / one script is created per project that has any,
-- and its tasks/lists/areas/cases/issues are attached to it.

-- ---------- containers ----------
CREATE TABLE "CutoverPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engagementId" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CutoverPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CutoverPlan_projectId_idx" ON "CutoverPlan"("projectId");
CREATE INDEX "CutoverPlan_engagementId_idx" ON "CutoverPlan"("engagementId");
CREATE INDEX "CutoverPlan_companyId_idx" ON "CutoverPlan"("companyId");
ALTER TABLE "CutoverPlan" ADD CONSTRAINT "CutoverPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CutoverPlan" ADD CONSTRAINT "CutoverPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CutoverPlan" ADD CONSTRAINT "CutoverPlan_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UatScript" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "engagementId" TEXT,
    "name" TEXT NOT NULL,
    "status" "UatScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UatScript_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "UatScript_projectId_idx" ON "UatScript"("projectId");
CREATE INDEX "UatScript_engagementId_idx" ON "UatScript"("engagementId");
CREATE INDEX "UatScript_companyId_idx" ON "UatScript"("companyId");
ALTER TABLE "UatScript" ADD CONSTRAINT "UatScript_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UatScript" ADD CONSTRAINT "UatScript_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatScript" ADD CONSTRAINT "UatScript_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EngagementMember" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngagementMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EngagementMember_engagementId_userId_key" ON "EngagementMember"("engagementId", "userId");
CREATE INDEX "EngagementMember_userId_idx" ON "EngagementMember"("userId");
ALTER TABLE "EngagementMember" ADD CONSTRAINT "EngagementMember_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EngagementMember" ADD CONSTRAINT "EngagementMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- cutover: one plan per project that has tasks or lists ----------
ALTER TABLE "CutoverTask" ADD COLUMN "planId" TEXT;
ALTER TABLE "CutoverList" ADD COLUMN "planId" TEXT;

INSERT INTO "CutoverPlan" ("id", "companyId", "projectId", "engagementId", "name", "sortOrder", "createdAt", "updatedAt")
SELECT
  'cplan_' || p."id",
  p."companyId",
  p."id",
  -- If the old rows were ever scoped to one end customer, keep that scope on the plan.
  (SELECT t."engagementId" FROM "CutoverTask" t WHERE t."projectId" = p."id" AND t."engagementId" IS NOT NULL
     GROUP BY t."engagementId" ORDER BY count(*) DESC LIMIT 1),
  'Cutover plan',
  0,
  COALESCE((SELECT min(t."createdAt") FROM "CutoverTask" t WHERE t."projectId" = p."id"), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "Project" p
WHERE EXISTS (SELECT 1 FROM "CutoverTask" t WHERE t."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "CutoverList" l WHERE l."projectId" = p."id");

UPDATE "CutoverTask" SET "planId" = 'cplan_' || "projectId";
UPDATE "CutoverList" SET "planId" = 'cplan_' || "projectId";

ALTER TABLE "CutoverTask" ALTER COLUMN "planId" SET NOT NULL;
ALTER TABLE "CutoverList" ALTER COLUMN "planId" SET NOT NULL;
ALTER TABLE "CutoverTask" ADD CONSTRAINT "CutoverTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CutoverPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CutoverList" ADD CONSTRAINT "CutoverList_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CutoverPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CutoverTask_planId_idx" ON "CutoverTask"("planId");
CREATE INDEX "CutoverList_planId_idx" ON "CutoverList"("planId");

-- reference-list names are unique per plan now, not per project
DROP INDEX IF EXISTS "CutoverList_projectId_name_key";
CREATE UNIQUE INDEX "CutoverList_planId_name_key" ON "CutoverList"("planId", "name");

-- the per-task engagement scope moved to the plan
ALTER TABLE "CutoverTask" DROP CONSTRAINT IF EXISTS "CutoverTask_engagementId_fkey";
DROP INDEX IF EXISTS "CutoverTask_engagementId_idx";
ALTER TABLE "CutoverTask" DROP COLUMN "engagementId";

-- ---------- UAT: one script per project that has areas/cases/issues or a non-draft status ----------
ALTER TABLE "UatArea" ADD COLUMN "scriptId" TEXT;
ALTER TABLE "UatTestCase" ADD COLUMN "scriptId" TEXT;
ALTER TABLE "UatIssue" ADD COLUMN "scriptId" TEXT;

INSERT INTO "UatScript" ("id", "companyId", "projectId", "engagementId", "name", "status", "sentAt", "sortOrder", "createdAt", "updatedAt")
SELECT
  'uscript_' || p."id",
  p."companyId",
  p."id",
  NULL,
  'UAT test script',
  p."uatScriptStatus",
  p."uatScriptSentAt",
  0,
  COALESCE((SELECT min(a."createdAt") FROM "UatArea" a WHERE a."projectId" = p."id"), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "Project" p
WHERE EXISTS (SELECT 1 FROM "UatArea" a WHERE a."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "UatTestCase" c WHERE c."projectId" = p."id")
   OR EXISTS (SELECT 1 FROM "UatIssue" i WHERE i."projectId" = p."id")
   OR p."uatScriptStatus" <> 'DRAFT';

UPDATE "UatArea" SET "scriptId" = 'uscript_' || "projectId";
UPDATE "UatTestCase" SET "scriptId" = 'uscript_' || "projectId";
UPDATE "UatIssue" SET "scriptId" = 'uscript_' || "projectId";

ALTER TABLE "UatArea" ALTER COLUMN "scriptId" SET NOT NULL;
ALTER TABLE "UatTestCase" ALTER COLUMN "scriptId" SET NOT NULL;
ALTER TABLE "UatIssue" ALTER COLUMN "scriptId" SET NOT NULL;
ALTER TABLE "UatArea" ADD CONSTRAINT "UatArea_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "UatScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatTestCase" ADD CONSTRAINT "UatTestCase_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "UatScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UatIssue" ADD CONSTRAINT "UatIssue_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "UatScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "UatArea_scriptId_idx" ON "UatArea"("scriptId");
CREATE INDEX "UatTestCase_scriptId_idx" ON "UatTestCase"("scriptId");
CREATE INDEX "UatIssue_scriptId_idx" ON "UatIssue"("scriptId");

-- the single per-project script status now lives on each UatScript
ALTER TABLE "Project" DROP COLUMN "uatScriptStatus";
ALTER TABLE "Project" DROP COLUMN "uatScriptSentAt";
