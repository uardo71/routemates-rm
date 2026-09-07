import { prisma } from "@/lib/prisma";

// Currency conversion against the ExchangeRate table. Rates may be stored in either direction
// (the admin might enter "1 EUR = 105 ALL" as EUR→ALL, or "ALL→EUR" directly); this resolves both,
// and triangulates through EUR when no direct or inverse rate exists for a pair. All reporting
// rollups convert row amounts to the company reporting currency at the row's own economic date.

const PIVOT = "EUR";

/** Pick the latest rate at or before `asOf` from the rows of a single currency pair. */
export function pickLatestRate(rows: { rate: number; effectiveFrom: Date }[], asOf: Date): number | null {
  let best: { rate: number; effectiveFrom: Date } | null = null;
  for (const r of rows) {
    if (r.effectiveFrom.getTime() > asOf.getTime()) continue;
    if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r;
  }
  return best ? best.rate : null;
}

/** A pair→rate lookup (rate already resolved for the relevant date). Returns null when unknown. */
export type RateLookup = (from: string, to: string) => Promise<number | null> | (number | null);

/** Pure conversion decision with an injected lookup: identity, then a direct `from→to` rate
 *  (multiply), then an inverse `to→from` rate (divide), then triangulation through EUR. Null when
 *  no path resolves. Exported for unit testing without a live DB. */
export async function convertWith(amount: number, from: string, to: string, lookup: RateLookup): Promise<number | null> {
  if (from === to) return amount;
  const direct = await lookup(from, to);
  if (direct && direct > 0) return amount * direct;
  const inverse = await lookup(to, from);
  if (inverse && inverse > 0) return amount / inverse;
  // Last resort: go through the pivot currency (from → EUR → to). Each leg only uses direct/inverse
  // (its from or to is EUR), so this never recurses back into triangulation.
  if (from !== PIVOT && to !== PIVOT) {
    const viaEur = await convertWith(amount, from, PIVOT, lookup);
    if (viaEur !== null) return convertWith(viaEur, PIVOT, to, lookup);
  }
  return null;
}

/** Convert `amount` from → to using the ExchangeRate rows effective at or before `asOf`.
 *  Returns null when no rate path exists (caller must then exclude/report the row, never sum at 1:1). */
export async function convertCurrency(amount: number, from: string, to: string, asOf: Date): Promise<number | null> {
  return convertWith(amount, from, to, async (f, t) => {
    const rows = await prisma.exchangeRate.findMany({
      where: { fromCurrency: f, toCurrency: t, effectiveFrom: { lte: asOf } },
      select: { rate: true, effectiveFrom: true },
    });
    return pickLatestRate(rows.map((r) => ({ rate: Number(r.rate), effectiveFrom: r.effectiveFrom })), asOf);
  });
}

export type ExcludedGroup = { currency: string; date: string; count: number };

/** Load every ExchangeRate row once and return an in-memory resolver `(from, to, asOf) → rate|null`,
 *  so a rollup over many rows converts without a query per row. */
export async function loadRateResolver(): Promise<(from: string, to: string, asOf: Date) => number | null> {
  const all = await prisma.exchangeRate.findMany({ select: { fromCurrency: true, toCurrency: true, rate: true, effectiveFrom: true } });
  const byPair = new Map<string, { rate: number; effectiveFrom: Date }[]>();
  for (const r of all) {
    const key = `${r.fromCurrency}>${r.toCurrency}`;
    const arr = byPair.get(key) ?? [];
    arr.push({ rate: Number(r.rate), effectiveFrom: r.effectiveFrom });
    byPair.set(key, arr);
  }
  return (from, to, asOf) => pickLatestRate(byPair.get(`${from}>${to}`) ?? [], asOf);
}

export type ConvertRowsResult<T> = {
  /** Each input row annotated with its amount in `to`, or null when no rate path existed. */
  rows: (T & { baseAmount: number | null })[];
  /** Sum of the convertible rows' converted amounts, in `to`. */
  total: number;
  excludedCount: number;
  /** Unconvertible rows grouped by currency + economic date, for a visible warning. */
  excluded: ExcludedGroup[];
};

/** Convert a batch of {amount, currency, date} rows into `to` at each row's own economic date.
 *  Annotates every row with `baseAmount` (null ⇒ no rate; the caller must exclude it, never sum at
 *  1:1) and groups the unconvertible ones for a warning. Loads exchange rates once. */
export async function convertRows<T extends { amount: number; currency: string; date: Date }>(rows: T[], to: string): Promise<ConvertRowsResult<T>> {
  const resolve = await loadRateResolver();
  let total = 0;
  let excludedCount = 0;
  const ex = new Map<string, ExcludedGroup>();
  const out = [] as (T & { baseAmount: number | null })[];
  for (const r of rows) {
    const v = await convertWith(r.amount, r.currency, to, (f, t) => resolve(f, t, r.date));
    if (v === null) {
      excludedCount++;
      const date = r.date.toISOString().slice(0, 10);
      const key = `${r.currency}|${date}`;
      const g = ex.get(key) ?? { currency: r.currency, date, count: 0 };
      g.count++;
      ex.set(key, g);
      out.push({ ...r, baseAmount: null });
    } else {
      total += v;
      out.push({ ...r, baseAmount: v });
    }
  }
  return { rows: out, total: Math.round(total * 100) / 100, excludedCount, excluded: [...ex.values()] };
}
