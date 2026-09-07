-- Configurable SLA targets: one company default (clientId NULL) + optional per-client overrides.
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT,
    "targets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SlaPolicy_companyId_clientId_key" ON "SlaPolicy"("companyId", "clientId");
-- Only one default per company (Postgres treats NULLs as distinct, so the composite unique above
-- would otherwise allow several defaults).
CREATE UNIQUE INDEX "SlaPolicy_company_default_key" ON "SlaPolicy"("companyId") WHERE "clientId" IS NULL;
CREATE INDEX "SlaPolicy_companyId_idx" ON "SlaPolicy"("companyId");
CREATE INDEX "SlaPolicy_clientId_idx" ON "SlaPolicy"("clientId");
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
