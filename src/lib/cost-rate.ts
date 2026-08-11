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
 * Converts `amount` from `currency` into EUR using whichever exchange-rate row is on file as of
 * `asOf`, accepting EITHER direction the admin entered it in:
 *   • a direct `currency → EUR` row — its rate is EUR per unit, so multiply;
 *   • an inverse `EUR → currency` row (e.g. "1 EUR = 105 ALL") — its rate is `currency` per EUR,
 *     so divide.
 * This makes cost rates robust to how the rate was typed (the natural "1 EUR = 105 ALL" no longer
 * silently fails to convert). Prefers a direct row when both exist. Returns null when neither is on
 * file as of that date (caller then has no basis to cost in EUR).
 */
export async function convertToEUR(amount: number, currency: string, asOf: Date): Promise<number | null> {
  if (currency === "EUR") return amount;
  const direct = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: currency, toCurrency: "EUR", effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (direct && Number(direct.rate) > 0) return amount * Number(direct.rate);

  const inverse = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: "EUR", toCurrency: currency, effectiveFrom: { lte: asOf } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (inverse && Number(inverse.rate) > 0) return amount / Number(inverse.rate);

  return null;
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
    const converted = await convertToEUR(monthlyEUR, salary.currency, asOf);
    if (converted === null) return null;
    monthlyEUR = converted;
  }

  const hours = workingDaysInMonth(asOf.getFullYear(), asOf.getMonth() + 1) * HOURS_PER_WORKING_DAY;
  return Math.round((monthlyEUR / hours) * 100) / 100;
}

/** Freezes the historically-correct cost rate onto every time entry of the given cards — call
 *  after those cards become APPROVED so cost "locks" at approval. Each entry gets the hourly rate
 *  that was correct on its own worked date (salary + FX effective then); falls back to the
 *  assignment's snapshot rate when the person has no salary/FX on file as of that date (preserves
 *  prior behaviour rather than costing at 0). Reads see committed salary/FX ("as of approval").
 *  Safe to re-run — it restamps whatever entries the cards currently hold. */
export async function stampCostRatesForCards(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  const entries = await prisma.timeEntry.findMany({
    where: { timeCardId: { in: cardIds } },
    select: { id: true, userId: true, date: true, assignment: { select: { costRate: true } } },
  });
  // Compute all rates first (parallel reads), then write — keeps the async derivation out of any
  // caller transaction and off the interactive-transaction time budget.
  const updates = await Promise.all(
    entries.map(async (e) => ({
      id: e.id,
      costRate: (await computeHourlyCostRateEUR(e.userId, e.date)) ?? Number(e.assignment.costRate),
    })),
  );
  await prisma.$transaction(updates.map((u) => prisma.timeEntry.update({ where: { id: u.id }, data: { costRate: u.costRate } })));
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
