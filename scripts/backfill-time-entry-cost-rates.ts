/**
 * One-time backfill: stamp the historical cost rate onto every APPROVED time entry that doesn't
 * have one yet, so past Revenue/Budget cost & margin become time-travel accurate.
 *
 * Run once after restoring real data:  pnpm exec tsx scripts/backfill-time-entry-cost-rates.ts
 *
 * Idempotent — it only touches entries whose costRate is still null, so re-running is safe.
 * The rate formula MUST stay in sync with src/lib/cost-rate.ts#computeHourlyCostRateEUR (duplicated
 * here because tsx doesn't resolve the "@/" path alias the app module relies on).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const HOURS_PER_WORKING_DAY = 8;

function workingDaysInMonth(year: number, month: number): number {
  const days = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const wd = new Date(year, month - 1, d).getDay();
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

async function historicalRate(userId: string, asOf: Date): Promise<number | null> {
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

async function main() {
  const entries = await prisma.timeEntry.findMany({
    where: { costRate: null, timeCard: { status: "APPROVED" } },
    select: { id: true, userId: true, date: true, assignment: { select: { costRate: true } } },
  });
  console.log(`Backfilling ${entries.length} approved time entries with no cost rate...`);
  let stamped = 0;
  for (const e of entries) {
    const rate = (await historicalRate(e.userId, e.date)) ?? Number(e.assignment.costRate);
    await prisma.timeEntry.update({ where: { id: e.id }, data: { costRate: rate } });
    stamped++;
  }
  console.log(`Done. Stamped ${stamped} entries.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
