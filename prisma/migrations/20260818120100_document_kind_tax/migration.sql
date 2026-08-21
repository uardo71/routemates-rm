-- New DocumentKind values for tax-payment attachments. Kept in their own migration: a newly-added
-- enum value can't be used in the same transaction it's created in, so isolating them guarantees
-- they're committed before any row references them.
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'TAX_NOTICE';
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'PAYMENT_RECEIPT';
