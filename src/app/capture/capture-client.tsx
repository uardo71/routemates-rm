"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CameraIcon,
  Loader2Icon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RoutematesLogo } from "@/components/routemates-logo";
import { cn } from "@/lib/utils";
import { confirmCapturedExpenseAction, discardCapturedExpenseAction } from "./actions";

type Category = { id: string; name: string };
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER";
type PaidBy = "COMPANY" | "EMPLOYEE";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];
const PAID_BY: { value: PaidBy; label: string }[] = [
  { value: "COMPANY", label: "Company (e.g. company card)" },
  { value: "EMPLOYEE", label: "Employee (needs reimbursement)" },
];

const LOW_CONFIDENCE = 0.7;

type CaptureResponse = {
  draftId: string;
  ocrConfigured: boolean;
  ocrError: string | null;
  fields: {
    categoryId: string;
    date: string;
    amount: number;
    currency: string;
    description: string;
    vendor: string;
    paymentMethod: PaymentMethod;
    paidBy: PaidBy;
  };
  capture: {
    confidences?: { vendor?: number; date?: number; total?: number; currency?: number };
    items?: { description?: string; quantity?: number; totalPrice?: number }[];
  } | null;
};

// Downscale to <= maxDim on the longest side and re-encode as JPEG. Falls back to the original file
// if the browser can't decode it (e.g. some HEIC cases).
async function compressImage(file: File, maxDim = 2000, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("compress failed"))), "image/jpeg", quality)
  );
}

export function CaptureClient({
  categories,
  defaultCurrency,
  canManage,
  ocrConfigured,
}: {
  categories: Category[];
  defaultCurrency: string;
  canManage: boolean;
  ocrConfigured: boolean;
}) {
  const [stage, setStage] = useState<"idle" | "processing" | "review" | "saved">("idle");
  const [statusText, setStatusText] = useState("");
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [capture, setCapture] = useState<CaptureResponse["capture"]>(null);

  // Confirm form fields
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");
  const [vendor, setVendor] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CARD");
  const [paidBy, setPaidBy] = useState<PaidBy>("COMPANY");

  function resetToIdle() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setDraftId("");
    setCapture(null);
    setCategoryId("");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setAmount("");
    setCurrency(defaultCurrency);
    setDescription("");
    setVendor("");
    setPaymentMethod("CARD");
    setPaidBy("COMPANY");
    if (fileRef.current) fileRef.current.value = "";
    setStage("idle");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("processing");

    try {
      setStatusText("Optimizing photo…");
      let blob: Blob = file;
      try {
        blob = await compressImage(file);
      } catch {
        blob = file; // upload the original if we can't decode/re-encode it
      }
      const upload = new File([blob], "receipt.jpg", { type: blob.type || "image/jpeg" });

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));

      setStatusText(ocrConfigured ? "Reading your receipt…" : "Saving…");
      const fd = new FormData();
      fd.append("receipt", upload);
      const res = await fetch("/api/capture", { method: "POST", body: fd });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Upload failed (${res.status}).`);
      }
      const data = (await res.json()) as CaptureResponse;

      setDraftId(data.draftId);
      setCapture(data.capture);
      setCategoryId(data.fields.categoryId);
      setDate(data.fields.date);
      setAmount(data.fields.amount > 0 ? String(data.fields.amount) : "");
      setCurrency(data.fields.currency);
      setDescription(data.fields.description === "Captured receipt" ? "" : data.fields.description);
      setVendor(data.fields.vendor);
      setPaymentMethod(data.fields.paymentMethod);
      setPaidBy(data.fields.paidBy);
      setStage("review");

      if (data.ocrError) toast.error("Couldn't auto-read the receipt — please fill it in.");
      else if (!data.ocrConfigured) toast.info("Receipt saved — enter the details below.");
    } catch (err) {
      toast.error((err as Error).message);
      resetToIdle();
    }
  }

  function save() {
    if (!categoryId) return toast.error("Pick a category.");
    if (!amount || Number(amount) <= 0) return toast.error("Enter an amount greater than 0.");
    if (!description.trim()) return toast.error("Enter a short description.");

    startTransition(async () => {
      const result = await confirmCapturedExpenseAction({
        draftId,
        categoryId,
        date,
        amount: Number(amount),
        currency,
        description: description.trim(),
        vendor: vendor.trim() || undefined,
        paymentMethod,
        paidBy,
      });
      if (result.error) toast.error(result.error);
      else {
        toast.success(canManage ? "Expense recorded and approved." : "Expense submitted for approval.");
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
        setStage("saved");
      }
    });
  }

  function discard() {
    if (!confirm("Discard this captured receipt?")) return;
    startTransition(async () => {
      const result = await discardCapturedExpenseAction(draftId);
      if (result.error) toast.error(result.error);
      else {
        toast.success("Discarded.");
        resetToIdle();
      }
    });
  }

  const conf = capture?.confidences;
  const lowConf = (v?: number) => typeof v === "number" && v < LOW_CONFIDENCE;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <RoutematesLogo variant="color" className="h-7 dark:hidden" />
        <RoutematesLogo variant="negative" className="hidden h-7 dark:block" />
        <span className="text-xs font-medium text-muted-foreground">Receipt capture</span>
      </header>

      {stage === "idle" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ReceiptTextIcon className="size-9" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Capture a receipt</h1>
            <p className="text-sm text-muted-foreground">
              Snap a photo — {ocrConfigured ? "we'll read the details for you to confirm." : "then fill in the details."}
            </p>
          </div>
          <label className="w-full">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={onFile}
            />
            <span className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-foreground text-base font-medium text-background transition-colors hover:bg-foreground/90">
              <CameraIcon className="size-5" /> Capture Receipt
            </span>
          </label>
          <a href="/expenses" className="text-sm text-muted-foreground hover:underline">
            View all expenses
          </a>
        </div>
      )}

      {stage === "processing" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <Loader2Icon className="size-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{statusText}</p>
        </div>
      )}

      {stage === "review" && (
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
            Review &amp; confirm
          </div>

          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- local objectURL preview, not a remote asset
            <img src={previewUrl} alt="Captured receipt" className="max-h-48 w-full rounded-lg object-contain ring-1 ring-foreground/10" />
          )}

          <Field label="Category">
            <Select value={categoryId} items={categories.map((c) => ({ value: c.id, label: c.name }))} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-full">
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
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor" flag={lowConf(conf?.vendor)}>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Date" flag={lowConf(conf?.date)}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" flag={lowConf(conf?.total)}>
              <Input type="number" inputMode="decimal" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Currency" flag={lowConf(conf?.currency)}>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={10} />
            </Field>
          </div>

          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="What was this for?" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <Select value={paymentMethod} items={PAYMENT_METHODS} onValueChange={(v) => setPaymentMethod((v as PaymentMethod) ?? "OTHER")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Paid by">
              <Select value={paidBy} items={PAID_BY} onValueChange={(v) => setPaidBy((v as PaidBy) ?? "COMPANY")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAID_BY.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {capture?.items && capture.items.length > 0 && (
            <details className="rounded-lg border px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium">Line items ({capture.items.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                {capture.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate">
                      {it.quantity ? `${it.quantity}× ` : ""}
                      {it.description ?? "Item"}
                    </span>
                    {typeof it.totalPrice === "number" && <span className="tabular-nums">{it.totalPrice.toFixed(2)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-auto flex flex-col gap-2 pt-2">
            <Button onClick={save} disabled={pending} className="h-12 text-base">
              {pending ? "Saving…" : canManage ? "Save & approve" : "Submit expense"}
            </Button>
            <Button variant="ghost" onClick={discard} disabled={pending} className="text-muted-foreground">
              Discard
            </Button>
          </div>
        </div>
      )}

      {stage === "saved" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2Icon className="size-9" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Saved</h1>
            <p className="text-sm text-muted-foreground">
              {canManage ? "Recorded and approved." : "Submitted — awaiting approval."}
            </p>
          </div>
          <Button onClick={resetToIdle} className="h-12 w-full text-base">
            <RotateCcwIcon className="size-5" /> Capture another
          </Button>
          <a href="/expenses" className="text-sm text-muted-foreground hover:underline">
            View all expenses
          </a>
        </div>
      )}

      {stage === "idle" && !ocrConfigured && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <AlertTriangleIcon className="size-3.5" /> Auto-read is off — set the Azure keys to enable it.
        </p>
      )}
    </div>
  );
}

function Field({ label, flag, children }: { label: string; flag?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className={cn("flex items-center gap-1.5", flag && "text-amber-600 dark:text-amber-400")}>
        {label}
        {flag && <span className="text-[10px] font-normal">· check</span>}
      </Label>
      {children}
    </div>
  );
}
