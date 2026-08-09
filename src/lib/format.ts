/** Formats a money amount with thousands separators and a currency sign, e.g. "$1,000.00" /
 *  "€1,234.56". Accepts a Decimal-like value (anything with `.toString()`) or a plain number. */
export function formatMoney(amount: { toString(): string } | number, currency: string = "USD"): string {
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Formats a plain number with thousands separators, no currency sign (e.g. hours). */
export function formatNumber(amount: { toString(): string } | number, maxFractionDigits = 2): string {
  const n = typeof amount === "number" ? amount : Number(amount.toString());
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(n);
}

/** Returns just the currency's symbol (e.g. "$" for USD, "€" for EUR) for use in form labels —
 *  falls back to the currency code itself if the runtime has no narrow symbol for it (e.g. ALL). */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}
