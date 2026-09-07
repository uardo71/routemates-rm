import { describe, it, expect } from "vitest";
import {
  weekCapacity, holidayDaysInWeek, leaveDaysInWeek, leaveDaysInWeekForAll,
  bookingStatus, freeHours, DEFAULT_WEEKLY_CAPACITY_HOURS,
} from "@/lib/capacity";

// A Monday, so weeks line up with the planner's week keys.
const WEEK = "2026-06-01"; // Mon 1 Jun – Sun 7 Jun 2026
const noHolidays = () => false;

describe("weekCapacity", () => {
  it("is the full contracted week when nothing is deducted", () => {
    expect(weekCapacity({ weeklyCapacityHours: 40, holidayDays: 0, leaveDays: 0 })).toEqual({
      gross: 40, holiday: 0, leave: 0, available: 40,
    });
  });

  it("zeroes out a full holiday week", () => {
    // Christmas/New Year weeks where every working day is a holiday: nothing is available.
    expect(weekCapacity({ weeklyCapacityHours: 40, holidayDays: 5, leaveDays: 0 })).toEqual({
      gross: 40, holiday: 40, leave: 0, available: 0,
    });
  });

  it("deducts one holiday as a fifth of the week, not a fixed 8h", () => {
    expect(weekCapacity({ weeklyCapacityHours: 40, holidayDays: 1, leaveDays: 0 }).available).toBe(32);
  });

  it("scales a day to the contract for a part-timer", () => {
    // 20h/week ⇒ a day is 4h, so one holiday costs 4h and not 8.
    const halfTime = weekCapacity({ weeklyCapacityHours: 20, holidayDays: 1, leaveDays: 0 });
    expect(halfTime).toEqual({ gross: 20, holiday: 4, leave: 0, available: 16 });
    // A part-timer on leave for the whole week is at 0, not at -20.
    expect(weekCapacity({ weeklyCapacityHours: 20, holidayDays: 0, leaveDays: 5 }).available).toBe(0);
  });

  it("handles a fractional contract (e.g. 37.5h) without drifting", () => {
    const c = weekCapacity({ weeklyCapacityHours: 37.5, holidayDays: 1, leaveDays: 1 });
    expect(c.holiday).toBe(7.5);
    expect(c.leave).toBe(7.5);
    expect(c.available).toBe(22.5);
  });

  it("never returns a negative week when holiday and leave overlap", () => {
    // A caller that double-counts (a holiday also inside a leave range) must not produce -8h.
    const c = weekCapacity({ weeklyCapacityHours: 40, holidayDays: 1, leaveDays: 5 });
    expect(c.available).toBe(0);
    expect(c.holiday + c.leave).toBe(40); // the overlap is absorbed, not added on top
  });

  it("treats a zero/negative contract as no capacity", () => {
    expect(weekCapacity({ weeklyCapacityHours: 0, holidayDays: 0, leaveDays: 0 }).available).toBe(0);
    expect(weekCapacity({ weeklyCapacityHours: -5, holidayDays: 0, leaveDays: 0 }).available).toBe(0);
  });

  it("defaults to a 40-hour week", () => {
    expect(DEFAULT_WEEKLY_CAPACITY_HOURS).toBe(40);
  });
});

describe("holidayDaysInWeek", () => {
  it("counts only holidays that fall on a working day", () => {
    const onWed = (iso: string) => iso === "2026-06-03";
    expect(holidayDaysInWeek(WEEK, onWed)).toBe(1);
    // A holiday landing on the Saturday costs nobody a working day.
    expect(holidayDaysInWeek(WEEK, (iso) => iso === "2026-06-06")).toBe(0);
    expect(holidayDaysInWeek(WEEK, noHolidays)).toBe(0);
  });

  it("finds the real Albanian holidays in a known week", () => {
    // 1 May (Labour Day) 2026 is a Friday; that week starts Mon 27 Apr.
    expect(holidayDaysInWeek("2026-04-27")).toBeGreaterThanOrEqual(1);
  });
});

describe("leaveDaysInWeek", () => {
  it("counts the working days of a leave inside the week", () => {
    // Mon–Wed off.
    expect(leaveDaysInWeek({ startDate: "2026-06-01", endDate: "2026-06-03" }, WEEK, noHolidays)).toBe(3);
  });

  it("ignores weekends inside the leave range", () => {
    // A full calendar week of leave is still only 5 working days.
    expect(leaveDaysInWeek({ startDate: "2026-06-01", endDate: "2026-06-07" }, WEEK, noHolidays)).toBe(5);
  });

  it("does not double-count a holiday that falls inside the leave", () => {
    const onWed = (iso: string) => iso === "2026-06-03";
    // Mon–Fri off, but Wednesday is a public holiday — it's deducted as a holiday, so leave is 4.
    expect(leaveDaysInWeek({ startDate: "2026-06-01", endDate: "2026-06-05" }, WEEK, onWed)).toBe(4);
    // The two deductions together still cost exactly the five working days of the week.
    const cap = weekCapacity({
      weeklyCapacityHours: 40,
      holidayDays: holidayDaysInWeek(WEEK, onWed),
      leaveDays: leaveDaysInWeek({ startDate: "2026-06-01", endDate: "2026-06-05" }, WEEK, onWed),
    });
    expect(cap.holiday).toBe(8);
    expect(cap.leave).toBe(32);
    expect(cap.available).toBe(0);
  });

  it("splits a leave that spans a week boundary across both weeks", () => {
    // Thu 4 Jun → Wed 10 Jun: 2 days in the first week (Thu, Fri), 3 in the next (Mon–Wed).
    const leave = { startDate: "2026-06-04", endDate: "2026-06-10" };
    expect(leaveDaysInWeek(leave, "2026-06-01", noHolidays)).toBe(2);
    expect(leaveDaysInWeek(leave, "2026-06-08", noHolidays)).toBe(3);
    // Neither week sees the whole leave, and together they account for all 5 working days.
    expect(leaveDaysInWeek(leave, "2026-06-01", noHolidays) + leaveDaysInWeek(leave, "2026-06-08", noHolidays)).toBe(5);
    // A week the leave doesn't touch is unaffected.
    expect(leaveDaysInWeek(leave, "2026-06-15", noHolidays)).toBe(0);
  });

  it("excludes days the person came back to work early", () => {
    const leave = {
      startDate: "2026-06-01", endDate: "2026-06-05",
      returns: [{ startDate: "2026-06-04", endDate: "2026-06-05" }],
    };
    expect(leaveDaysInWeek(leave, WEEK, noHolidays)).toBe(3); // Mon–Wed only
  });

  it("sums several leave requests in the same week", () => {
    const leaves = [
      { startDate: "2026-06-01", endDate: "2026-06-01" },
      { startDate: "2026-06-04", endDate: "2026-06-05" },
    ];
    expect(leaveDaysInWeekForAll(leaves, WEEK, noHolidays)).toBe(3);
    expect(leaveDaysInWeekForAll([], WEEK, noHolidays)).toBe(0);
  });
});

describe("bookingStatus", () => {
  it("classifies a normal week", () => {
    expect(bookingStatus(48, 40)).toBe("OVER");
    expect(bookingStatus(40, 40)).toBe("FULL");
    expect(bookingStatus(20, 40)).toBe("PARTIAL");
    expect(bookingStatus(0, 40)).toBe("FREE");
  });

  it("calls a zero-capacity week FULL, not FREE — there is nothing to give", () => {
    // A full holiday week with nothing booked must not advertise the person as available.
    expect(bookingStatus(0, 0)).toBe("FULL");
    // But work booked into a zero-capacity week is still over-allocated.
    expect(bookingStatus(8, 0)).toBe("OVER");
  });

  it("flags a part-timer booked at full-time hours as over", () => {
    expect(bookingStatus(40, 20)).toBe("OVER");
  });
});

describe("freeHours", () => {
  it("is what's left, floored at zero", () => {
    expect(freeHours(10, 40)).toBe(30);
    expect(freeHours(40, 40)).toBe(0);
    expect(freeHours(50, 40)).toBe(0); // over-allocation is reported separately, not as negative free
    expect(freeHours(0, 0)).toBe(0);
  });
});
