import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { taxPeriodLabel } from "@/lib/tax";
import { convertRows } from "@/lib/fx";
import { TaxesClient, type TaxRow, type TaxCategoryOption } from "./taxes-client";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function TaxesPage() {
  const caller = await requirePermission("taxes:manage");

  const [payments, categories, company] = await Promise.all([
    prisma.taxPayment.findMany({
      where: { companyId: caller.companyId },
      include: { category: true, _count: { select: { documents: true } } },
      orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
    }),
    prisma.taxCategory.findMany({
      where: { companyId: caller.companyId },
      include: { _count: { select: { taxPayments: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.company.findUniqueOrThrow({ where: { id: caller.companyId }, select: { currency: true } }),
  ]);

  // Convert each tax payment to the reporting currency at its economic date (payment date, else the
  // period start) so aggregates sum one currency; unconvertible rows are surfaced.
  const reportingCurrency = company.currency;
  const conv = await convertRows(
    payments.map((p) => ({ amount: Number(p.amount), currency: p.currency, date: p.paymentDate ?? p.periodStart })),
    reportingCurrency,
  );

  const rows: TaxRow[] = payments.map((p, i) => ({
    id: p.id,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    status: p.status,
    periodStart: iso(p.periodStart)!,
    periodEnd: iso(p.periodEnd),
    periodLabel: taxPeriodLabel(p.periodStart, p.periodEnd),
    periodMonth: iso(p.periodStart)!.slice(0, 7),
    amount: Number(p.amount),
    baseAmount: conv.rows[i].baseAmount,
    currency: p.currency,
    serialNumber: p.serialNumber,
    authority: p.authority,
    dueDate: iso(p.dueDate),
    paymentDate: iso(p.paymentDate),
    docCount: p._count.documents,
  }));

  const categoryOptions: TaxCategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name, count: c._count.taxPayments }));

  // Aggregate totals (KPIs, donut, chart, footer) are formatted in the currency the tax records
  // actually use — taxes here are paid in ALL, not the company's reporting currency (EUR). Pick the
  // most-common currency among records, falling back to the company default when there are none.
  // Also becomes the default currency for a new record, so logging one doesn't start on the wrong unit.
  const currencyCounts = new Map<string, number>();
  for (const p of payments) currencyCounts.set(p.currency, (currencyCounts.get(p.currency) ?? 0) + 1);
  const displayCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? company.currency;

  return <TaxesClient rows={rows} categories={categoryOptions} defaultCurrency={displayCurrency} reportingCurrency={reportingCurrency} excluded={conv.excluded} />;
}
