-- Expense source (manual vs PWA capture) + raw OCR/confidence data from the capture flow.
CREATE TYPE "ExpenseSource" AS ENUM ('MANUAL', 'CAPTURE');
ALTER TABLE "Expense" ADD COLUMN "source" "ExpenseSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Expense" ADD COLUMN "captureData" JSONB;
