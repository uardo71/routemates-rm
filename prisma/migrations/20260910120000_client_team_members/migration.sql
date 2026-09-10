-- The AMS team for a client: which internal staff look after that account's tickets.
-- Membership grants access and, for non-admins, scopes what they see.
CREATE TYPE "ClientTeamRole" AS ENUM ('LEAD', 'MEMBER');

CREATE TABLE "ClientTeamMember" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClientTeamRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "ClientTeamMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientTeamMember_clientId_userId_key" ON "ClientTeamMember"("clientId", "userId");
CREATE INDEX "ClientTeamMember_clientId_idx" ON "ClientTeamMember"("clientId");
CREATE INDEX "ClientTeamMember_userId_idx" ON "ClientTeamMember"("userId");

ALTER TABLE "ClientTeamMember" ADD CONSTRAINT "ClientTeamMember_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientTeamMember" ADD CONSTRAINT "ClientTeamMember_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientTeamMember" ADD CONSTRAINT "ClientTeamMember_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed so nobody loses access the moment this ships.
-- 1) Everyone who already had company-wide ticket visibility (Admin/Finance/Sales/PM) becomes a
--    member of every client that exists TODAY. Clients created from now on start empty and must be
--    staffed deliberately — which is the point of the AMS model.
INSERT INTO "ClientTeamMember" ("id", "clientId", "userId", "role")
SELECT gen_random_uuid()::text, c."id", u."id", 'MEMBER'::"ClientTeamRole"
FROM "Client" c
JOIN "User" u ON u."companyId" = c."companyId"
WHERE u."active" = true AND u."role" IN ('ADMIN', 'FINANCE', 'SALES', 'PM')
ON CONFLICT ("clientId", "userId") DO NOTHING;

-- 2) Anyone already working a client's tickets (assignee / requester / creator) joins that client,
--    which is how employees who have no role permissions keep the access they had.
INSERT INTO "ClientTeamMember" ("id", "clientId", "userId", "role")
SELECT DISTINCT gen_random_uuid()::text, t."clientId", u."id", 'MEMBER'::"ClientTeamRole"
FROM "Ticket" t
JOIN "User" u ON u."id" IN (t."assigneeId", t."requesterId", t."createdById")
WHERE t."clientId" IS NOT NULL AND u."active" = true AND u."role" <> 'CUSTOMER'
ON CONFLICT ("clientId", "userId") DO NOTHING;
