-- Contract amendments / change-orders applied to a won opportunity (adds hours + value to the
-- linked project).
CREATE TABLE "OpportunityAmendment" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reference" TEXT,
    "poNumber" TEXT,
    "signedDate" TIMESTAMP(3),
    "note" TEXT,
    "linesSnapshot" JSONB NOT NULL,
    "addedHours" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "appliedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityAmendment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpportunityAmendment_opportunityId_version_key" ON "OpportunityAmendment"("opportunityId", "version");
CREATE INDEX "OpportunityAmendment_opportunityId_idx" ON "OpportunityAmendment"("opportunityId");
CREATE INDEX "OpportunityAmendment_projectId_idx" ON "OpportunityAmendment"("projectId");

ALTER TABLE "OpportunityAmendment" ADD CONSTRAINT "OpportunityAmendment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityAmendment" ADD CONSTRAINT "OpportunityAmendment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpportunityAmendment" ADD CONSTRAINT "OpportunityAmendment_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
