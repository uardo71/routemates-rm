-- Cutover: parent/child nesting + prerequisite
ALTER TABLE "CutoverTask" ADD COLUMN "parentId" TEXT;
ALTER TABLE "CutoverTask" ADD COLUMN "prerequisite" TEXT;

CREATE INDEX "CutoverTask_parentId_idx" ON "CutoverTask"("parentId");

ALTER TABLE "CutoverTask" ADD CONSTRAINT "CutoverTask_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CutoverTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
