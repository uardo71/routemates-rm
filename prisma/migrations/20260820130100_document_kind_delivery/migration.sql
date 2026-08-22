-- New DocumentKind values for the delivery document library. Own migration (enum values can't be
-- used in the same transaction they're created in).
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'PROJECT_PLAN';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'STATUS_UPDATE';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'MEETING_MINUTES';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'KICKOFF';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'SCOPE';
