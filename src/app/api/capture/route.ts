import { NextRequest, NextResponse } from "next/server";
import { format, parseISO } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile } from "@/lib/receipt-storage";
import { analyzeReceipt, docIntelConfigured } from "@/lib/document-intelligence";

// Receipt capture endpoint for the /capture PWA. Session-gated (the caller is a signed-in employee).
// Saves the image, creates a DRAFT expense immediately (so the receipt is never lost even if OCR
// fails), runs Azure Document Intelligence best-effort, and returns the pre-filled draft.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const caller = await requireUser();

  const form = await req.formData();
  const file = form.get("receipt");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No image received." }, { status: 400 });
  }
  if (file.size > MAX_RECEIPT_SIZE_BYTES) {
    return NextResponse.json({ error: `Image too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }
  if (!isAllowedReceiptType(file.type) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
  }

  // categoryId is a required FK — seed the draft with the first category as a placeholder; the user
  // picks the real one on the confirm screen. (The company ships 6 default categories.)
  const [company, category] = await Promise.all([
    prisma.company.findUnique({ where: { id: caller.companyId }, select: { currency: true } }),
    prisma.expenseCategory.findFirst({ where: { companyId: caller.companyId }, orderBy: { name: "asc" } }),
  ]);
  if (!category) {
    return NextResponse.json(
      { error: "No expense categories exist yet — an admin must add at least one first." },
      { status: 400 }
    );
  }
  const defaultCurrency = company?.currency ?? "EUR";

  const saved = await saveReceiptFile(file);

  const draft = await prisma.expense.create({
    data: {
      companyId: caller.companyId,
      categoryId: category.id,
      date: new Date(),
      amount: 0,
      currency: defaultCurrency,
      description: "Captured receipt",
      paymentMethod: "CARD",
      paidBy: "COMPANY",
      userId: caller.id,
      submittedById: caller.id,
      status: "DRAFT",
      source: "CAPTURE",
      receipts: { create: saved },
    },
  });

  // Best-effort OCR — any failure leaves the draft intact for manual entry.
  let ocrError: string | null = null;
  if (docIntelConfigured()) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const extraction = await analyzeReceipt(bytes, file.type);
      if (extraction) {
        const parsedDate = extraction.date ? parseISO(extraction.date) : null;
        await prisma.expense.update({
          where: { id: draft.id },
          data: {
            vendor: extraction.vendor ?? undefined,
            description: extraction.vendor ? `Receipt — ${extraction.vendor}` : undefined,
            amount: typeof extraction.total === "number" ? extraction.total : undefined,
            currency: extraction.currency ?? undefined,
            date: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined,
            captureData: {
              confidences: extraction.confidences,
              items: extraction.items,
              docConfidence: extraction.docConfidence ?? null,
              modelId: extraction.modelId,
              apiVersion: extraction.apiVersion,
            },
          },
        });
      }
    } catch (e) {
      ocrError = (e as Error).message;
    }
  }

  const fresh = await prisma.expense.findUniqueOrThrow({ where: { id: draft.id } });
  return NextResponse.json({
    draftId: fresh.id,
    ocrConfigured: docIntelConfigured(),
    ocrError,
    fields: {
      categoryId: fresh.categoryId,
      date: format(fresh.date, "yyyy-MM-dd"),
      amount: Number(fresh.amount),
      currency: fresh.currency,
      description: fresh.description,
      vendor: fresh.vendor ?? "",
      paymentMethod: fresh.paymentMethod,
      paidBy: fresh.paidBy,
    },
    capture: fresh.captureData ?? null,
  });
}
