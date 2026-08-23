-- SOP coaching guides ("How do I handle this?")
CREATE TABLE "SopGuide" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT,
    "steps" TEXT NOT NULL,
    "source" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopGuide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SopGuide_companyId_idx" ON "SopGuide"("companyId");

ALTER TABLE "SopGuide" ADD CONSTRAINT "SopGuide_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
