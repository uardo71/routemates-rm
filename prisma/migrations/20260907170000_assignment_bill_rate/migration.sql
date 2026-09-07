-- Bill (sell) rate on assignments, snapshotted from the milestone salesPrice for T&M/RETAINER, and
-- the frozen bill rate on time entries (stamped at approval, mirroring costRate). No backfill.
ALTER TABLE "Assignment" ADD COLUMN "billRate" DECIMAL(10,4);
ALTER TABLE "TimeEntry" ADD COLUMN "billRate" DECIMAL(10,4);
