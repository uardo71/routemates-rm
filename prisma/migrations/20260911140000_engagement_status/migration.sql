-- An end customer (engagement) can be marked completed on its own, without closing the umbrella project.
CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'COMPLETED');
ALTER TABLE "Engagement" ADD COLUMN "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Engagement" ADD COLUMN "completedAt" TIMESTAMP(3);
