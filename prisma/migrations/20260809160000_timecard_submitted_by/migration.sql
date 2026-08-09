-- Track who actually clicked Submit, distinct from the card's owner (`userId`) — a PM/Admin
-- proxy-submitting on someone else's behalf means these can differ. Nullable, non-destructive:
-- existing rows (draft or already decided before this migration) simply have no submitter on file.
ALTER TABLE "TimeCard" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "TimeCard" ADD CONSTRAINT "TimeCard_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
