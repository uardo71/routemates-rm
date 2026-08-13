-- DRAFT status for receipts captured via the /capture PWA but not yet confirmed.
-- Kept in its own migration: Postgres won't let a newly-added enum value be used in the same
-- transaction it was added in, so isolating it avoids any ordering surprise.
ALTER TYPE "ExpenseStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'PENDING';
