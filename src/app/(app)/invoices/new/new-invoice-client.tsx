"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { invoiceTotals } from "@/lib/invoice";
import type { ProjectBillingType } from "@prisma/client";
import { createInvoiceAction, createTimeInvoiceAction, setInvoiceCommissionAction } from "../actions";

type MilestoneOpt = { id: string; name: string; salesPrice: number; budgetHours: number | null };
export type ProjectOption = {
  id: string;
  name: string;
  clientName: string;
  billingType: ProjectBillingType;
  contractValue: number;
  milestones: MilestoneOpt[];
};
type LineRow = { description: string; quantity: string; rate: string };
type InvoiceRef = { id: string; invoiceNumber: string; projectId: string | null };

function milestoneValue(m: MilestoneOpt, billingType: ProjectBillingType): number {
  return billingType === "FIXED_PRICE" ? m.salesPrice : m.salesPrice * (m.budgetHours ?? 0);
}

export function NewInvoiceClient({ projects, defaultCurrency, invoices }: { projects: ProjectOption[]; defaultCurrency: string; invoices: InvoiceRef[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<"MANUAL" | "TIME">("MANUAL");
  const [isCreditNote, setIsCreditNote] = useState(false);
  const [selfBilled, setSelfBilled] = useState(false);
  const [creditNoteForId, setCreditNoteForId] = useState("NONE");
  const [issueDate, setIssueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [vatRate, setVatRate] = useState("");
  const [customerReference, setCustomerReference] = useState("");
  const [fiscalNumber, setFiscalNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  // Optional sales-commission discount: a % of the line net and/or a flat amount (they combine).
  const [commissionPercent, setCommissionPercent] = useState("");
  const [commissionFixed, setCommissionFixed] = useState("");
  const [lines, setLines] = useState<LineRow[]>([{ description: "", quantity: "1", rate: "" }]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  const linesNet = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const pct = Number(commissionPercent) || 0;
  const fixedAmt = Number(commissionFixed) || 0;
  const commissionVal = Math.round((linesNet * (pct / 100) + fixedAmt) * 100) / 100;
  const net = linesNet - commissionVal; // the "Sales comision" line reduces net
  const totals = invoiceTotals([{ amount: net }], vatRate === "" ? null : Number(vatRate));

  function setLine(i: number, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { description: "", quantity: "1", rate: "" }]);
  }
  function removeLine(i: number) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i)));
  }
  function prefillFullContract() {
    if (!project) return toast.error("Pick a project first.");
    setLines([{ description: `${project.name} — full contract`, quantity: "1", rate: String(project.contractValue) }]);
  }
  function addMilestone(m: MilestoneOpt) {
    if (!project) return;
    setLines((ls) => {
      const base = ls.length === 1 && !ls[0].description && !ls[0].rate ? [] : ls;
      return [...base, { description: `${project.name} — ${m.name}`, quantity: "1", rate: String(milestoneValue(m, project.billingType)) }];
    });
  }

  function submit() {
    if (!projectId) return toast.error("Pick a project.");
    if (mode === "TIME") {
      if (!periodStart || !periodEnd) return toast.error("Pick the billing period.");
      startTransition(async () => {
        const r = await createTimeInvoiceAction({ projectId, periodStart, periodEnd, vatRate: vatRate === "" ? null : Number(vatRate) });
        if (r.error) { toast.error(r.error); return; }
        if (r.invoiceId) {
          // Apply the optional commission discount to the just-created time invoice.
          if (pct > 0 || fixedAmt > 0) {
            const cr = await setInvoiceCommissionAction({ invoiceId: r.invoiceId, percent: pct || null, fixed: fixedAmt || null });
            if (cr.error) { toast.error(cr.error); return; }
          }
          toast.success("Draft invoice created from time entries.");
          router.push(`/invoices/${r.invoiceId}`);
        }
      });
      return;
    }
    const cleaned = lines.filter((l) => l.description.trim() && l.rate !== "");
    if (cleaned.length === 0) return toast.error("Add at least one line with a description and amount.");
    const finalLines = cleaned.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0, milestoneId: null as string | null }));
    startTransition(async () => {
      const r = await createInvoiceAction({
        projectId,
        type: isCreditNote ? "CREDIT_NOTE" : "INVOICE",
        selfBilled,
        creditNoteForId: isCreditNote && creditNoteForId !== "NONE" ? creditNoteForId : null,
        issueDate,
        vatRate: vatRate === "" ? null : Number(vatRate),
        customerReference: customerReference.trim() || null,
        poNumber: null,
        fiscalNumber: fiscalNumber.trim() || null,
        notes: notes.trim() || null,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        lines: finalLines,
      });
      if (r.error) { toast.error(r.error); return; }
      if (r.invoiceId) {
        // Apply the optional commission discount (% and/or fixed) to the just-created draft.
        if (pct > 0 || fixedAmt > 0) {
          const cr = await setInvoiceCommissionAction({ invoiceId: r.invoiceId, percent: pct || null, fixed: fixedAmt || null });
          if (cr.error) { toast.error(cr.error); return; }
        }
        toast.success(isCreditNote ? "Draft credit note created." : "Draft invoice created.");
        router.push(`/invoices/${r.invoiceId}`);
      }
    });
  }

  const projectInvoices = invoices.filter((i) => i.projectId === projectId);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-project">Project</Label>
          <Select value={projectId} items={projects.map((p) => ({ value: p.id, label: `${p.name} · ${p.clientName}` }))} onValueChange={(v) => setProjectId(v ?? "")}>
            <SelectTrigger id="inv-project" className="w-full"><SelectValue placeholder="Select a project" /></SelectTrigger>
            <SelectContent>
              {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.clientName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-mode">Basis</Label>
          <Select value={mode} items={[{ value: "MANUAL", label: "Amounts / milestones (manual)" }, { value: "TIME", label: "From approved time entries" }]} onValueChange={(v) => setMode((v as "MANUAL" | "TIME") ?? "MANUAL")}>
            <SelectTrigger id="inv-mode" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUAL">Amounts / milestones (manual)</SelectItem>
              <SelectItem value="TIME">From approved time entries</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {mode === "TIME" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-start">Period start</Label>
            <Input id="p-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-end">Period end</Label>
            <Input id="p-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">Pulls approved, billable, un-invoiced time for this project in the period, grouped by milestone.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={isCreditNote} onChange={(e) => setIsCreditNote(e.target.checked)} /> Credit note</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={selfBilled} onChange={(e) => setSelfBilled(e.target.checked)} /> Self-billed (not sent to customer)</label>
            {project && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={prefillFullContract}>Prefill full contract ({formatMoney(project.contractValue, defaultCurrency)})</Button>
              </>
            )}
          </div>
          {isCreditNote && projectInvoices.length > 0 && (
            <div className="flex flex-col gap-1.5 max-w-sm">
              <Label htmlFor="cn-for">Credit note adjusts (optional)</Label>
              <Select value={creditNoteForId} items={[{ value: "NONE", label: "— none —" }, ...projectInvoices.map((i) => ({ value: i.id, label: i.invoiceNumber }))]} onValueChange={(v) => setCreditNoteForId(v ?? "NONE")}>
                <SelectTrigger id="cn-for" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— none —</SelectItem>
                  {projectInvoices.map((i) => <SelectItem key={i.id} value={i.id}>{i.invoiceNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {project && project.milestones.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground self-center">Add milestone line:</span>
              {project.milestones.map((m) => (
                <Button key={m.id} type="button" size="sm" variant="ghost" onClick={() => addMilestone(m)}>
                  + {m.name} ({formatMoney(milestoneValue(m, project.billingType), defaultCurrency)})
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Lines</Label>
            <div className="grid grid-cols-[1fr_80px_110px_96px_32px] gap-2 px-1 text-xs text-muted-foreground">
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Rate</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {lines.map((l, i) => {
              const amt = (Number(l.quantity) || 0) * (Number(l.rate) || 0);
              return (
                <div key={i} className="grid grid-cols-[1fr_80px_110px_96px_32px] gap-2 items-center">
                  <Input placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  <Input className="text-right tabular-nums" type="number" step="0.01" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <Input className="text-right tabular-nums" type="number" step="0.01" placeholder="Rate" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} />
                  <span className="text-right text-sm tabular-nums">{formatMoney(amt, defaultCurrency)}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeLine(i)} aria-label="Remove line"><XIcon className="size-3.5" /></Button>
                </div>
              );
            })}
            <Button type="button" size="sm" variant="outline" className="w-fit" onClick={addLine}><PlusIcon /> Add line</Button>
          </div>
        </>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t pt-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-issue">Issue date</Label>
          <Input id="inv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-vat">VAT %</Label>
          <Input id="inv-vat" type="number" step="0.01" min="0" max="100" value={vatRate} onChange={(e) => setVatRate(e.target.value)} placeholder="e.g. 20" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-cust">Customer ref</Label>
          <Input id="inv-cust" value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} placeholder="PO / credit note #" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-fiscal">Fiscal # (optional)</Label>
          <Input id="inv-fiscal" value={fiscalNumber} onChange={(e) => setFiscalNumber(e.target.value)} />
        </div>
      </div>
      {mode === "MANUAL" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-svcfrom">Service from</Label>
            <Input id="inv-svcfrom" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            <span className="text-[11px] text-muted-foreground">Period the work relates to.</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-svcto">Service to</Label>
            <Input id="inv-svcto" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            <span className="text-[11px] text-muted-foreground">Can span multiple months.</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label>Sales commission <span className="font-normal text-muted-foreground">(optional discount)</span></Label>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Percent of net</span>
            <div className="flex items-center gap-1">
              <Input aria-label="Commission percent" className="w-24" type="number" step="0.01" min="0" max="100" value={commissionPercent} onChange={(e) => setCommissionPercent(e.target.value)} placeholder="0" />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <span className="pb-2 text-xs text-muted-foreground">and / or</span>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Fixed amount</span>
            <Input aria-label="Commission fixed amount" className="w-32" type="number" step="0.01" min="0" value={commissionFixed} onChange={(e) => setCommissionFixed(e.target.value)} placeholder="0.00" />
          </div>
          {commissionVal > 0 && (
            <span className="pb-2 text-sm text-muted-foreground">= <span className="text-destructive tabular-nums">−{formatMoney(commissionVal, defaultCurrency)}</span> &quot;Sales comision&quot; line</span>
          )}
        </div>
      </div>
      {mode === "MANUAL" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-notes">Notes</Label>
          <Textarea id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
        </div>
      )}

      {mode === "MANUAL" && (
        <div className="flex justify-end gap-4 border-t pt-3 text-sm tabular-nums">
          {commissionVal > 0 && (
            <>
              <span className="text-muted-foreground">Subtotal <span className="text-foreground">{formatMoney(linesNet, defaultCurrency)}</span></span>
              <span className="text-muted-foreground">Sales comision <span className="text-destructive">−{formatMoney(commissionVal, defaultCurrency)}</span></span>
            </>
          )}
          <span className="text-muted-foreground">Net <span className="text-foreground">{formatMoney(net, defaultCurrency)}</span></span>
          <span className="text-muted-foreground">VAT <span className="text-foreground">{formatMoney(totals.vat, defaultCurrency)}</span></span>
          <span className="font-medium">Gross {formatMoney(totals.gross, defaultCurrency)}</span>
        </div>
      )}

      <Button onClick={submit} disabled={pending} className="w-fit">
        {pending ? "Creating..." : "Create draft"}
      </Button>
    </div>
  );
}
