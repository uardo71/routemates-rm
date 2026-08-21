-- New DocumentKind value for the signed UAT / customer acceptance document. Kept in its own
-- migration: Postgres won't let a newly-added enum value be used in the same transaction it's
-- created in, so isolating it guarantees it's committed before any row references it.
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'UAT_ACCEPTANCE';
