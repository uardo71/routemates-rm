-- Tax payments module: categories + payments, with documents attachable to a payment.

-- Status enum
CREATE TYPE "TaxPaymentStatus" AS ENUM ('TO_PAY', 'PAID');

-- Categories (municipality tax, advance sales tax, rent tax, health/social contributions, …)
CREATE TABLE "TaxCategory" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxCategory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxCategory_companyId_idx" ON "TaxCategory"("companyId");
ALTER TABLE "TaxCategory"
  ADD CONSTRAINT "TaxCategory_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payments
CREATE TABLE "TaxPayment" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "categoryId"   TEXT NOT NULL,
  "status"       "TaxPaymentStatus" NOT NULL DEFAULT 'TO_PAY',
  "periodStart"  TIMESTAMP(3) NOT NULL,
  "periodEnd"    TIMESTAMP(3),
  "amount"       DECIMAL(12,2) NOT NULL,
  "currency"     TEXT NOT NULL,
  "serialNumber" TEXT,
  "authority"    TEXT,
  "dueDate"      TIMESTAMP(3),
  "paymentDate"  TIMESTAMP(3),
  "notes"        TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxPayment_companyId_idx" ON "TaxPayment"("companyId");
CREATE INDEX "TaxPayment_categoryId_idx" ON "TaxPayment"("categoryId");
ALTER TABLE "TaxPayment"
  ADD CONSTRAINT "TaxPayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxPayment"
  ADD CONSTRAINT "TaxPayment_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "TaxCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaxPayment"
  ADD CONSTRAINT "TaxPayment_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Documents can attach to a tax payment (notice PDF, payment receipt, …)
ALTER TABLE "Document" ADD COLUMN "taxPaymentId" TEXT;
CREATE INDEX "Document_taxPaymentId_idx" ON "Document"("taxPaymentId");
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_taxPaymentId_fkey"
  FOREIGN KEY ("taxPaymentId") REFERENCES "TaxPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
