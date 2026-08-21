import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  Building2Icon, FolderKanbanIcon, WalletIcon, HashIcon, CalendarIcon, ClockIcon, UserIcon, CheckCircle2Icon, TriangleAlertIcon, FileTextIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InfoField } from "@/components/info-field";
import { InitialsAvatar } from "@/components/initials-avatar";
import { DocumentsCard, type DocRow } from "@/components/documents-card";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { uploadVendorDocumentAction, deleteVendorDocumentAction } from "../actions";
import { VendorDetailActions, type VendorEditData, type VendorOpt, type ProjectOpt } from "./vendor-detail-client";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function VendorPaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const caller = await requirePermission("vendors:manage");

  const [payment, vendors, projects] = await Promise.all([
    prisma.vendorPayment.findFirst({
      where: { id, companyId: caller.companyId },
      include: { vendor: true, project: { select: { id: true, name: true } }, recordedBy: { select: { name: true } }, documents: { orderBy: { uploadedAt: "desc" } } },
    }),
    prisma.vendor.findMany({ where: { companyId: caller.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { companyId: caller.companyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (!payment) notFound();

  const today = new Date(new Date().toISOString().slice(0, 10));
  const overdue = payment.status === "TO_PAY" && payment.dueDate != null && payment.dueDate < today;

  const docRows: DocRow[] = payment.documents.map((d) => ({ id: d.id, kind: d.kind, fileName: d.fileName, originalName: d.originalName }));
  const editData: VendorEditData = {
    id: payment.id,
    vendorId: payment.vendorId,
    projectId: payment.projectId,
    status: payment.status,
    description: payment.description,
    invoiceNumber: payment.invoiceNumber,
    amount: Number(payment.amount),
    currency: payment.currency,
    invoiceDate: iso(payment.invoiceDate),
    dueDate: iso(payment.dueDate),
    paymentDate: iso(payment.paymentDate),
    notes: payment.notes,
  };
  const vendorOpts: VendorOpt[] = vendors.map((v) => ({ id: v.id, name: v.name }));
  const projectOpts: ProjectOpt[] = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/vendors" className="text-sm text-muted-foreground hover:underline">← Vendor payments</Link>
        <div className="mt-1 flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={payment.vendor.name} className="size-11 text-sm" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">{payment.vendor.name}</h1>
                {payment.status === "PAID" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2Icon className="size-3.5" /> Paid</span>
                ) : overdue ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"><TriangleAlertIcon className="size-3.5" /> Overdue</span>
                ) : (
                  <Badge variant="secondary">To pay</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{payment.description ?? "—"} · {formatMoney(Number(payment.amount), payment.currency)}</p>
            </div>
          </div>
          <VendorDetailActions data={editData} vendors={vendorOpts} projects={projectOpts} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
              <InfoField icon={Building2Icon} label="Vendor" value={payment.vendor.name} />
              <InfoField icon={FileTextIcon} label="For" value={payment.description ?? "—"} />
              <InfoField icon={WalletIcon} label="Amount" value={formatMoney(Number(payment.amount), payment.currency)} />
              <InfoField icon={HashIcon} label="Invoice / reference" value={payment.invoiceNumber ?? "—"} />
              <InfoField icon={FolderKanbanIcon} label="Project" value={payment.project?.name ?? "— overhead —"} />
              <InfoField icon={CalendarIcon} label="Invoice date" value={payment.invoiceDate ? format(payment.invoiceDate, "MMM d, yyyy") : "—"} />
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
              { value: "VENDOR_INVOICE", label: "Vendor invoice" },
              { value: "PAYMENT_RECEIPT", label: "Payment receipt" },
              { value: "OTHER", label: "Other" },
            ]}
            canManage
            uploadAction={uploadVendorDocumentAction.bind(null, payment.id)}
            deleteAction={deleteVendorDocumentAction}
          />
        </div>
      </div>
    </div>
  );
}
