import { toDateParam } from "@/lib/week";

// Albania's official non-working public holidays, 2026-2030. Fixed-date holidays repeat every
// year; movable ones (Catholic/Orthodox Easter, Eid al-Fitr, Eid al-Adha) were looked up per
// year rather than computed/guessed — cross-checked against two independent sources
// (worlddata.info and qppstudio.net, which agreed exactly on 2027). Eid al-Fitr/al-Adha dates
// for outer years (2028-2030) follow the Hijri lunar calendar and are estimates published ahead
// of time by convention — Albania's government confirms the exact civil date closer to the
// holiday, so treat those two as approximate if a discrepancy is ever reported.
export type PublicHoliday = { date: string; name: string };

const FIXED_MONTH_DAY: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 2, name: "New Year's Day (2nd day)" },
  { month: 3, day: 14, name: "Summer Day" },
  { month: 3, day: 22, name: "Nevruz Day" },
  { month: 5, day: 1, name: "International Workers' Day" },
  { month: 9, day: 5, name: "Mother Teresa Canonization Day" },
  { month: 11, day: 28, name: "Flag and Independence Day" },
  { month: 11, day: 29, name: "National Liberation Day" },
  { month: 12, day: 8, name: "National Youth Day" },
  { month: 12, day: 25, name: "Christmas Day" },
];

const YEARS = [2026, 2027, 2028, 2029, 2030] as const;

// Movable holidays: Sunday date per year, Monday derived as +1 day where Albania observes it.
const CATHOLIC_EASTER_SUNDAY: Record<number, string> = {
  2026: "2026-04-05",
  2027: "2027-03-28",
  2028: "2028-04-16",
  2029: "2029-04-01",
  2030: "2030-04-21",
};
const ORTHODOX_EASTER_SUNDAY: Record<number, string> = {
  2026: "2026-04-12",
  2027: "2027-05-02",
  2028: "2028-04-16",
  2029: "2029-04-08",
  2030: "2030-04-28",
};
const EID_AL_FITR: Record<number, string> = {
  2026: "2026-03-19",
  2027: "2027-03-09",
  2028: "2028-02-26",
  2029: "2029-02-14",
  2030: "2030-02-04",
};
const EID_AL_ADHA: Record<number, string> = {
  2026: "2026-05-26",
  2027: "2027-05-16",
  2028: "2028-05-04",
  2029: "2029-04-23",
  2030: "2030-04-13",
};

// Local-time date math throughout (matching src/lib/week.ts's convention, no UTC handling
// anywhere else in this codebase) — mixing UTC parsing with toDateParam's local formatting
// would risk an off-by-one-day shift depending on server timezone.
function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toDateParam(d);
}

function buildHolidayMap(): Map<string, string> {
  const map = new Map<string, string>();
  function add(date: string, name: string) {
    const existing = map.get(date);
    map.set(date, existing ? `${existing} / ${name}` : name);
  }

  for (const year of YEARS) {
    for (const { month, day, name } of FIXED_MONTH_DAY) {
      add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, name);
    }
    const catholicSun = CATHOLIC_EASTER_SUNDAY[year];
    add(catholicSun, "Catholic Easter Sunday");
    add(nextDay(catholicSun), "Catholic Easter Monday");

    const orthodoxSun = ORTHODOX_EASTER_SUNDAY[year];
    add(orthodoxSun, "Orthodox Easter Sunday");
    add(nextDay(orthodoxSun), "Orthodox Easter Monday");

    add(EID_AL_FITR[year], "Eid al-Fitr");
    add(EID_AL_ADHA[year], "Eid al-Adha");
  }
  return map;
}

const HOLIDAY_MAP = buildHolidayMap();

export const ALBANIAN_HOLIDAYS: PublicHoliday[] = [...HOLIDAY_MAP.entries()]
  .map(([date, name]) => ({ date, name }))
  .sort((a, b) => a.date.localeCompare(b.date));

/** Returns the holiday name(s) for a date (as a "yyyy-MM-dd" string or a Date), or undefined. */
export function getPublicHoliday(date: string | Date): string | undefined {
  const key = typeof date === "string" ? date : toDateParam(date);
  return HOLIDAY_MAP.get(key);
}
