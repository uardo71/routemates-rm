import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { convertCurrency } from "@/lib/fx";

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

/** Pure monthly-salary → hourly-rate arithmetic: monthly EUR ÷ (working days in that month × 8h),
 *  rounded to cents. The month drives the divisor, so the same salary yields a slightly different
 *  hourly rate month to month (fewer working days ⇒ higher rate) — intentional. */
export function hourlyRateFromMonthly(monthlyEUR: number, year: number, month: number): number {
  const hours = workingDaysInMonth(year, month) * HOURS_PER_WORKING_DAY;
  return Math.round((monthlyEUR / hours) * 100) / 100;
}

/**
 * Thin wrapper over the generalized {@link convertCurrency} for the common salary/cost case of
 * converting into EUR as of a date. Behaviour is unchanged: EUR is identity; a direct `currency→EUR`
 * rate multiplies, an inverse `EUR→currency` rate divides; null when no rate is on file (a EUR target
 * never triangulates, so this matches the previous direct/inverse-only behaviour exactly).
 */
export async function convertToEUR(amount: number, currency: string, asOf: Date): Promise<number | null> {
  return convertCurrency(amount, currency, "EUR", asOf);
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

  return hourlyRateFromMonthly(monthlyEUR, asOf.getFullYear(), asOf.getMonth() + 1);
}

/** Freezes the historically-correct cost AND bill rates onto every time entry of the given cards —
 *  call after those cards become APPROVED so economics "lock" at approval. Cost: the hourly rate
 *  correct on the worked date (salary + FX effective then), falling back to the assignment's cost
 *  snapshot when the person has no salary/FX on file. Bill: the assignment's bill-rate snapshot
 *  (null for FIXED_PRICE / legacy assignments — there's no per-date sell-rate source). Reads see
 *  committed data ("as of approval"). Safe to re-run — it restamps whatever entries the cards hold. */
export async function stampCostRatesForCards(cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;
  const entries = await prisma.timeEntry.findMany({
    where: { timeCardId: { in: cardIds } },
    select: { id: true, userId: true, date: true, assignment: { select: { costRate: true, billRate: true } } },
  });
  // Compute all rates first (parallel reads), then write — keeps the async derivation out of any
  // caller transaction and off the interactive-transaction time budget.
  const updates = await Promise.all(
    entries.map(async (e) => ({
      id: e.id,
      costRate: (await computeHourlyCostRateEUR(e.userId, e.date)) ?? Number(e.assignment.costRate),
      billRate: e.assignment.billRate != null ? Number(e.assignment.billRate) : null,
    })),
  );
  await prisma.$transaction(updates.map((u) => prisma.timeEntry.update({ where: { id: u.id }, data: { costRate: u.costRate, billRate: u.billRate } })));
}

/** Recomputes and persists `userId`'s Employment.costRate from their current salary. No-ops if
 *  the user has no Employment row, or has no salary on file yet (costRate stays at whatever it
 *  was — 0 until a salary is added). Call after any salary or exchange-rate change. */
export type CostRateChangedHook = (tx: Prisma.TransactionClient, before: Record<string, unknown>, after: Record<string, unknown>) => Promise<void>;

export async function recomputeEmploymentCostRate(userId: string, onChanged?: CostRateChangedHook): Promise<void> {
  const employment = await prisma.employment.findUnique({ where: { userId } });
  if (!employment) return;

  const computed = await computeHourlyCostRateEUR(userId);
  if (computed === null) return;

  await prisma.$transaction(async (tx) => {
    const after = await tx.employment.update({
      where: { userId },
      data: { costRate: computed },
    });
    // The derived rate is the number margin reports run on — record who triggered the change.
    if (onChanged && Number(employment.costRate) !== Number(after.costRate)) await onChanged(tx, employment, after);
  });
}
