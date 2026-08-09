import { addDays } from "date-fns";
import { getPublicHoliday } from "@/lib/holidays";

// Pure date math only (no prisma import) so it's safe to use from client components too —
// e.g. a live working-day count as someone picks a date range on the request form.

export const ANNUAL_VACATION_ENTITLEMENT = 20;

// No single vacation request should ever legitimately span more than this many calendar days —
// generous, but bounded. Without this cap, a mid-typo date (e.g. a garbled year while editing
// a native <input type="date">) can momentarily produce a multi-century range, and the
// day-by-day loop below would then iterate literally millions of times synchronously, freezing
// the tab. -1 is a sentinel meaning "invalid or too large" — callers must check for it rather
// than treating it as a real (negative) day count.
export const MAX_VACATION_RANGE_DAYS = 400;

export function isWorkingDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !getPublicHoliday(date);
}

/** Working days in [start, end], inclusive, excluding weekends and Albanian public holidays.
 *  Returns -1 (see MAX_VACATION_RANGE_DAYS) if the dates are invalid or the range is absurdly
 *  large — never loops an unbounded number of times. */
export function countWorkingDays(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return -1;
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (spanDays < 0 || spanDays > MAX_VACATION_RANGE_DAYS) return -1;
  let count = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (isWorkingDay(d)) count++;
  }
  return count;
}

/** First calendar year of employment is prorated by months remaining (rounded); every
 *  subsequent year gets the full annual entitlement. */
export function entitlementForYear(joinDate: Date, year: number): number {
  const joinYear = joinDate.getFullYear();
  if (year < joinYear) return 0;
  if (year > joinYear) return ANNUAL_VACATION_ENTITLEMENT;
  const monthsRemaining = 12 - joinDate.getMonth(); // getMonth() is 0-indexed: July -> 6 -> 6 months left
  return Math.round((ANNUAL_VACATION_ENTITLEMENT * monthsRemaining) / 12);
}
