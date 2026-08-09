"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoField } from "@/components/info-field";
import { FileTextIcon } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE, INVOICE_TYPE_LABEL } from "@/lib/invoice";
import type { InvoiceStatus, InvoiceType } from "@prisma/client";
import {
  issueInvoiceAction,
  reconcileInvoiceAction,
  recordPaymentAction,
  deletePaymentAction,
  voidInvoiceAction,
  deleteInvoiceAction,
  updateInvoiceAction,
} from "../actions";

export type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  type: InvoiceType;
  status: InvoiceStatus;
  selfBilled: boolean;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  currency: string;
  issueDate: string;
  recognitionDate: string | null;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  vatRate: number | null;
  fiscalNumber: string | null;
  fiscalReference: string | null;
  customerReference: string | null;
  poNumber: string | null;
  notes: string | null;
  net: number;
  vat: number;
  gross: number;
  paid: number;
  outstanding: number;
  lines: { id: string; description: string; quantity: number; rate: number; amount: number }[];
  payments: { id: string; amount: number; date: string; method: string | null; reference: string | null }[];
  creditNoteFor: { id: string; invoiceNumber: string } | null;
  creditNotes: { id: string; invoiceNumber: string }[];
};

export function InvoiceDetailClient({ detail }: { detail: InvoiceDetail }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const c = detail.currency;
  const s = detail.status;

  function run(fn: () => Promise<{ error?: string }>, msg: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else {
        toast.success(msg);
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">{detail.invoiceNumber}</h1>
            <Badge variant={INVOICE_STATUS_TONE[s]}>{INVOICE_STATUS_LABEL[s]}</Badge>
            <Badge variant="outline">{INVOICE_TYPE_LABEL[detail.type]}</Badge>
            {detail.selfBilled && <Badge variant="secondary">Self-billed</Badge>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {detail.projectId ? <Link href={`/projects/${detail.projectId}`} className="hover:underline">{detail.projectName}</Link> : detail.clientName}
            {" · "}{detail.clientName}
            {detail.creditNoteFor && <> · adjusts <Link href={`/invoices/${detail.creditNoteFor.id}`} className="text-primary hover:underline">{detail.creditNoteFor.invoiceNumber}</Link></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {s === "DRAFT" && <Button size="sm" onClick={() => run(() => issueInvoiceAction(detail.id), "Issued — revenue recognized.")} disabled={pending}>Issue</Button>}
          {s !== "VOID" && s !== "DRAFT" && <Button size="sm" variant="outline" onClick={() => setReconcileOpen(true)} disabled={pending}>{detail.fiscalNumber ? "Update reconciliation" : "Reconcile"}</Button>}
          {(s === "ISSUED" || s === "RECONCILED") && <Button size="sm" variant="outline" onClick={() => setPayOpen(true)} disabled={pending}>Record payment</Button>}
          {s !== "VOID" && <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} disabled={pending}>Edit</Button>}
          {s !== "VOID" && s !== "DRAFT" && <Button size="sm" variant="ghost" onClick={() => { if (confirm("Void this invoice?")) run(() => voidInvoiceAction(detail.id), "Voided."); }} disabled={pending}>Void</Button>}
          {s === "DRAFT" && <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this draft?")) run(() => deleteInvoiceAction(detail.id), "Deleted.", () => router.push("/invoices")); }} disabled={pending}>Delete</Button>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Net</span><span className="text-xl font-semibold tabular-nums">{formatMoney(detail.net, c)}</span></CardContent></Card>
        <Card><CardContent className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">VAT {detail.vatRate != null ? `(${detail.vatRate}%)` : ""}</span><span className="text-xl font-semibold tabular-nums">{formatMoney(detail.vat, c)}</span></CardContent></Card>
        <Card><CardContent className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Gross</span><span className="text-xl font-semibold tabular-nums">{formatMoney(detail.gross, c)}</span></CardContent></Card>
        <Card><CardContent className="flex flex-col gap-1"><span className="text-sm text-muted-foreground">Outstanding</span><span className="text-xl font-semibold tabular-nums text-primary">{formatMoney(detail.outstanding, c)}</span></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {detail.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.rate, c)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(l.amount, c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {detail.status === "DRAFT" && <p className="mt-2 text-xs text-muted-foreground">To change lines, delete this draft and recreate it.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Reconciliation</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <InfoField icon={FileTextIcon} label="Fiscal #" value={detail.fiscalNumber ?? "—"} />
            <InfoField icon={FileTextIcon} label="Fiscal ref" value={detail.fiscalReference ?? "—"} />
            <InfoField icon={FileTextIcon} label="Customer ref" value={detail.customerReference ?? "—"} />
            <InfoField icon={FileTextIcon} label="PO #" value={detail.poNumber ?? "—"} />
            <InfoField icon={FileTextIcon} label="Issue date" value={detail.issueDate} />
            <InfoField icon={FileTextIcon} label="Recognition" value={detail.recognitionDate ?? detail.issueDate} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Payments</CardTitle>
          <span className="text-sm text-muted-foreground">Paid {formatMoney(detail.paid, c)} of {formatMoney(detail.gross, c)}</span>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {detail.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.date}</TableCell>
                  <TableCell className="text-muted-foreground">{p.method ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.amount, c)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => run(() => deletePaymentAction(p.id), "Payment removed.")} disabled={pending}><XIcon className="size-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {detail.payments.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No payments recorded.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detail.notes && <Card><CardContent className="text-sm"><span className="text-muted-foreground">Notes: </span>{detail.notes}</CardContent></Card>}

      {reconcileOpen && <ReconcileDialog detail={detail} onClose={() => setReconcileOpen(false)} onDone={() => { setReconcileOpen(false); router.refresh(); }} />}
      {payOpen && <PaymentDialog detail={detail} onClose={() => setPayOpen(false)} onDone={() => { setPayOpen(false); router.refresh(); }} />}
      {editOpen && <EditDialog detail={detail} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); router.refresh(); }} />}
    </div>
  );
}

function ReconcileDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [fiscalNumber, setFiscalNumber] = useState(detail.fiscalNumber ?? "");
  const [fiscalReference, setFiscalReference] = useState(detail.fiscalReference ?? "");
  const [customerReference, setCustomerReference] = useState(detail.customerReference ?? "");
  function submit() {
    if (!fiscalNumber.trim()) return toast.error("Enter the fiscal app's invoice number.");
    start(async () => {
      const r = await reconcileInvoiceAction({ invoiceId: detail.id, fiscalNumber: fiscalNumber.trim(), fiscalReference: fiscalReference.trim() || null, customerReference: customerReference.trim() || null });
      if (r.error) toast.error(r.error); else { toast.success("Reconciled."); onDone(); }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Reconcile with fiscal app</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5"><Label htmlFor="r-fn">Fiscal invoice number</Label><Input id="r-fn" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="r-fr">Fiscal reference (optional)</Label><Input id="r-fr" value={fiscalReference} onChange={(e) => setFiscalReference(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="r-cr">Customer ref (credit note / PO)</Label><Input id="r-cr" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} /></div>
        </div>
        <DialogFooter><Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving..." : "Mark reconciled"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(String(detail.outstanding > 0 ? detail.outstanding : ""));
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  function submit() {
    if (!amount || Number(amount) === 0) return toast.error("Enter an amount.");
    start(async () => {
      const r = await recordPaymentAction({ invoiceId: detail.id, amount: Number(amount), date, method: method.trim() || null, reference: reference.trim() || null });
      if (r.error) toast.error(r.error); else { toast.success("Payment recorded."); onDone(); }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="p-amt">Amount</Label><Input id="p-amt" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="p-date">Date</Label><Input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="p-method">Method</Label><Input id="p-method" value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank transfer" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="p-ref">Reference</Label><Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter><Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving..." : "Record"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ detail, onClose, onDone }: { detail: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [issueDate, setIssueDate] = useState(detail.issueDate);
  const [recognitionDate, setRecognitionDate] = useState(detail.recognitionDate ?? "");
  const [dueDate, setDueDate] = useState(detail.dueDate ?? "");
  const [vatRate, setVatRate] = useState(detail.vatRate != null ? String(detail.vatRate) : "");
  const [selfBilled, setSelfBilled] = useState(detail.selfBilled);
  const [fiscalNumber, setFiscalNumber] = useState(detail.fiscalNumber ?? "");
  const [customerReference, setCustomerReference] = useState(detail.customerReference ?? "");
  const [poNumber, setPoNumber] = useState(detail.poNumber ?? "");
  const [notes, setNotes] = useState(detail.notes ?? "");
  function submit() {
    start(async () => {
      const r = await updateInvoiceAction({
        invoiceId: detail.id, issueDate, recognitionDate: recognitionDate || null, dueDate: dueDate || null,
        vatRate: vatRate === "" ? null : Number(vatRate), selfBilled,
        fiscalNumber: fiscalNumber.trim() || null, customerReference: customerReference.trim() || null,
        poNumber: poNumber.trim() || null, notes: notes.trim() || null,
      });
      if (r.error) toast.error(r.error); else { toast.success("Saved."); onDone(); }
    });
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Edit invoice</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-issue">Issue date</Label><Input id="e-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-rec">Recognition</Label><Input id="e-rec" type="date" value={recognitionDate} onChange={(e) => setRecognitionDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-due">Due date</Label><Input id="e-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-vat">VAT %</Label><Input id="e-vat" type="number" step="0.01" value={vatRate} onChange={(e) => setVatRate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-po">PO #</Label><Input id="e-po" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
            <div className="flex items-center gap-2 mt-6"><input id="e-sb" type="checkbox" className="size-4" checked={selfBilled} onChange={(e) => setSelfBilled(e.target.checked)} /><Label htmlFor="e-sb">Self-billed</Label></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-fn">Fiscal #</Label><Input id="e-fn" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-cr">Customer ref</Label><Input id="e-cr" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} /></div>
          </div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="e-notes">Notes</Label><Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving..." : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
