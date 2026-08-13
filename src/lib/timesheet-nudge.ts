import { addDays, subDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { startOfWeek, toDateParam } from "@/lib/week";
import { isWorkingDay } from "@/lib/vacation-calc";

// Detects who hasn't logged time. Read-only: no schema, no state — reused by the internal
// /api/internal/timesheet-nudge route. Both a `daily` (yesterday) and `weekly` (this week so far)
// run are supported. Contractors are included alongside employees (product decision); weekends and
// Albanian public holidays are skipped via the shared isWorkingDay(); anyone on approved leave for
// a given date is skipped for that date.

export type NudgeMode = "daily" | "weekly";

export type MissingPerson = {
  userId: string;
  name: string;
  email: string;
  missingDates: string[]; // yyyy-MM-dd, one per missing working day
};

export type NudgeResult = {
  mode: NudgeMode;
  checkedDates: string[];
  totalConsidered: number;
  missing: MissingPerson[];
};

// yyyy-MM-dd read in UTC — matches how TimeEntry.date / leave dates are persisted (UTC midnight of
// the worked day), so day comparisons never drift with the server timezone (the +UTC off-by-one
// that bit the invoicing logic before).
function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
// UTC-midnight instant for a yyyy-MM-dd string — used only as a query boundary against TimeEntry.date.
function utcDayStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
// Local-midnight Date for weekend/holiday classification: isWorkingDay()/getPublicHoliday() use
// local getDay()/local formatting (see holidays.ts), so feed them a local-midnight date.
function localDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/** Calendar dates a run inspects: [yesterday] for daily; Monday-of-this-week … yesterday for
 *  weekly (today is excluded — still in progress). Weekends and public holidays are filtered out. */
function datesToCheck(mode: NudgeMode, now: Date): string[] {
  const yesterdayStr = toDateParam(subDays(now, 1));
  let candidates: string[];
  if (mode === "daily") {
    candidates = [yesterdayStr];
  } else {
    candidates = [];
    for (let d = startOfWeek(now); toDateParam(d) <= yesterdayStr; d = addDays(d, 1)) {
      candidates.push(toDateParam(d));
    }
  }
  return candidates.filter((ds) => isWorkingDay(localDay(ds)));
}

export type DetectOptions = {
  includeContractors?: boolean; // default true
  excludedUserIds?: string[]; // never nudged
};

export async function detectMissingTimecards(
  mode: NudgeMode,
  opts: DetectOptions = {},
  now: Date = new Date()
): Promise<NudgeResult> {
  const includeContractors = opts.includeContractors ?? true;
  const excludedUserIds = opts.excludedUserIds ?? [];

  const checkedDates = datesToCheck(mode, now);
  if (checkedDates.length === 0) {
    // Nothing to inspect (e.g. a daily run the morning after a weekend/holiday).
    return { mode, checkedDates, totalConsidered: 0, missing: [] };
  }

  // Active users with an Employment record. Contractors are included unless the admin opted out;
  // explicitly-excluded people are never nudged.
  const employments = await prisma.employment.findMany({
    where: {
      ...(includeContractors ? {} : { type: "EMPLOYEE" }),
      user: {
        active: true,
        ...(excludedUserIds.length > 0 ? { id: { notIn: excludedUserIds } } : {}),
      },
    },
    select: {
      startDate: true,
      endDate: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (employments.length === 0) {
    return { mode, checkedDates, totalConsidered: 0, missing: [] };
  }

  const userIds = employments.map((e) => e.user.id);
  const rangeStart = utcDayStart(checkedDates[0]);
  const rangeEndExclusive = addDays(utcDayStart(checkedDates[checkedDates.length - 1]), 1);

  const [entries, leaves] = await Promise.all([
    prisma.timeEntry.findMany({
      // Existence of ANY entry (draft or not) counts as "logged" — the nudge is about entering
      // time at all, not about approval status.
      where: { userId: { in: userIds }, date: { gte: rangeStart, lt: rangeEndExclusive } },
      select: { userId: true, date: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        userId: { in: userIds },
        status: "APPROVED",
        startDate: { lt: rangeEndExclusive },
        endDate: { gte: rangeStart },
      },
      select: { userId: true, startDate: true, endDate: true },
    }),
  ]);

  const loggedKeys = new Set(entries.map((e) => `${e.userId}|${utcDateStr(e.date)}`));

  const leavesByUser = new Map<string, { start: string; end: string }[]>();
  for (const l of leaves) {
    const arr = leavesByUser.get(l.userId) ?? [];
    arr.push({ start: utcDateStr(l.startDate), end: utcDateStr(l.endDate) });
    leavesByUser.set(l.userId, arr);
  }
  const onLeave = (userId: string, dateStr: string) =>
    (leavesByUser.get(userId) ?? []).some((r) => r.start <= dateStr && dateStr <= r.end);

  // A person is "considered" if at least one checked working day falls inside their employment
  // window — so someone hired mid-week or already departed isn't counted against the total.
  const inWindow = (emp: (typeof employments)[number], dateStr: string) => {
    const empStart = utcDateStr(emp.startDate);
    const empEnd = emp.endDate ? utcDateStr(emp.endDate) : null;
    return empStart <= dateStr && (empEnd === null || dateStr <= empEnd);
  };

  const missing: MissingPerson[] = [];
  let totalConsidered = 0;
  for (const emp of employments) {
    const applicableDates = checkedDates.filter((ds) => inWindow(emp, ds));
    if (applicableDates.length === 0) continue;
    totalConsidered++;

    const missingDates = applicableDates.filter(
      (ds) => !onLeave(emp.user.id, ds) && !loggedKeys.has(`${emp.user.id}|${ds}`)
    );
    if (missingDates.length > 0) {
      missing.push({ userId: emp.user.id, name: emp.user.name, email: emp.user.email, missingDates });
    }
  }

  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { mode, checkedDates, totalConsidered, missing };
}
