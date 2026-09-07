-- Reporting currency is EUR for this company. Flip the default and correct the existing row that
-- was created under the old "USD" default.
ALTER TABLE "Company" ALTER COLUMN "currency" SET DEFAULT 'EUR';
UPDATE "Company" SET "currency" = 'EUR' WHERE "currency" = 'USD';
