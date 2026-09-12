import { BackLink } from "@/components/back-link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  TagIcon, CalendarIcon, WalletIcon, HashIcon, Building2Icon, ClockIcon, UserIcon, CheckCircle2Icon, TriangleAlertIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoField } from "@/components/info-field";
import { InitialsAvatar } from "@/components/initials-avatar";
import { DocumentsCard, type DocRow } from "@/components/documents-card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { taxPeriodLabel } from "@/lib/tax";
import { uploadTaxDocumentAction, deleteTaxDocumentAction } from "../actions";
import { TaxDetailActions, type TaxEditData, type TaxCategoryOpt } from "./tax-detail-client";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function TaxDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await requirePermission("taxes:manage");

  const [payment, categories] = await Promise.all([
    prisma.taxPayment.findFirst({
      where: { id, companyId: caller.companyId },
      include: { category: true, recordedBy: { select: { name: true } }, documents: { orderBy: { uploadedAt: "desc" } } },
    }),
    prisma.taxCategory.findMany({ where: { companyId: caller.companyId }, orderBy: { name: "asc" } }),
  ]);
  if (!payment) notFound();

  const overdue = payment.status === "TO_PAY" && payment.dueDate != null && payment.dueDate < new Date(new Date().toISOString().slice(0, 10));
  const periodLabel = taxPeriodLabel(payment.periodStart, payment.periodEnd);

  const docRows: DocRow[] = payment.documents.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, originalName: d.originalName }));
  const categoryOpts: TaxCategoryOpt[] = categories.map((c) => ({ id: c.id, name: c.name }));
  const editData: TaxEditData = {
    id: payment.id,
    categoryId: payment.categoryId,
    status: payment.status,
    periodStart: iso(payment.periodStart)!,
    periodEnd: iso(payment.periodEnd),
    amount: Number(payment.amount),
    currency: payment.currency,
    serialNumber: payment.serialNumber,
    authority: payment.authority,
    dueDate: iso(payment.dueDate),
    paymentDate: iso(payment.paymentDate),
    notes: payment.notes,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <BackLink href="/taxes" label="Taxes" />
        <div className="mt-1 flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={payment.category.name} className="size-11 text-sm" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">{payment.category.name}</h1>
                {payment.status === "PAID" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2Icon className="size-3.5" /> Paid</span>
                ) : overdue ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"><TriangleAlertIcon className="size-3.5" /> Overdue</span>
                ) : (
                  <Badge variant="secondary">To pay</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{periodLabel} · {formatMoney(Number(payment.amount), payment.currency)}</p>
            </div>
          </div>
          <TaxDetailActions data={editData} categories={categoryOpts} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
              <InfoField icon={TagIcon} label="Category" value={payment.category.name} />
              <InfoField icon={CalendarIcon} label="Tax period" value={periodLabel} />
              <InfoField icon={WalletIcon} label="Amount" value={formatMoney(Number(payment.amount), payment.currency)} />
              <InfoField icon={HashIcon} label="Serial / reference" value={payment.serialNumber ?? "—"} />
              <InfoField icon={Building2Icon} label="Paid to" value={payment.authority ?? "—"} />
              <InfoField icon={ClockIcon} label="Due date" value={payment.dueDate ? format(payment.dueDate, "MMM d, yyyy") : "—"} />
              <InfoField icon={CheckCircle2Icon} label="Payment date" value={payment.paymentDate ? format(payment.paymentDate, "MMM d, yyyy") : "—"} />
              <InfoField icon={UserIcon} label="Recorded by" value={payment.recordedBy?.name ?? "—"} />
            </div>
            {payment.notes && (
              <div className="border-t pt-4">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</span>
                <p className="mt-2 text-sm whitespace-pre-wrap">{payment.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <DocumentsCard
            title="Documents"
            documents={docRows}
            kinds={[
              { value: "TAX_NOTICE", label: "Tax notice" },
              { value: "PAYMENT_RECEIPT", label: "Payment receipt" },
              { value: "OTHER", label: "Other" },
            ]}
            canManage
            uploadAction={uploadTaxDocumentAction.bind(null, payment.id)}
            deleteAction={deleteTaxDocumentAction}
          />
        </div>
      </div>
    </div>
  );
}
