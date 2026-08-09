import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { invoiceTotals } from "@/lib/invoice";
import { InvoiceDetailClient, type InvoiceDetail } from "./invoice-detail-client";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("invoices:manage");

  const inv = await prisma.invoice.findFirst({
    where: { id, companyId: user.companyId },
    include: {
      client: { select: { name: true } },
      project: { select: { id: true, name: true } },
      lines: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { date: "asc" } },
      creditNoteFor: { select: { id: true, invoiceNumber: true } },
      creditNotes: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });
  if (!inv) notFound();

  const t = invoiceTotals(inv.lines.map((l) => ({ amount: Number(l.amount) })), inv.vatRate == null ? null : Number(inv.vatRate));
  const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);

  const detail: InvoiceDetail = {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    type: inv.type,
    status: inv.status,
    selfBilled: inv.selfBilled,
    clientName: inv.client.name,
    projectId: inv.project?.id ?? null,
    projectName: inv.project?.name ?? null,
    currency: inv.currency,
    issueDate: inv.issueDate.toISOString().slice(0, 10),
    recognitionDate: inv.recognitionDate ? inv.recognitionDate.toISOString().slice(0, 10) : null,
    dueDate: inv.dueDate ? inv.dueDate.toISOString().slice(0, 10) : null,
    periodStart: inv.periodStart ? inv.periodStart.toISOString().slice(0, 10) : null,
    periodEnd: inv.periodEnd ? inv.periodEnd.toISOString().slice(0, 10) : null,
    vatRate: inv.vatRate == null ? null : Number(inv.vatRate),
    fiscalNumber: inv.fiscalNumber,
    fiscalReference: inv.fiscalReference,
    customerReference: inv.customerReference,
    poNumber: inv.poNumber,
    notes: inv.notes,
    net: t.net,
    vat: t.vat,
    gross: t.gross,
    paid: Math.round(paid * 100) / 100,
    outstanding: Math.round((t.gross - paid) * 100) / 100,
    lines: inv.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), rate: Number(l.rate), amount: Number(l.amount) })),
    payments: inv.payments.map((p) => ({ id: p.id, amount: Number(p.amount), date: p.date.toISOString().slice(0, 10), method: p.method, reference: p.reference })),
    creditNoteFor: inv.creditNoteFor ? { id: inv.creditNoteFor.id, invoiceNumber: inv.creditNoteFor.invoiceNumber } : null,
    creditNotes: inv.creditNotes.map((c) => ({ id: c.id, invoiceNumber: c.invoiceNumber })),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">← Invoice register</Link>
      </div>
      <InvoiceDetailClient detail={detail} />
    </div>
  );
}
