-- Skills catalogue, per-person skill levels, and certifications (file = a Document of kind CERTIFICATE).
ALTER TYPE "DocumentKind" ADD VALUE 'CERTIFICATE';

CREATE TYPE "SkillCategory" AS ENUM ('SAP_MODULE', 'TECHNOLOGY', 'LANGUAGE', 'INDUSTRY', 'METHODOLOGY');

CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "SkillCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Skill_companyId_name_key" ON "Skill"("companyId", "name");
CREATE INDEX "Skill_companyId_category_idx" ON "Skill"("companyId", "category");
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "lastUsedYear" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserSkill_level_check" CHECK ("level" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "UserSkill_userId_skillId_key" ON "UserSkill"("userId", "skillId");
CREATE INDEX "UserSkill_skillId_idx" ON "UserSkill"("skillId");
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Certification_documentId_key" ON "Certification"("documentId");
CREATE INDEX "Certification_userId_idx" ON "Certification"("userId");
CREATE INDEX "Certification_expiryDate_idx" ON "Certification"("expiryDate");
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
