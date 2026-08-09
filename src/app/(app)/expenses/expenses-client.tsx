"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import { PlusIcon, PaperclipIcon, DownloadIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createExpenseAction, decideExpenseAction, deleteExpenseAction } from "./actions";

export type ExpenseStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ExpensePaidBy = "COMPANY" | "EMPLOYEE";
export type ExpensePaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";

export type ExpenseRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  date: string;
  amount: number;
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
export type CategoryOption = { id: string; name: string };
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
            {expense && expense.date} — {expense && PAID_BY_LABEL[expense.paidBy]} — submitted by {expense?.submittedByName}
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

export function ExpensesClient({
  callerId,
  canManage,
  rows,
  categories,
  people,
  defaultCurrency,
}: {
  callerId: string;
  canManage: boolean;
  rows: ExpenseRow[];
  categories: CategoryOption[];
  people: PersonOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [deciding, setDeciding] = useState<ExpenseRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ExpenseStatus>("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  const pendingRows = rows.filter((r) => r.status === "PENDING");

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (categoryFilter !== "ALL" && r.categoryId !== categoryFilter) return false;
      return true;
    });
  }, [rows, statusFilter, categoryFilter]);

  const totalApproved = filteredRows.filter((r) => r.status === "APPROVED").reduce((sum, r) => sum + r.amount, 0);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} items={[{ value: "ALL", label: "All statuses" }, { value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]} onValueChange={(v) => setStatusFilter((v as typeof statusFilter) ?? "ALL")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} items={[{ value: "ALL", label: "All categories" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} onValueChange={(v) => setCategoryFilter(v ?? "ALL")}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportUrl}>
            <Button size="sm" variant="outline">
              <DownloadIcon /> Export CSV
            </Button>
          </a>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon /> Add expense
          </Button>
        </div>
      </div>

      {canManage && pendingRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending approval ({pendingRows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Paid by</TableHead>
                  <TableHead>Submitted by</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setDeciding(r)}>
                    <TableCell className="font-medium">{r.userName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.categoryName}</Badge>
                    </TableCell>
                    <TableCell>{r.date}</TableCell>
                    <TableCell className="tabular-nums">{formatMoney(r.amount, r.currency)}</TableCell>
                    <TableCell>{PAID_BY_LABEL[r.paidBy]}</TableCell>
                    <TableCell>{r.submittedByName}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setDeciding(r); }}>
                        Decide
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{canManage ? "All expenses" : "Your expenses"}</CardTitle>
          <span className="text-sm text-muted-foreground">
            Approved total: <span className="font-medium tabular-nums text-foreground">{formatMoney(totalApproved, defaultCurrency)}</span>
          </span>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {canManage && <TableHead>Person</TableHead>}
                <TableHead>Category</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Receipts</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((r) => (
                <TableRow key={r.id} className={cn(canManage && r.status === "PENDING" && "cursor-pointer")} onClick={() => canManage && r.status === "PENDING" && setDeciding(r)}>
                  {canManage && <TableCell className="font-medium">{r.userName}</TableCell>}
                  <TableCell>
                    <Badge variant="secondary">{r.categoryName}</Badge>
                  </TableCell>
                  <TableCell>{r.date}</TableCell>
                  <TableCell className="max-w-64 truncate" title={r.description}>
                    {r.description}
                    {r.vendor ? <span className="text-muted-foreground"> — {r.vendor}</span> : ""}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMoney(r.amount, r.currency)}</TableCell>
                  <TableCell className="text-muted-foreground">{PAID_BY_LABEL[r.paidBy]}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.receipts.length > 0 ? (
                      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        {r.receipts.map((rec) => (
                          <a
                            key={rec.id}
                            href={`/api/receipts/${rec.fileName}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                            title={rec.originalName}
                          >
                            <PaperclipIcon className="size-3" />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.canDelete && (
                      <Button size="sm" variant="ghost" onClick={() => remove(r.id)} disabled={pending}>
                        <XIcon className="size-3.5" /> Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 9 : 8} className="text-center text-muted-foreground">
                    No expenses match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
