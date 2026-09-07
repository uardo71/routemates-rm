import { getPublicHoliday } from "@/lib/holidays";

// Pure capacity math — no Prisma. The page does the querying and hands these functions plain
// day counts / ISO date strings, so weekly availability stays unit-testable.

/** A working week is five days; one day of capacity is a fifth of the contracted week. */
export const WORKING_DAYS_PER_WEEK = 5;

export const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type WeekCapacityInput = {
  /** Contracted hours in a full working week (40 for a full-timer, 20 for a half-timer). */
  weeklyCapacityHours: number;
  /** Public holidays falling on a working day of this week. */
  holidayDays: number;
  /** Approved leave working-days in this week, EXCLUDING any that are already public holidays —
   *  the caller de-duplicates (see `leaveDaysInWeek`) so a holiday inside a leave range is
   *  deducted once, not twice. */
  leaveDays: number;
};

export type WeekCapacity = {
  /** Contracted hours for the week before any deduction. */
  gross: number;
  /** Hours removed by public holidays. */
  holiday: number;
  /** Hours removed by approved leave. */
  leave: number;
  /** What's actually left to plan against. Never negative. */
  available: number;
};

/** Available hours for one person in one week. A day is `weeklyCapacityHours / 5`, so the
 *  deductions scale with the contract rather than assuming everyone loses 8h per holiday. */
export function weekCapacity(input: WeekCapacityInput): WeekCapacity {
  const gross = round2(Math.max(0, input.weeklyCapacityHours));
  const dayHours = gross / WORKING_DAYS_PER_WEEK;

  // Defensive clamps: a week can't lose more than five days. If a caller passes overlapping
  // holiday and leave day counts, the overlap is absorbed here rather than producing a negative
  // week — availability floors at 0, it never goes below.
  const holidayDays = Math.min(Math.max(0, input.holidayDays), WORKING_DAYS_PER_WEEK);
  const leaveDays = Math.min(Math.max(0, input.leaveDays), WORKING_DAYS_PER_WEEK - holidayDays);

  const holiday = round2(holidayDays * dayHours);
  const leave = round2(leaveDays * dayHours);
  return { gross, holiday, leave, available: round2(Math.max(0, gross - holiday - leave)) };
}

// ---------- per-week day counting (ISO "yyyy-MM-dd" strings, timezone-free) ----------

/** Default holiday test — the Albanian public-holiday calendar. Overridable so tests don't
 *  depend on the real calendar. */
const defaultIsHoliday = (iso: string) => getPublicHoliday(iso) !== undefined;

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Saturday/Sunday — evaluated in UTC so the result can't shift with the server's timezone. */
function isWeekendIso(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Public holidays falling on a working day (Mon–Fri) of the week starting `weekStartKey`. */
export function holidayDaysInWeek(weekStartKey: string, isHoliday: (iso: string) => boolean = defaultIsHoliday): number {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDaysIso(weekStartKey, i);
    if (!isWeekendIso(day) && isHoliday(day)) count++;
  }
  return count;
}

export type LeaveRange = {
  /** Inclusive ISO dates. */
  startDate: string;
  endDate: string;
  /** Early return-to-work ranges — days inside one of these were worked, so they're not leave. */
  returns?: { startDate: string; endDate: string }[];
};

/** Working days of `leave` that fall inside the week starting `weekStartKey`.
 *
 *  Excludes weekends, days already counted as public holidays (so a holiday inside a leave range
 *  is deducted once, not twice — matching `isWorkingDay`, which is what the stored
 *  `LeaveRequest.workingDays` is computed from), and any day covered by an early return.
 *  A leave that straddles a week boundary contributes only its days on this side of it. */
export function leaveDaysInWeek(
  leave: LeaveRange,
  weekStartKey: string,
  isHoliday: (iso: string) => boolean = defaultIsHoliday,
): number {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDaysIso(weekStartKey, i);
    if (day < leave.startDate || day > leave.endDate) continue; // ISO strings sort chronologically
    if (isWeekendIso(day)) continue;
    if (isHoliday(day)) continue; // counted as a holiday, not as leave
    if (leave.returns?.some((r) => day >= r.startDate && day <= r.endDate)) continue; // back at work
    count++;
  }
  return count;
}

/** Total leave days in a week across every one of a person's approved leave requests. */
export function leaveDaysInWeekForAll(
  leaves: LeaveRange[],
  weekStartKey: string,
  isHoliday: (iso: string) => boolean = defaultIsHoliday,
): number {
  return leaves.reduce((s, l) => s + leaveDaysInWeek(l, weekStartKey, isHoliday), 0);
}

// ---------- booking status (drives the planner's cell colouring) ----------

export type BookingStatus = "OVER" | "FULL" | "PARTIAL" | "FREE";

/** How a week's booked hours sit against what's actually available.
 *  A week with no capacity left (full holiday week, or someone on leave all week) is FULL rather
 *  than FREE when nothing is booked — there is nothing to give. */
export function bookingStatus(booked: number, available: number): BookingStatus {
  if (booked > available) return "OVER";
  if (available <= 0) return "FULL";
  if (booked <= 0) return "FREE";
  return booked === available ? "FULL" : "PARTIAL";
}

/** Hours still free in a week. Never negative — over-allocation is reported separately. */
export function freeHours(booked: number, available: number): number {
  return round2(Math.max(0, available - booked));
}
