-- Widen rate-like columns (per-hour figures derived from salary/working-days math) from 2 to 4
-- decimal places so precise computed values (e.g. 47.8125) can be entered exactly. Non-destructive
-- widening — existing 2-decimal values are unaffected.
ALTER TABLE "Employment" ALTER COLUMN "costRate" TYPE DECIMAL(10,4);
ALTER TABLE "Assignment" ALTER COLUMN "costRate" TYPE DECIMAL(10,4);
ALTER TABLE "Milestone" ALTER COLUMN "salesPrice" TYPE DECIMAL(12,4);
ALTER TABLE "InvoiceLine" ALTER COLUMN "rate" TYPE DECIMAL(10,4);
