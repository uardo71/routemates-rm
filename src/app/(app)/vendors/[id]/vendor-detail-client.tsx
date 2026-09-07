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
import type { VendorPaymentStatus } from "@prisma/client";
import { updateVendorPaymentAction, markVendorPaidAction, deleteVendorPaymentAction } from "../actions";

export type VendorOpt = { id: string; name: string };
export type ProjectOpt = { id: string; name: string; milestones: { id: string; name: string }[] };
export type VendorEditData = {
  id: string;
  vendorId: string;
  projectId: string | null;
  milestoneId: string | null;
  status: VendorPaymentStatus;
  description: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  notes: string | null;
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const NO_PROJECT = "NONE";
const NO_MILESTONE = "__none__";

export function VendorDetailActions({ data, vendors, projects }: { data: VendorEditData; vendors: VendorOpt[]; projects: ProjectOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState(false);

  function markPaid() {
    start(async () => {
      const r = await markVendorPaidAction({ id: data.id });
      if (r.error) toast.error(r.error);
      else { toast.success("Marked paid."); router.refresh(); }
    });
  }
  function remove() {
    if (!confirm("Delete this vendor payment and its attachments? This can't be undone.")) return;
    start(async () => {
      const r = await deleteVendorPaymentAction(data.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Deleted."); router.push("/vendors"); }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {data.status === "TO_PAY" && <Button size="sm" onClick={markPaid} disabled={pending}><BanknoteIcon className="size-3.5" /> Mark paid</Button>}
      <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} disabled={pending}><PencilIcon className="size-3.5" /> Edit</Button>
      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={remove} disabled={pending}><Trash2Icon className="size-3.5" /> Delete</Button>
      {editOpen && <EditVendorDialog data={data} vendors={vendors} projects={projects} onClose={() => setEditOpen(false)} onDone={() => { setEditOpen(false); router.refresh(); }} />}
    </div>
  );
}

function EditVendorDialog({ data, vendors, projects, onClose, onDone }: { data: VendorEditData; vendors: VendorOpt[]; projects: ProjectOpt[]; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [vendorId, setVendorId] = useState(data.vendorId);
  const [projectId, setProjectId] = useState(data.projectId ?? NO_PROJECT);
  const [milestoneId, setMilestoneId] = useState(data.milestoneId ?? NO_MILESTONE);
  const milestoneOptions = projects.find((p) => p.id === projectId)?.milestones ?? [];
  const [description, setDescription] = useState(data.description ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(data.invoiceNumber ?? "");
  const [amount, setAmount] = useState(String(data.amount));
  const [currency, setCurrency] = useState(data.currency);
  const [invoiceDate, setInvoiceDate] = useState(data.invoiceDate ?? "");
  const [dueDate, setDueDate] = useState(data.dueDate ?? "");
  const [status, setStatus] = useState<VendorPaymentStatus>(data.status);
  const [paymentDate, setPaymentDate] = useState(data.paymentDate ?? "");
  const [notes, setNotes] = useState(data.notes ?? "");

  function save() {
    if (!vendorId) return toast.error("Pick a vendor.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    start(async () => {
      const r = await updateVendorPaymentAction({
        id: data.id,
        vendorId,
        projectId: projectId === NO_PROJECT ? null : projectId,
        milestoneId: projectId === NO_PROJECT || milestoneId === NO_MILESTONE ? null : milestoneId,
        status,
        description: description || null, invoiceNumber: invoiceNumber || null, amount: Number(amount), currency,
        invoiceDate: invoiceDate || null, dueDate: dueDate || null,
        paymentDate: status === "PAID" ? (paymentDate || todayIso()) : null, notes: notes || null,
      });
      if (r.error) toast.error(r.error);
      else { toast.success("Saved."); onDone(); }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Edit vendor payment</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-vendor">Vendor</Label>
            <Select value={vendorId} items={vendors.map((v) => ({ value: v.id, label: v.name }))} onValueChange={(v) => setVendorId(v ?? "")}>
              <SelectTrigger id="ev-vendor" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="ev-desc">What is it for?</Label><Input id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="ev-amount">Amount</Label><Input id="ev-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="ev-currency">Currency</Label><Input id="ev-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="ev-invnum">Invoice / reference #</Label><Input id="ev-invnum" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={100} /></div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-project">Project (optional)</Label>
              <Select value={projectId} items={[{ value: NO_PROJECT, label: "— none (overhead) —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onValueChange={(v) => setProjectId(v ?? NO_PROJECT)}>
                <SelectTrigger id="ev-project" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>— none (overhead) —</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vd-milestone">Milestone (optional)</Label>
              <Select
                value={milestoneId}
                items={[{ value: NO_MILESTONE, label: "— whole project —" }, ...milestoneOptions.map((ms) => ({ value: ms.id, label: ms.name }))]}
                onValueChange={(v) => setMilestoneId(v ?? NO_MILESTONE)}
                disabled={milestoneOptions.length === 0}
              >
                <SelectTrigger id="vd-milestone" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MILESTONE}>— whole project —</SelectItem>
                  {milestoneOptions.map((ms) => <SelectItem key={ms.id} value={ms.id}>{ms.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5"><Label htmlFor="ev-invdate">Invoice date</Label><Input id="ev-invdate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="ev-due">Due date</Label><Input id="ev-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-status">Status</Label>
              <Select value={status} items={[{ value: "TO_PAY", label: "To pay" }, { value: "PAID", label: "Paid" }]} onValueChange={(v) => setStatus((v as VendorPaymentStatus) ?? "TO_PAY")}>
                <SelectTrigger id="ev-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="TO_PAY">To pay</SelectItem><SelectItem value="PAID">Paid</SelectItem></SelectContent>
              </Select>
            </div>
            {status === "PAID" && (
              <div className="flex flex-col gap-1.5"><Label htmlFor="ev-paid">Payment date</Label><Input id="ev-paid" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
            )}
          </div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="ev-notes">Notes (optional)</Label><Textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} /></div>
        </div>
        <DialogFooter><Button size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
