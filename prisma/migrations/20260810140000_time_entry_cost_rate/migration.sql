-- Historical cost basis: each time entry can carry the cost rate (EUR/h) that was correct on the
-- date it was worked, frozen when its card is approved. Null until approved / for legacy rows.
ALTER TABLE "TimeEntry" ADD COLUMN "costRate" DECIMAL(10,4);
