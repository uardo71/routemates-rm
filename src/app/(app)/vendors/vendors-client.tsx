"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  PlusIcon, Building2Icon, Trash2Icon, SearchIcon, XIcon, PaperclipIcon,
  WalletIcon, TriangleAlertIcon, CheckCircle2Icon, CalendarIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/stat-card";
import { InitialsAvatar } from "@/components/initials-avatar";
import { DonutChart, DONUT_COLORS, type DonutSegment } from "@/components/charts/donut-chart";
import { MiniBarChart } from "@/components/charts/mini-bar-chart";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { VendorPaymentStatus } from "@prisma/client";
import { createVendorPaymentAction, createVendorAction, deleteVendorAction, markVendorPaidAction } from "./actions";

export type VendorPaymentRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  projectName: string | null;
  status: VendorPaymentStatus;
  description: string | null;
  invoiceNumber: string | null;
  amount: number;
  currency: string;
  invoiceDate: string | null;
  invoiceMonth: string | null; // yyyy-MM
  dueDate: string | null;
  paymentDate: string | null;
  docCount: number;
};
export type VendorOption = { id: string; name: string; count: number };
export type ProjectOption = { id: string; name: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const todayIso = () => new Date().toISOString().slice(0, 10);
const NO_PROJECT = "NONE";

function VendorChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <InitialsAvatar name={name} className="size-5 text-[9px]" />
      <span className="text-sm">{name}</span>
    </span>
  );
}

function isOverdue(r: VendorPaymentRow): boolean {
  return r.status === "TO_PAY" && r.dueDate != null && r.dueDate < todayIso();
}

function StatusPill({ r }: { r: VendorPaymentRow }) {
  if (r.status === "PAID") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2Icon className="size-3" /> Paid</span>;
  }
  if (isOverdue(r)) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive"><TriangleAlertIcon className="size-3" /> Overdue</span>;
  }
  return <Badge variant="secondary">To pay</Badge>;
}

function AddVendorPaymentDialog({
  open, onOpenChange, vendors, projects, defaultCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vendors: VendorOption[];
  projects: ProjectOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [vendorId, setVendorId] = useState("");
  const [projectId, setProjectId] = useState(NO_PROJECT);
  const [description, setDescription] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<VendorPaymentStatus>("TO_PAY");
  const [paymentDate, setPaymentDate] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setVendorId(""); setProjectId(NO_PROJECT); setDescription(""); setInvoiceNumber(""); setAmount("");
    setCurrency(defaultCurrency); setInvoiceDate(""); setDueDate(""); setStatus("TO_PAY"); setPaymentDate(""); setNotes("");
  }

  function submit() {
    if (!vendorId) return toast.error("Pick a vendor.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    start(async () => {
      const r = await createVendorPaymentAction({
        vendorId, projectId: projectId === NO_PROJECT ? null : projectId, status,
        description: description || null, invoiceNumber: invoiceNumber || null, amount: Number(amount), currency,
        invoiceDate: invoiceDate || null, dueDate: dueDate || null,
        paymentDate: status === "PAID" ? (paymentDate || todayIso()) : null, notes: notes || null,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Payment created — attach the invoice & receipt.");
      reset();
      onOpenChange(false);
      if (r.id) router.push(`/vendors/${r.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Log a vendor payment</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-vendor">Vendor</Label>
            <Select value={vendorId} items={vendors.map((v) => ({ value: v.id, label: v.name }))} onValueChange={(v) => setVendorId(v ?? "")}>
              <SelectTrigger id="v-vendor" className="w-full"><SelectValue placeholder="Select a vendor" /></SelectTrigger>
              <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
            </Select>
            {vendors.length === 0 && <p className="text-[11px] text-amber-600">No vendors yet — add one via “Vendors” first.</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-desc">What is it for?</Label>
            <Input id="v-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="e.g. Monthly accounting services" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-amount">Amount</Label>
              <Input id="v-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-currency">Currency</Label>
              <Input id="v-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-invnum">Invoice / reference #</Label>
              <Input id="v-invnum" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} maxLength={100} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-project">Project (optional)</Label>
              <Select value={projectId} items={[{ value: NO_PROJECT, label: "— none (overhead) —" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} onValueChange={(v) => setProjectId(v ?? NO_PROJECT)}>
                <SelectTrigger id="v-project" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROJECT}>— none (overhead) —</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-invdate">Invoice date</Label>
              <Input id="v-invdate" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-due">Due date</Label>
              <Input id="v-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="v-status">Status</Label>
              <Select value={status} items={[{ value: "TO_PAY", label: "To pay" }, { value: "PAID", label: "Paid" }]} onValueChange={(v) => setStatus((v as VendorPaymentStatus) ?? "TO_PAY")}>
                <SelectTrigger id="v-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="TO_PAY">To pay</SelectItem><SelectItem value="PAID">Paid</SelectItem></SelectContent>
              </Select>
            </div>
            {status === "PAID" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="v-paid">Payment date</Label>
                <Input id="v-paid" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="v-notes">Notes (optional)</Label>
            <Textarea id="v-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Create & attach documents"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageVendorsDialog({
  open, onOpenChange, vendors,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vendors: VendorOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");

  function add() {
    const name = newName.trim();
    if (!name) return toast.error("Enter a vendor name.");
    start(async () => {
      const r = await createVendorAction({ name });
      if (r.error) toast.error(r.error);
      else { toast.success("Vendor added."); setNewName(""); router.refresh(); }
    });
  }
  function remove(v: VendorOption) {
    if (v.count > 0) return toast.error(`Can't delete — ${v.count} payment${v.count === 1 ? "" : "s"} use it.`);
    if (!confirm(`Delete vendor "${v.name}"?`)) return;
    start(async () => {
      const r = await deleteVendorAction(v.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Vendor deleted."); router.refresh(); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2Icon className="size-4 text-muted-foreground" /> Vendors</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="e.g. Accountant Ltd" maxLength={150} />
          <Button size="sm" onClick={add} disabled={pending}><PlusIcon className="size-3.5" /> Add</Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col divide-y">
          {vendors.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 py-2">
              <VendorChip name={v.name} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{v.count > 0 ? `${v.count} payment${v.count === 1 ? "" : "s"}` : "unused"}</span>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={() => remove(v)} disabled={pending || v.count > 0} title={v.count > 0 ? "In use — can't delete" : "Delete vendor"}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {vendors.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No vendors yet — add your first above.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VendorsClient({
  rows, vendors, projects, defaultCurrency,
}: {
  rows: VendorPaymentRow[];
  vendors: VendorOption[];
  projects: ProjectOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [q, setQ] = useState("");
  const [vendorFilter, setVendorFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | VendorPaymentStatus>("ALL");
  const [month, setMonth] = useState("");

  const now = new Date();
  const thisYear = String(now.getFullYear());
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const toPayRows = rows.filter((r) => r.status === "TO_PAY");
  const outstanding = toPayRows.reduce((s, r) => s + r.amount, 0);
  const overdueRows = toPayRows.filter(isOverdue);
  const overdue = overdueRows.reduce((s, r) => s + r.amount, 0);
  const paidYear = rows.filter((r) => r.status === "PAID" && (r.paymentDate ?? "").startsWith(thisYear)).reduce((s, r) => s + r.amount, 0);
  const paidThisMonth = rows.filter((r) => r.status === "PAID" && (r.paymentDate ?? "").startsWith(thisMonthKey)).reduce((s, r) => s + r.amount, 0);

  // By vendor donut
  const byVendor = new Map<string, number>();
  for (const r of rows) byVendor.set(r.vendorName, (byVendor.get(r.vendorName) ?? 0) + r.amount);
  const sortedVendors = [...byVendor.entries()].sort((a, b) => b[1] - a[1]);
  const vendorSegments: DonutSegment[] = sortedVendors.slice(0, 6).map(([label, value], i) => ({ label, value, colorClass: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const vendorRest = sortedVendors.slice(6).reduce((s, [, v]) => s + v, 0);
  if (vendorRest > 0) vendorSegments.push({ label: "Other", value: vendorRest, colorClass: DONUT_COLORS[6 % DONUT_COLORS.length] });
  const totalAll = rows.reduce((s, r) => s + r.amount, 0);

  // By month (invoice date)
  const monthKeys: { key: string; label: string }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] });
  }
  const monthTotals = new Map(monthKeys.map((k) => [k.key, 0]));
  for (const r of rows) if (r.invoiceMonth && monthTotals.has(r.invoiceMonth)) monthTotals.set(r.invoiceMonth, monthTotals.get(r.invoiceMonth)! + r.amount);
  const monthlyBars = monthKeys.map((k) => ({ label: k.label, value: Math.round((monthTotals.get(k.key) ?? 0) * 100) / 100 }));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (vendorFilter !== "ALL" && r.vendorId !== vendorFilter) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (month && r.invoiceMonth !== month) return false;
      if (needle) {
        const hay = [r.vendorName, r.description ?? "", r.invoiceNumber ?? "", r.projectName ?? "", String(r.amount)].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, vendorFilter, statusFilter, month]);

  const filteredTotal = filtered.reduce((s, r) => s + r.amount, 0);
  const active = q.trim() !== "" || vendorFilter !== "ALL" || statusFilter !== "ALL" || month !== "";
  const hasCharts = rows.length > 0;

  function markPaid(id: string) {
    start(async () => {
      const r = await markVendorPaidAction({ id });
      if (r.error) toast.error(r.error);
      else { toast.success("Marked paid."); router.refresh(); }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vendor payments</h1>
          <p className="text-sm text-muted-foreground">Track supplier bills and payments — invoices, receipts, what you owe and what you&apos;ve paid.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}><Building2Icon className="size-3.5" /> Vendors</Button>
          <Button size="sm" onClick={() => setAddOpen(true)}><PlusIcon className="size-3.5" /> Log a payment</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Outstanding" value={formatMoney(outstanding, defaultCurrency)} icon={WalletIcon} tone={outstanding > 0 ? "warning" : "default"} sublabel={`${toPayRows.length} to pay`} />
        <StatCard label="Overdue" value={formatMoney(overdue, defaultCurrency)} icon={TriangleAlertIcon} tone={overdue > 0 ? "destructive" : "default"} sublabel={`${overdueRows.length} past due`} />
        <StatCard label="Paid this year" value={formatMoney(paidYear, defaultCurrency)} icon={CheckCircle2Icon} sublabel={thisYear} />
        <StatCard label="Paid this month" value={formatMoney(paidThisMonth, defaultCurrency)} icon={CalendarIcon} sublabel={`${MONTHS[now.getMonth()]} ${now.getFullYear()}`} />
      </div>

      {hasCharts && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle className="text-base">By vendor</CardTitle></CardHeader>
            <CardContent className="flex justify-center">
              <DonutChart segments={vendorSegments} centerLabel={formatMoney(totalAll, defaultCurrency)} centerSublabel="total" size={140} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">By month</CardTitle>
              <p className="text-xs text-muted-foreground">Amount by invoice date — last 8 months.</p>
            </CardHeader>
            <CardContent><MiniBarChart data={monthlyBars} height={130} valueFormatter={(v) => formatMoney(v, defaultCurrency)} /></CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-52">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, invoice #, description…" className="pl-8" />
            </div>
            <Select value={vendorFilter} items={[{ value: "ALL", label: "All vendors" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]} onValueChange={(v) => setVendorFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All vendors</SelectItem>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} items={[{ value: "ALL", label: "All statuses" }, { value: "TO_PAY", label: "To pay" }, { value: "PAID", label: "Paid" }]} onValueChange={(v) => setStatusFilter((v as typeof statusFilter) ?? "ALL")}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="TO_PAY">To pay</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
              </SelectContent>
            </Select>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" title="Invoice month" />
            {active && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setVendorFilter("ALL"); setStatusFilter("ALL"); setMonth(""); }}><XIcon className="size-3.5 mr-1" /> Clear</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Invoice date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/vendors/${r.id}`)}>
                    <TableCell><VendorChip name={r.vendorName} /></TableCell>
                    <TableCell className="max-w-56 truncate" title={r.description ?? undefined}>
                      {r.description ?? <span className="text-muted-foreground">—</span>}
                      {r.projectName && <span className="ml-1 text-[11px] text-muted-foreground">· {r.projectName}</span>}
                    </TableCell>
                    <TableCell><StatusPill r={r} /></TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.amount, r.currency)}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{r.invoiceDate ?? "—"}</TableCell>
                    <TableCell className={cn("whitespace-nowrap", isOverdue(r) ? "text-destructive" : "text-muted-foreground")}>{r.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{r.paymentDate ?? "—"}</TableCell>
                    <TableCell>
                      {r.docCount > 0 ? <span className="inline-flex items-center gap-1 text-muted-foreground"><PaperclipIcon className="size-3.5" />{r.docCount}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {r.status === "TO_PAY" ? (
                        <Button size="sm" variant="outline" onClick={() => markPaid(r.id)} disabled={pending}>Mark paid</Button>
                      ) : (
                        <Link href={`/vendors/${r.id}`} className="text-sm text-primary hover:underline">Open</Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      {rows.length === 0 ? "No vendor payments yet — start with “Log a payment”." : "No payments match these filters."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filtered.length > 0 && (
            <div className="mt-3 flex justify-end text-sm text-muted-foreground">
              {filtered.length} shown · <span className="ml-1 font-medium tabular-nums text-foreground">{formatMoney(filteredTotal, defaultCurrency)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <AddVendorPaymentDialog open={addOpen} onOpenChange={setAddOpen} vendors={vendors} projects={projects} defaultCurrency={defaultCurrency} />
      <ManageVendorsDialog open={manageOpen} onOpenChange={setManageOpen} vendors={vendors} />
    </div>
  );
}
