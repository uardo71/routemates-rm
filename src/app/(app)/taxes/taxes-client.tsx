"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  PlusIcon, TagIcon, Trash2Icon, SearchIcon, XIcon, PaperclipIcon,
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
import type { TaxPaymentStatus } from "@prisma/client";
import { createTaxPaymentAction, createTaxCategoryAction, deleteTaxCategoryAction, markTaxPaidAction } from "./actions";

export type TaxRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  status: TaxPaymentStatus;
  periodStart: string;
  periodEnd: string | null;
  periodLabel: string;
  periodMonth: string; // yyyy-MM
  amount: number;
  currency: string;
  serialNumber: string | null;
  authority: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  docCount: number;
};
export type TaxCategoryOption = { id: string; name: string; count: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const todayIso = () => new Date().toISOString().slice(0, 10);

function CategoryChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <InitialsAvatar name={name} className="size-5 text-[9px]" />
      <span className="text-sm">{name}</span>
    </span>
  );
}

function isOverdue(r: TaxRow): boolean {
  return r.status === "TO_PAY" && r.dueDate != null && r.dueDate < todayIso();
}

function StatusPill({ r }: { r: TaxRow }) {
  if (r.status === "PAID") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2Icon className="size-3" /> Paid
      </span>
    );
  }
  if (isOverdue(r)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
        <TriangleAlertIcon className="size-3" /> Overdue
      </span>
    );
  }
  return <Badge variant="secondary">To pay</Badge>;
}

function AddTaxDialog({
  open,
  onOpenChange,
  categories,
  defaultCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: TaxCategoryOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [categoryId, setCategoryId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [serialNumber, setSerialNumber] = useState("");
  const [authority, setAuthority] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<TaxPaymentStatus>("TO_PAY");
  const [paymentDate, setPaymentDate] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setCategoryId(""); setPeriodStart(""); setPeriodEnd(""); setAmount(""); setCurrency(defaultCurrency);
    setSerialNumber(""); setAuthority(""); setDueDate(""); setStatus("TO_PAY"); setPaymentDate(""); setNotes("");
  }

  function submit() {
    if (!categoryId) return toast.error("Pick a category.");
    if (!periodStart) return toast.error("Pick the tax period.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    start(async () => {
      const r = await createTaxPaymentAction({
        categoryId, periodStart, periodEnd: periodEnd || null, amount: Number(amount), currency,
        serialNumber: serialNumber || null, authority: authority || null, dueDate: dueDate || null,
        status, paymentDate: status === "PAID" ? (paymentDate || todayIso()) : null, notes: notes || null,
      });
      if (r.error) { toast.error(r.error); return; }
      toast.success("Tax record created — attach the notice & receipt.");
      reset();
      onOpenChange(false);
      if (r.id) router.push(`/taxes/${r.id}`); // land on detail to attach documents
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle>Log a tax</DialogTitle></DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tax-cat">Tax category</Label>
            <Select value={categoryId} items={categories.map((c) => ({ value: c.id, label: c.name }))} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger id="tax-cat" className="w-full"><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {categories.length === 0 && <p className="text-[11px] text-amber-600">No categories yet — add one via “Categories” first.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-pstart">Tax period from</Label>
              <Input id="tax-pstart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-pend">Period to (optional)</Label>
              <Input id="tax-pend" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>
          <p className="-mt-1 text-[11px] text-muted-foreground">Which period the tax covers. Leave “to” blank for a single month.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-amount">Amount</Label>
              <Input id="tax-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-currency">Currency</Label>
              <Input id="tax-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-serial">Serial / reference #</Label>
              <Input id="tax-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} maxLength={100} placeholder="From the notice" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-authority">Paid to (authority)</Label>
              <Input id="tax-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} maxLength={200} placeholder="Municipality, tax office…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-due">Due date</Label>
              <Input id="tax-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-status">Status</Label>
              <Select value={status} items={[{ value: "TO_PAY", label: "To pay" }, { value: "PAID", label: "Paid" }]} onValueChange={(v) => setStatus((v as TaxPaymentStatus) ?? "TO_PAY")}>
                <SelectTrigger id="tax-status" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TO_PAY">To pay</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {status === "PAID" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tax-paid">Payment date</Label>
              <Input id="tax-paid" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} placeholder={todayIso()} />
              <span className="text-[11px] text-muted-foreground">Defaults to today if left blank.</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tax-notes">Notes (optional)</Label>
            <Textarea id="tax-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Create & attach documents"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageCategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: TaxCategoryOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");

  function add() {
    const name = newName.trim();
    if (!name) return toast.error("Enter a category name.");
    start(async () => {
      const r = await createTaxCategoryAction(name);
      if (r.error) toast.error(r.error);
      else { toast.success("Category added."); setNewName(""); router.refresh(); }
    });
  }
  function remove(c: TaxCategoryOption) {
    if (c.count > 0) return toast.error(`Can't delete — ${c.count} record${c.count === 1 ? "" : "s"} use it.`);
    if (!confirm(`Delete category "${c.name}"?`)) return;
    start(async () => {
      const r = await deleteTaxCategoryAction(c.id);
      if (r.error) toast.error(r.error);
      else { toast.success("Category deleted."); router.refresh(); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><TagIcon className="size-4 text-muted-foreground" /> Tax categories</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="e.g. Advance sales tax" maxLength={100} />
          <Button size="sm" onClick={add} disabled={pending}><PlusIcon className="size-3.5" /> Add</Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col divide-y">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2">
              <CategoryChip name={c.name} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">{c.count > 0 ? `${c.count} record${c.count === 1 ? "" : "s"}` : "unused"}</span>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={() => remove(c)} disabled={pending || c.count > 0} title={c.count > 0 ? "In use — can't delete" : "Delete category"}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {categories.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No categories yet — add your first above.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaxesClient({
  rows,
  categories,
  defaultCurrency,
}: {
  rows: TaxRow[];
  categories: TaxCategoryOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TaxPaymentStatus>("ALL");
  const [month, setMonth] = useState(""); // yyyy-MM on the tax period

  const now = new Date();
  const thisYear = String(now.getFullYear());
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ---- KPIs ----
  const toPayRows = rows.filter((r) => r.status === "TO_PAY");
  const outstanding = toPayRows.reduce((s, r) => s + r.amount, 0);
  const overdueRows = toPayRows.filter(isOverdue);
  const overdue = overdueRows.reduce((s, r) => s + r.amount, 0);
  const paidYear = rows.filter((r) => r.status === "PAID" && (r.paymentDate ?? "").startsWith(thisYear)).reduce((s, r) => s + r.amount, 0);
  const paidThisMonth = rows.filter((r) => r.status === "PAID" && (r.paymentDate ?? "").startsWith(thisMonthKey)).reduce((s, r) => s + r.amount, 0);

  // ---- Charts (plain values; React Compiler memoizes) ----
  const byCat = new Map<string, number>();
  for (const r of rows) byCat.set(r.categoryName, (byCat.get(r.categoryName) ?? 0) + r.amount);
  const sortedCats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const categorySegments: DonutSegment[] = sortedCats.slice(0, 6).map(([label, value], i) => ({ label, value, colorClass: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const catRest = sortedCats.slice(6).reduce((s, [, v]) => s + v, 0);
  if (catRest > 0) categorySegments.push({ label: "Other", value: catRest, colorClass: DONUT_COLORS[6 % DONUT_COLORS.length] });
  const totalAll = rows.reduce((s, r) => s + r.amount, 0);

  const monthKeys: { key: string; label: string }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] });
  }
  const monthTotals = new Map(monthKeys.map((k) => [k.key, 0]));
  for (const r of rows) if (monthTotals.has(r.periodMonth)) monthTotals.set(r.periodMonth, monthTotals.get(r.periodMonth)! + r.amount);
  const monthlyBars = monthKeys.map((k) => ({ label: k.label, value: Math.round((monthTotals.get(k.key) ?? 0) * 100) / 100 }));

  // ---- Filtered table ----
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (categoryFilter !== "ALL" && r.categoryId !== categoryFilter) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (month && r.periodMonth !== month) return false;
      if (needle) {
        const hay = [r.categoryName, r.serialNumber ?? "", r.authority ?? "", r.periodLabel, String(r.amount)].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, categoryFilter, statusFilter, month]);

  const filteredTotal = filtered.reduce((s, r) => s + r.amount, 0);
  const active = q.trim() !== "" || categoryFilter !== "ALL" || statusFilter !== "ALL" || month !== "";
  const hasCharts = rows.length > 0;

  function markPaid(id: string) {
    start(async () => {
      const r = await markTaxPaidAction({ id });
      if (r.error) toast.error(r.error);
      else { toast.success("Marked paid."); router.refresh(); }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Taxes</h1>
          <p className="text-sm text-muted-foreground">Track tax obligations and payments — notices, receipts, serial numbers, all in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}><TagIcon className="size-3.5" /> Categories</Button>
          <Button size="sm" onClick={() => setAddOpen(true)}><PlusIcon className="size-3.5" /> Log a tax</Button>
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
            <CardHeader><CardTitle className="text-base">By category</CardTitle></CardHeader>
            <CardContent className="flex justify-center">
              <DonutChart segments={categorySegments} centerLabel={formatMoney(totalAll, defaultCurrency)} centerSublabel="total" size={140} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">By tax period</CardTitle>
              <p className="text-xs text-muted-foreground">Amount by the month the tax covers — last 8 months.</p>
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
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial #, authority, amount…" className="pl-8" />
            </div>
            <Select value={categoryFilter} items={[{ value: "ALL", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} onValueChange={(v) => setCategoryFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" title="Tax period month" />
            {active && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setCategoryFilter("ALL"); setStatusFilter("ALL"); setMonth(""); }}><XIcon className="size-3.5 mr-1" /> Clear</Button>}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Tax period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Serial #</TableHead>
                  <TableHead>Docs</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/taxes/${r.id}`)}>
                    <TableCell><CategoryChip name={r.categoryName} /></TableCell>
                    <TableCell className="whitespace-nowrap">{r.periodLabel}</TableCell>
                    <TableCell><StatusPill r={r} /></TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.amount, r.currency)}</TableCell>
                    <TableCell className={cn("whitespace-nowrap", isOverdue(r) ? "text-destructive" : "text-muted-foreground")}>{r.dueDate ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{r.paymentDate ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{r.serialNumber ?? "—"}</TableCell>
                    <TableCell>
                      {r.docCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><PaperclipIcon className="size-3.5" />{r.docCount}</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {r.status === "TO_PAY" ? (
                        <Button size="sm" variant="outline" onClick={() => markPaid(r.id)} disabled={pending}>Mark paid</Button>
                      ) : (
                        <Link href={`/taxes/${r.id}`} className="text-sm text-primary hover:underline">Open</Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      {rows.length === 0 ? "No tax records yet — start with “Log a tax”." : "No records match these filters."}
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

      <AddTaxDialog open={addOpen} onOpenChange={setAddOpen} categories={categories} defaultCurrency={defaultCurrency} />
      <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} categories={categories} />
    </div>
  );
}
