-- "Cutover plan" as a delivery-library document type, and links from a document to the
-- MeetingMinutes / StatusReport entry it created (so a deck made in another template still shows
-- in its tab). The new enum value is not used in this migration, so it can share the transaction.
ALTER TYPE "DocumentKind" ADD VALUE 'CUTOVER_PLAN';

ALTER TABLE "Document" ADD COLUMN "minutesId" TEXT;
ALTER TABLE "Document" ADD COLUMN "statusReportId" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_statusReportId_fkey" FOREIGN KEY ("statusReportId") REFERENCES "StatusReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Document_minutesId_idx" ON "Document"("minutesId");
CREATE INDEX "Document_statusReportId_idx" ON "Document"("statusReportId");
