-- Bank charges withheld from a payment in transit. The invoice is settled by
-- (amount + bankFee): the customer sent the full sum, the bank skimmed the fee.
ALTER TABLE "InvoicePayment" ADD COLUMN "bankFee" DECIMAL(12,2) NOT NULL DEFAULT 0;
