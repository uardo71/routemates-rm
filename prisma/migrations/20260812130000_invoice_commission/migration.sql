-- Optional sales-commission discount on an invoice, expressed as a percentage of the line net
-- and/or a flat amount (they combine). The effective figure is materialised as the negative
-- "Sales comision" line; these columns remember how it was entered.
ALTER TABLE "Invoice" ADD COLUMN "commissionPercent" DECIMAL(5,2);
ALTER TABLE "Invoice" ADD COLUMN "commissionFixed" DECIMAL(12,2);
