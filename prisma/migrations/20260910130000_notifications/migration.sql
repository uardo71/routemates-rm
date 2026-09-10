-- Sent-alert ledger. UNIQUE(kind, targetId, payloadHash) is the guarantee that a daily rule never
-- re-sends the same alert. channel/recipient summarise the fan-out for audit.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Notification_kind_targetId_payloadHash_key" ON "Notification"("kind", "targetId", "payloadHash");
CREATE INDEX "Notification_companyId_kind_idx" ON "Notification"("companyId", "kind");
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");

-- The customer PO's expiry, so the "PO expiring within N days" alert has a date to work from.
ALTER TABLE "Opportunity" ADD COLUMN "poValidUntil" TIMESTAMP(3);
