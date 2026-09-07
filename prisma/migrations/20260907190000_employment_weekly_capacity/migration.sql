-- Contracted hours per full working week, per person. Planner capacity derives a day from this
-- (weeklyCapacityHours / 5), so part-timers and contractors are no longer assumed to be 40h/week.
ALTER TABLE "Employment" ADD COLUMN "weeklyCapacityHours" DECIMAL(5,2) NOT NULL DEFAULT 40;
