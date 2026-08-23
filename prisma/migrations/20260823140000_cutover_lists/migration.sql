-- Cutover reference lists (detail tabs) + step reference
ALTER TABLE "CutoverTask" ADD COLUMN "referenceList" TEXT;

CREATE TABLE "CutoverList" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutoverList_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CutoverList_projectId_name_key" ON "CutoverList"("projectId", "name");
CREATE INDEX "CutoverList_projectId_idx" ON "CutoverList"("projectId");
CREATE INDEX "CutoverList_companyId_idx" ON "CutoverList"("companyId");

ALTER TABLE "CutoverList" ADD CONSTRAINT "CutoverList_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CutoverList" ADD CONSTRAINT "CutoverList_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
