-- Optional milestone attribution for a vendor bill, so subcontractor cost can land on the specific
-- (often fixed-price) milestone it was incurred for, not just the project.
ALTER TABLE "VendorPayment" ADD COLUMN "milestoneId" TEXT;
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "VendorPayment_milestoneId_idx" ON "VendorPayment"("milestoneId");
