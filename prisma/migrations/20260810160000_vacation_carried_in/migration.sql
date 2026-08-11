-- Manual opening vacation balance on Employment, for teams onboarded mid-life with no
-- historical LeaveRequests to derive carryover from.
ALTER TABLE "Employment" ADD COLUMN "carriedInVacationDays" DECIMAL(5,2);
ALTER TABLE "Employment" ADD COLUMN "carriedInVacationYear" INTEGER;
