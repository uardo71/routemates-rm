-- Internal numbering: Opportunity O-######## and Project PR-#######, unique per company.
-- Backfills existing rows in creation order, then enforces uniqueness.

ALTER TABLE "Opportunity" ADD COLUMN "number" TEXT;
ALTER TABLE "Project" ADD COLUMN "number" TEXT;

-- Backfill opportunities: O- + 8-digit zero-padded sequence per company (by creation order).
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", id) AS rn
  FROM "Opportunity"
)
UPDATE "Opportunity" o
SET "number" = 'O-' || lpad(r.rn::text, 8, '0')
FROM ranked r
WHERE o.id = r.id;

-- Backfill projects: PR- + 7-digit zero-padded sequence per company (by creation order).
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "companyId" ORDER BY "createdAt", id) AS rn
  FROM "Project"
)
UPDATE "Project" p
SET "number" = 'PR-' || lpad(r.rn::text, 7, '0')
FROM ranked r
WHERE p.id = r.id;

CREATE UNIQUE INDEX "Opportunity_companyId_number_key" ON "Opportunity"("companyId", "number");
CREATE UNIQUE INDEX "Project_companyId_number_key" ON "Project"("companyId", "number");
