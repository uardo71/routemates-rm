-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('QUALIFYING', 'PROPOSAL_SENT', 'NEGOTIATION', 'PENDING_APPROVAL', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'ABSOLUTE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "contractValue" DECIMAL(12,2),
ADD COLUMN     "discountType" "DiscountType",
ADD COLUMN     "discountValue" DECIMAL(12,2),
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "sowNumber" TEXT;

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'QUALIFYING',
    "billingType" "ProjectBillingType" NOT NULL DEFAULT 'TIME_AND_MATERIALS',
    "currency" TEXT NOT NULL,
    "expectedCloseDate" TIMESTAMP(3),
    "probability" INTEGER,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(12,2),
    "ownerId" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "sowNumber" TEXT,
    "sowSignedDate" TIMESTAMP(3),
    "poNumber" TEXT,
    "poAmount" DECIMAL(12,2),
    "poDate" TIMESTAMP(3),
    "lostReason" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityLine" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantityHours" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityRevision" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "linesSnapshot" JSONB NOT NULL,
    "discountType" "DiscountType",
    "discountValue" DECIMAL(12,2),
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_projectId_key" ON "Opportunity"("projectId");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_stage_idx" ON "Opportunity"("companyId", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_clientId_idx" ON "Opportunity"("clientId");

-- CreateIndex
CREATE INDEX "OpportunityLine_opportunityId_idx" ON "OpportunityLine"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityRevision_opportunityId_idx" ON "OpportunityRevision"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityRevision_opportunityId_version_key" ON "OpportunityRevision"("opportunityId", "version");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLine" ADD CONSTRAINT "OpportunityLine_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRevision" ADD CONSTRAINT "OpportunityRevision_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRevision" ADD CONSTRAINT "OpportunityRevision_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
