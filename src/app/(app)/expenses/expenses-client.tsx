"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import {
  PlusIcon, PaperclipIcon, DownloadIcon, XIcon, TagIcon, Trash2Icon,
  ReceiptIcon, WalletIcon, ClockIcon, CalendarIcon,
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
import { FxWarning } from "@/components/fx-warning";
import type { ExcludedGroup } from "@/lib/fx";
import { cn } from "@/lib/utils";
import {
  createExpenseAction, decideExpenseAction, deleteExpenseAction,
  createExpenseCategoryAction, deleteExpenseCategoryAction,
} from "./actions";

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ExpensePaidBy = "COMPANY" | "EMPLOYEE";
export type ExpensePaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";

export type ExpenseRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  date: string;
  amount: number;
  /** `amount` converted to the reporting currency at the expense's date; null when no rate exists. */
  baseAmount: number | null;
  currency: string;
  description: string;
  vendor: string | null;
  paymentMethod: ExpensePaymentMethod;
  paidBy: ExpensePaidBy;
  userId: string;
  userName: string;
  submittedById: string;
  submittedByName: string;
  status: ExpenseStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  receipts: { id: string; fileName: string; originalName: string }[];
  canDelete: boolean;
};
export type CategoryOption = { id: string; name: string; expenseCount: number };
export type PersonOption = { id: string; name: string };

const STATUS_TONE: Record<ExpenseStatus, "secondary" | "default" | "destructive"> = {
  PENDING: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
};
const PAYMENT_METHODS: ExpensePaymentMethod[] = ["CASH", "BANK_TRANSFER", "CARD", "OTHER"];
const PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  OTHER: "Other",
};
const PAID_BY_LABEL: Record<ExpensePaidBy, string> = { COMPANY: "Company paid", EMPLOYEE: "Employee paid" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string): string {
  try {
    return format(parseISO(iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

/** Category chip used in the table + dialogs — deterministic tint via InitialsAvatar, matching
 *  the donut palette so categories read as one consistent color system. */
function CategoryChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <InitialsAvatar name={name} className="size-5 text-[9px]" />
      <span className="text-sm">{name}</span>
    </span>
  );
}

function AddExpenseDialog({
  open,
  onOpenChange,
  canManage,
  categories,
  people,
  callerId,
  defaultCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
  categories: CategoryOption[];
  people: PersonOption[];
  callerId: string;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>("CARD");
  const [paidBy, setPaidBy] = useState<ExpensePaidBy>("COMPANY");
  const [userId, setUserId] = useState(callerId);
  const [files, setFiles] = useState<File[]>([]);

  function reset() {
    setCategoryId("");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setAmount("");
    setCurrency(defaultCurrency);
    setDescription("");
    setVendor("");
    setPaymentMethod("CARD");
    setPaidBy("COMPANY");
    setUserId(callerId);
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function submit() {
    if (!categoryId) return toast.error("Pick a category.");
    if (!date) return toast.error("Pick a date.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    if (!description.trim()) return toast.error("Enter a short description.");

    const formData = new FormData();
    formData.set("categoryId", categoryId);
    formData.set("date", date);
    formData.set("amount", amount);
    formData.set("currency", currency);
    formData.set("description", description.trim());
    if (vendor.trim()) formData.set("vendor", vendor.trim());
    formData.set("paymentMethod", paymentMethod);
    formData.set("paidBy", paidBy);
    if (canManage && userId !== callerId) formData.set("userId", userId);
    for (const f of files) formData.append("receipts", f);

    startTransition(async () => {
      const result = await createExpenseAction(formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(canManage ? "Expense recorded and approved." : "Expense submitted — awaiting approval.");
        reset();
        onOpenChange(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pr-1">
          {canManage && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-person">Person</Label>
              <Select
                value={userId}
                items={people.map((p) => ({ value: p.id, label: p.id === callerId ? `${p.name} (me)` : p.name }))}
                onValueChange={(v) => setUserId(v ?? "")}
              >
                <SelectTrigger id="exp-person" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id === callerId ? `${p.name} (me)` : p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-category">Category</Label>
            <Select value={categoryId} items={categories.map((c) => ({ value: c.id, label: c.name }))} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger id="exp-category" className="w-full">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-vendor">Vendor (optional)</Label>
              <Input id="exp-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={200} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-amount">Amount</Label>
              <Input id="exp-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-currency">Currency</Label>
              <Input id="exp-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-description">Description</Label>
            <Textarea id="exp-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-method">Payment method</Label>
              <Select
                value={paymentMethod}
                items={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
                onValueChange={(v) => setPaymentMethod((v as ExpensePaymentMethod) ?? "OTHER")}
              >
                <SelectTrigger id="exp-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-paidby">Paid by</Label>
              <Select
                value={paidBy}
                items={[
                  { value: "COMPANY", label: "Company (e.g. company card)" },
                  { value: "EMPLOYEE", label: "Employee (needs reimbursement)" },
                ]}
                onValueChange={(v) => setPaidBy((v as ExpensePaidBy) ?? "COMPANY")}
              >
                <SelectTrigger id="exp-paidby" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY">Company (e.g. company card)</SelectItem>
                  <SelectItem value="EMPLOYEE">Employee (needs reimbursement)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-receipts">Receipts (optional)</Label>
            <Input
              id="exp-receipts"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 && <p className="text-xs text-muted-foreground">{files.length} file(s) selected.</p>}
          </div>
          <p className="text-xs text-muted-foreground">
            {canManage
              ? "You have expenses:manage — this will be recorded as already approved."
              : "This will need approval from Admin/Finance before it counts as decided."}
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Saving..." : canManage ? "Record & approve" : "Submit expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({
  expense,
  onOpenChange,
  onDecided,
}: {
  expense: ExpenseRow | null;
  onOpenChange: (v: boolean) => void;
  onDecided: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");

  function decide(decision: "APPROVE" | "REJECT") {
    if (!expense) return;
    startTransition(async () => {
      const result = await decideExpenseAction({ expenseId: expense.id, decision, comment: comment || undefined });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(decision === "APPROVE" ? "Approved." : "Rejected.");
        setComment("");
        onDecided();
      }
    });
  }

  return (
    <Dialog open={expense !== null} onOpenChange={(v) => { onOpenChange(v); if (!v) setComment(""); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {expense?.userName}
            {expense && <Badge variant="secondary">{expense.categoryName}</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {expense && formatMoney(expense.amount, expense.currency)} — {expense?.description}
            {expense?.vendor ? ` (${expense.vendor})` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {expense && fmtDate(expense.date)} — {expense && PAID_BY_LABEL[expense.paidBy]} — submitted by {expense?.submittedByName}
          </p>
          {expense && expense.receipts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {expense.receipts.map((r) => (
                <a
                  key={r.id}
                  href={`/api/receipts/${r.fileName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <PaperclipIcon className="size-3" /> {r.originalName}
                </a>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-decide-comment">Comment (optional)</Label>
            <Textarea id="exp-decide-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={500} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button size="sm" variant="destructive" onClick={() => decide("REJECT")} disabled={pending}>
            Reject
          </Button>
          <Button size="sm" onClick={() => decide("APPROVE")} disabled={pending}>
            {pending ? "Saving..." : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Admin/Finance-only inline category management — the old /admin/expense-categories page folded
 *  into a dialog on the Expenses page so categories live next to what they classify. */
function ManageCategoriesDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  function add() {
    const name = newName.trim();
    if (!name) return toast.error("Enter a category name.");
    startTransition(async () => {
      const r = await createExpenseCategoryAction(name);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Category added.");
        setNewName("");
        router.refresh();
      }
    });
  }

  function remove(c: CategoryOption) {
    if (c.expenseCount > 0) return toast.error(`Can't delete — ${c.expenseCount} expense${c.expenseCount === 1 ? "" : "s"} use it.`);
    if (!confirm(`Delete category "${c.name}"?`)) return;
    startTransition(async () => {
      const r = await deleteExpenseCategoryAction(c.id);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Category deleted.");
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TagIcon className="size-4 text-muted-foreground" /> Expense categories</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="New category name"
            maxLength={100}
          />
          <Button size="sm" onClick={add} disabled={pending}><PlusIcon className="size-3.5" /> Add</Button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col divide-y">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2">
              <CategoryChip name={c.name} />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {c.expenseCount > 0 ? `${c.expenseCount} expense${c.expenseCount === 1 ? "" : "s"}` : "unused"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                  onClick={() => remove(c)}
                  disabled={pending || c.expenseCount > 0}
                  title={c.expenseCount > 0 ? "In use — can't delete" : "Delete category"}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          {categories.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No categories yet — add your first above.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">A category in use can&apos;t be deleted until its expenses are moved or removed.</p>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesClient({
  callerId,
  canManage,
  rows,
  categories,
  people,
  defaultCurrency,
  reportingCurrency,
  excluded,
}: {
  callerId: string;
  canManage: boolean;
  rows: ExpenseRow[];
  categories: CategoryOption[];
  people: PersonOption[];
  defaultCurrency: string;
  reportingCurrency: string;
  excluded: ExcludedGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [deciding, setDeciding] = useState<ExpenseRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ExpenseStatus>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const pendingRows = rows.filter((r) => r.status === "PENDING");

  // ---- KPI stats (from ALL rows, not the filtered view, so the headline numbers stay stable) ----
  // Aggregates sum each expense's amount converted to the reporting currency (baseAmount); rows with
  // no exchange rate (baseAmount null) contribute nothing and are surfaced in the FX warning above.
  const base = (r: ExpenseRow) => r.baseAmount ?? 0;
  const approvedRows = rows.filter((r) => r.status === "APPROVED");
  const approvedTotal = approvedRows.reduce((s, r) => s + base(r), 0);
  const pendingAmount = pendingRows.reduce((s, r) => s + base(r), 0);
  const toReimburse = approvedRows.filter((r) => r.paidBy === "EMPLOYEE").reduce((s, r) => s + base(r), 0);
  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthTotal = approvedRows.filter((r) => r.date.startsWith(thisMonthKey)).reduce((s, r) => s + base(r), 0);

  // ---- Category breakdown (approved) → donut. Plain consts: the React Compiler memoizes these;
  //      a manual useMemo keyed on the derived approvedRows array trips its memoization guard. ----
  const categoryByAmount = new Map<string, number>();
  for (const r of approvedRows) categoryByAmount.set(r.categoryName, (categoryByAmount.get(r.categoryName) ?? 0) + base(r));
  const sortedCats = [...categoryByAmount.entries()].sort((a, b) => b[1] - a[1]);
  const categorySegments: DonutSegment[] = sortedCats.slice(0, 6).map(([label, value], i) => ({ label, value, colorClass: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const catRest = sortedCats.slice(6).reduce((s, [, v]) => s + v, 0);
  if (catRest > 0) categorySegments.push({ label: "Other", value: catRest, colorClass: DONUT_COLORS[6 % DONUT_COLORS.length] });

  // ---- Monthly approved spend (last 6 months) → bar ----
  const monthKeys: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] });
  }
  const monthTotals = new Map(monthKeys.map((k) => [k.key, 0]));
  for (const r of approvedRows) {
    const k = r.date.slice(0, 7);
    if (monthTotals.has(k)) monthTotals.set(k, monthTotals.get(k)! + base(r));
  }
  const monthlyBars = monthKeys.map((k) => ({ label: k.label, value: Math.round((monthTotals.get(k.key) ?? 0) * 100) / 100 }));

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (categoryFilter !== "ALL" && r.categoryId !== categoryFilter) return false;
      return true;
    });
  }, [rows, statusFilter, categoryFilter]);

  const filteredTotal = filteredRows.reduce((s, r) => s + base(r), 0);

  function remove(id: string) {
    if (!confirm("Delete this expense?")) return;
    startTransition(async () => {
      const result = await deleteExpenseAction(id);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Deleted.");
        router.refresh();
      }
    });
  }

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (categoryFilter !== "ALL") params.set("categoryId", categoryFilter);
    const qs = params.toString();
    return `/api/expenses/export${qs ? `?${qs}` : ""}`;
  }, [statusFilter, categoryFilter]);

  const hasCharts = approvedRows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Company-wide expense tracking — company-card purchases and reimbursement claims."
              : "Track what you've paid on the company card, or file a reimbursement claim."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setManageOpen(true)}>
              <TagIcon className="size-3.5" /> Categories
            </Button>
          )}
          <a href={exportUrl}>
            <Button size="sm" variant="outline"><DownloadIcon className="size-3.5" /> Export CSV</Button>
          </a>
          <Button size="sm" onClick={() => setAddOpen(true)}><PlusIcon className="size-3.5" /> Add expense</Button>
        </div>
      </div>

      <FxWarning excluded={excluded} noun="expenses" reporting={reportingCurrency} />

      {/* KPI cards — totals in the reporting currency ({reportingCurrency}) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={canManage ? "Approved total" : "Your approved"} value={formatMoney(approvedTotal, reportingCurrency)} icon={ReceiptIcon} sublabel={`${approvedRows.length} expense${approvedRows.length === 1 ? "" : "s"}`} />
        <StatCard label="Pending" value={formatMoney(pendingAmount, reportingCurrency)} icon={ClockIcon} tone={pendingRows.length > 0 ? "warning" : "default"} sublabel={`${pendingRows.length} awaiting${canManage ? " decision" : " approval"}`} />
        <StatCard label="To reimburse" value={formatMoney(toReimburse, reportingCurrency)} icon={WalletIcon} sublabel="employee-paid, approved" />
        <StatCard label="This month" value={formatMoney(thisMonthTotal, reportingCurrency)} icon={CalendarIcon} sublabel={`${MONTHS[now.getMonth()]} ${now.getFullYear()}`} />
      </div>

      {/* Charts */}
      {hasCharts && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle className="text-base">By category</CardTitle></CardHeader>
            <CardContent className="flex justify-center">
              <DonutChart segments={categorySegments} centerLabel={formatMoney(approvedTotal, reportingCurrency)} centerSublabel="approved" size={140} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Approved spend by month</CardTitle>
              <p className="text-xs text-muted-foreground">Last 6 months.</p>
            </CardHeader>
            <CardContent>
              <MiniBarChart data={monthlyBars} height={130} valueFormatter={(v) => formatMoney(v, reportingCurrency)} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pending approval (managers) */}
      {canManage && pendingRows.length > 0 && (
        <Card className="border-amber-300/70">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ClockIcon className="size-4 text-amber-500" /> Pending approval ({pendingRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Paid by</TableHead>
                    <TableHead>Submitted by</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setDeciding(r)}>
                      <TableCell className="font-medium">{r.userName}</TableCell>
                      <TableCell><CategoryChip name={r.categoryName} /></TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.amount, r.currency)}</TableCell>
                      <TableCell className="text-muted-foreground">{PAID_BY_LABEL[r.paidBy]}</TableCell>
                      <TableCell className="text-muted-foreground">{r.submittedByName}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDeciding(r); }}>Decide</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main register */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{canManage ? "All expenses" : "Your expenses"}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={statusFilter} items={[{ value: "ALL", label: "All statuses" }, { value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]} onValueChange={(v) => setStatusFilter((v as typeof statusFilter) ?? "ALL")}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} items={[{ value: "ALL", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} onValueChange={(v) => setCategoryFilter(v ?? "ALL")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {canManage && <TableHead>Person</TableHead>}
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Receipts</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={r.id} className={cn("hover:bg-muted/40", canManage && r.status === "PENDING" && "cursor-pointer")} onClick={() => canManage && r.status === "PENDING" && setDeciding(r)}>
                    {canManage && <TableCell className="font-medium">{r.userName}</TableCell>}
                    <TableCell><CategoryChip name={r.categoryName} /></TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    <TableCell className="max-w-64 truncate" title={r.description}>
                      {r.description}
                      {r.vendor ? <span className="text-muted-foreground"> — {r.vendor}</span> : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatMoney(r.amount, r.currency)}</TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                        r.paidBy === "EMPLOYEE" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                        {r.paidBy === "EMPLOYEE" ? "Employee" : "Company"}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge></TableCell>
                    <TableCell>
                      {r.receipts.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {r.receipts.map((rec) => (
                            <a key={rec.id} href={`/api/receipts/${rec.fileName}`} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80" title={rec.originalName}>
                              <PaperclipIcon className="size-3.5" />
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {r.canDelete && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => remove(r.id)} disabled={pending}>
                          <XIcon className="size-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 9 : 8} className="py-8 text-center text-muted-foreground">
                      {rows.length === 0 ? "No expenses yet — add your first with “Add expense”." : "No expenses match these filters."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {filteredRows.length > 0 && (
            <div className="mt-3 flex justify-end text-sm text-muted-foreground">
              {filteredRows.length} shown · <span className="ml-1 font-medium tabular-nums text-foreground">{formatMoney(filteredTotal, reportingCurrency)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <AddExpenseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        canManage={canManage}
        categories={categories}
        people={people}
        callerId={callerId}
        defaultCurrency={defaultCurrency}
      />
      {canManage && (
        <ManageCategoriesDialog open={manageOpen} onOpenChange={setManageOpen} categories={categories} />
      )}
      <DecisionDialog
        expense={deciding}
        onOpenChange={(v) => !v && setDeciding(null)}
        onDecided={() => {
          setDeciding(null);
          router.refresh();
        }}
      />
    </div>
  );
}
