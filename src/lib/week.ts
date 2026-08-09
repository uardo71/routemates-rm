import { addDays, format, startOfWeek as dfStartOfWeek, parseISO } from "date-fns";

export function startOfWeek(date: Date): Date {
  return dfStartOfWeek(date, { weekStartsOn: 1 });
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function toDateParam(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function parseDateParam(value: string | undefined): Date {
  if (!value) return startOfWeek(new Date());
  try {
    return startOfWeek(parseISO(value));
  } catch {
    return startOfWeek(new Date());
  }
}
