"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PencilIcon, BanknoteIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TaxPaymentStatus } from "@prisma/client";
import { updateTaxPaymentAction, markTaxPaidAction, deleteTaxPaymentAction } from "../actions";

export type TaxCategoryOpt = { id: string; name: string };
export type TaxEditData = {
  id: string;
  categoryId: string;
  status: TaxPaymentStatus;
  periodStart: string;
  periodEnd: string | null;
  amount: number;
  currency: string;
  serialNumber: string | null;
  authority: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  notes: string | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TaxDetailActions({ data, categories }: { data: TaxEditData; categories: TaxCategoryOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function markPaid() {
    start(async () => {
      const r = await markTaxPaidAction({ id: data.id });
      if (r.error) toast.error(r.error);
      else { toast.success("Marked paid."); router.refresh(); }
    });
  }
  function remove() {
    if (!confirm("Delete this tax record and its attachments? This can't be undone.")) return;
    start(async () => {
      const r = await deleteTaxPaymentAction(data.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.push("/taxes"); }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {data.status === "TO_PAY" && (
        <Button size="sm" onClick={markPaid} disabled={pending}><BanknoteIcon className="size-3.5" /> Mark paid</Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={pending}><PencilIcon className="size-3.5" /> Edit</Button>
      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={remove} disabled={pending}><Trash2Icon className="size-3.5" /> Delete</Button>
      {editOpen && <EditTaxDialog data={data} categories={categories} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); router.refresh(); }} />}
    </div>
  );
}

function EditTaxDialog({ data, categories, onClose, onDone }: { data: TaxEditData; categories: TaxCategoryOpt[]; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [categoryId, setCategoryId] = useState(data.categoryId);
  const [periodStart, setPeriodStart] = useState(data.periodStart);
  const [periodEnd, setPeriodEnd] = useState(data.periodEnd ?? "");
  const [amount, setAmount] = useState(String(data.amount));
  const [currency, setCurrency] = useState(data.currency);
  const [serialNumber, setSerialNumber] = useState(data.serialNumber ?? "");
  const [authority, setAuthority] = useState(data.authority ?? "");
  const [dueDate, setDueDate] = useState(data.dueDate ?? "");
  const [status, setStatus] = useState<TaxPaymentStatus>(data.status);
  const [paymentDate, setPaymentDate] = useState(data.paymentDate ?? "");
  const [notes, setNotes] = useState(data.notes ?? "");

  function save() {
    if (!categoryId) return toast.error("Pick a category.");
    if (!periodStart) return toast.error("Pick the tax period.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    start(async () => {
      const r = await updateTaxPaymentAction({
        id: data.id, categoryId, periodStart, periodEnd: periodEnd || null, amount: Number(amount), currency,
        serialNumber: serialNumber || null, authority: authority || null, dueDate: dueDate || null,
        status, paymentDate: status === "PAID" ? (paymentDate || todayIso()) : null, notes: notes || null,
      });
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); onDone(); }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Edit tax record</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="e-cat">Tax category</Label>
            <Select value={categoryId} items={categories.map((c) => ({ value: c.id, label: c.name }))} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger id="e-cat" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-pstart">Tax period from</Label><Input id="e-pstart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-pend">Period to (optional)</Label><Input id="e-pend" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-amount">Amount</Label><Input id="e-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-currency">Currency</Label><Input id="e-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-serial">Serial / reference #</Label><Input id="e-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={100} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-authority">Paid to (authority)</Label><Input id="e-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-due">Due date</Label><Input id="e-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-status">Status</Label>
              <Select value={status} items={[{ value: "TO_PAY", label: "To pay" }, { value: "PAID", label: "Paid" }]} onValueChange={(v) => setStatus((v as TaxPaymentStatus) ?? "TO_PAY")}>
                <SelectTrigger id="e-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="TO_PAY">To pay</SelectItem><SelectItem value="PAID">Paid</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          {status === "PAID" && (
            <div className="flex flex-col gap-1.5"><Label htmlFor="e-paid">Payment date</Label><Input id="e-paid" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /><span className="text-[11px] text-muted-foreground">Defaults to today if left blank.</span></div>
          )}
          <div className="flex flex-col gap-1.5"><Label htmlFor="e-notes">Notes (optional)</Label><Textarea id="e-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} /></div>
        </div>
        <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
