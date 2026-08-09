import { prisma } from "@/lib/prisma";

const HOURS_PER_WORKING_DAY = 8;

/** Count Mon-Fri calendar days in the given month (1-indexed month, e.g. 1=January). */
export function workingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(year, month - 1, day).getDay(); // 0=Sun..6=Sat
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/**
 * Derives an hourly cost rate in EUR for `userId` as of `asOf` (defaults to now), from their
 * salary history and the historical ALL->EUR exchange rate — never a manually-typed number.
 * Returns null if the user has no salary on file yet as of that date (caller should fall back
 * to the job title's default cost rate in that case).
 */
export async function computeHourlyCostRateEUR(userId: string, asOf: Date = new Date()): Promise<number | null> {
  const salary = await prisma.salary.findFirst({
    where: { userId, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!salary) return null;

  let monthlyEUR = Number(salary.monthlyAmount);
  if (salary.currency !== "EUR") {
    const rate = await prisma.exchangeRate.findFirst({
      where: { fromCurrency: salary.currency, toCurrency: "EUR", effectiveFrom: { lte: asOf } },
      orderBy: { effectiveFrom: "desc" },
    });
    if (!rate) return null;
    monthlyEUR = monthlyEUR / Number(rate.rate);
  }

  const hours = workingDaysInMonth(asOf.getFullYear(), asOf.getMonth() + 1) * HOURS_PER_WORKING_DAY;
  return Math.round((monthlyEUR / hours) * 100) / 100;
}

/** Recomputes and persists `userId`'s Employment.costRate from their current salary. No-ops if
 *  the user has no Employment row, or has no salary on file yet (costRate stays at whatever it
 *  was — 0 until a salary is added). Call after any salary or exchange-rate change. */
export async function recomputeEmploymentCostRate(userId: string): Promise<void> {
  const employment = await prisma.employment.findUnique({ where: { userId } });
  if (!employment) return;

  const computed = await computeHourlyCostRateEUR(userId);
  if (computed === null) return;

  await prisma.employment.update({
    where: { userId },
    data: { costRate: computed },
  });
}
