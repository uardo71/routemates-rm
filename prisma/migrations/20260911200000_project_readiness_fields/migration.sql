-- Prepare for Delivery (PLANNED -> ACTIVE gate): the client sponsor, an explicit PO waiver, and the
-- admin override that lets a project start with checks still failing (badge until resolved).
ALTER TABLE "Project"
  ADD COLUMN "sponsorContactId" TEXT,
  ADD COLUMN "poWaived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "poWaivedReason" TEXT,
  ADD COLUMN "activationOverrideReason" TEXT,
  ADD COLUMN "activationOverrideAt" TIMESTAMP(3),
  ADD COLUMN "activationOverrideById" TEXT;

CREATE INDEX "Project_sponsorContactId_idx" ON "Project"("sponsorContactId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_sponsorContactId_fkey" FOREIGN KEY ("sponsorContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
