-- New DocumentKind value for a vendor's invoice/bill. Kept in its own migration: a newly-added
-- enum value can't be used in the same transaction it's created in.
ALTER TYPE "DocumentKind" ADD VALUE IF NOT EXISTS 'VENDOR_INVOICE';
