import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { VendorsClient, type VendorPaymentRow, type VendorOption, type ProjectOption } from "./vendors-client";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function VendorsPage() {
  const caller = await requirePermission("vendors:manage");

  const [payments, vendors, projects, company] = await Promise.all([
    prisma.vendorPayment.findMany({
      where: { companyId: caller.companyId },
      include: { vendor: true, project: { select: { name: true } }, _count: { select: { documents: true } } },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    }),
    prisma.vendor.findMany({
      where: { companyId: caller.companyId },
      include: { _count: { select: { payments: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({ where: { companyId: caller.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.company.findUniqueOrThrow({ where: { id: caller.companyId }, select: { currency: true } }),
  ]);

  const rows: VendorPaymentRow[] = payments.map((p) => ({
    id: p.id,
    vendorId: p.vendorId,
    vendorName: p.vendor.name,
    projectName: p.project?.name ?? null,
    status: p.status,
    description: p.description,
    invoiceNumber: p.invoiceNumber,
    amount: Number(p.amount),
    currency: p.currency,
    invoiceDate: iso(p.invoiceDate),
    invoiceMonth: iso(p.invoiceDate)?.slice(0, 7) ?? null,
    dueDate: iso(p.dueDate),
    paymentDate: iso(p.paymentDate),
    docCount: p._count.documents,
  }));

  const vendorOptions: VendorOption[] = vendors.map((v) => ({ id: v.id, name: v.name, count: v._count.payments }));
  const projectOptions: ProjectOption[] = projects.map((p) => ({ id: p.id, name: p.name }));

  // Aggregates are formatted in the currency the records actually use (predominant), like the Taxes
  // page — vendors may bill in EUR or ALL. Also the default currency for a new payment.
  const currencyCounts = new Map<string, number>();
  for (const p of payments) currencyCounts.set(p.currency, (currencyCounts.get(p.currency) ?? 0) + 1);
  const displayCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? company.currency;

  return <VendorsClient rows={rows} vendors={vendorOptions} projects={projectOptions} defaultCurrency={displayCurrency} />;
}
