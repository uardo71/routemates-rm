-- Vendor payments (accounts payable): vendors + their bills/payments, with documents attachable.

CREATE TYPE "VendorPaymentStatus" AS ENUM ('TO_PAY', 'PAID');

CREATE TABLE "Vendor" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Vendor_companyId_idx" ON "Vendor"("companyId");
ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "VendorPayment" (
  "id"            TEXT NOT NULL,
  "companyId"     TEXT NOT NULL,
  "vendorId"      TEXT NOT NULL,
  "projectId"     TEXT,
  "status"        "VendorPaymentStatus" NOT NULL DEFAULT 'TO_PAY',
  "description"   TEXT,
  "invoiceNumber" TEXT,
  "amount"        DECIMAL(12,2) NOT NULL,
  "currency"      TEXT NOT NULL,
  "invoiceDate"   TIMESTAMP(3),
  "dueDate"       TIMESTAMP(3),
  "paymentDate"   TIMESTAMP(3),
  "notes"         TEXT,
  "recordedById"  TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VendorPayment_companyId_idx" ON "VendorPayment"("companyId");
CREATE INDEX "VendorPayment_vendorId_idx" ON "VendorPayment"("vendorId");
CREATE INDEX "VendorPayment_projectId_idx" ON "VendorPayment"("projectId");
ALTER TABLE "VendorPayment"
  ADD CONSTRAINT "VendorPayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorPayment"
  ADD CONSTRAINT "VendorPayment_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorPayment"
  ADD CONSTRAINT "VendorPayment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VendorPayment"
  ADD CONSTRAINT "VendorPayment_recordedById_fkey"
  FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Documents can attach to a vendor payment (the vendor invoice, the payment receipt, …)
ALTER TABLE "Document" ADD COLUMN "vendorPaymentId" TEXT;
CREATE INDEX "Document_vendorPaymentId_idx" ON "Document"("vendorPaymentId");
ALTER TABLE "Document"
  ADD CONSTRAINT "Document_vendorPaymentId_fkey"
  FOREIGN KEY ("vendorPaymentId") REFERENCES "VendorPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
