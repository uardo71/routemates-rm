"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (v: string | null | undefined): Date | null =>
  v && dateOnly.test(v) ? new Date(`${v}T00:00:00.000Z`) : null;

// ---------- categories ----------

const CategoryNameSchema = z.string().trim().min(1, "Name is required.").max(100);

export async function createTaxCategoryAction(name: string): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const parsed = CategoryNameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const existing = await prisma.taxCategory.findFirst({ where: { companyId: caller.companyId, name: parsed.data } });
  if (existing) return { error: "A category with this name already exists." };

  await prisma.taxCategory.create({ data: { companyId: caller.companyId, name: parsed.data } });
  revalidatePath("/taxes");
  return {};
}

export async function deleteTaxCategoryAction(categoryId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const category = await prisma.taxCategory.findFirst({ where: { id: categoryId, companyId: caller.companyId } });
  if (!category) return { error: "Category not found." };

  const count = await prisma.taxPayment.count({ where: { categoryId } });
  if (count > 0) return { error: `Can't delete — ${count} tax record${count === 1 ? "" : "s"} still use this category.` };

  await prisma.taxCategory.delete({ where: { id: categoryId } });
  revalidatePath("/taxes");
  return {};
}

// ---------- payments ----------

const PaymentSchema = z.object({
  categoryId: z.string().min(1, "Pick a category."),
  periodStart: z.string().regex(dateOnly, "Pick the tax period."),
  periodEnd: z.string().optional().nullable(),
  amount: z.coerce.number().positive("Amount must be greater than 0."),
  currency: z.string().min(1).max(10),
  serialNumber: z.string().max(100).optional().nullable(),
  authority: z.string().max(200).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: z.enum(["TO_PAY", "PAID"]),
  paymentDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type TaxPaymentInput = z.infer<typeof PaymentSchema>;

async function resolveCategory(companyId: string, categoryId: string) {
  return prisma.taxCategory.findFirst({ where: { id: categoryId, companyId } });
}

export async function createTaxPaymentAction(input: TaxPaymentInput): Promise<{ error?: string; id?: string }> {
  const caller = await requirePermission("taxes:manage");
  const parsed = PaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const category = await resolveCategory(caller.companyId, d.categoryId);
  if (!category) return { error: "Invalid category." };

  const periodStart = toUtc(d.periodStart)!;
  const periodEnd = toUtc(d.periodEnd);
  if (periodEnd && periodEnd < periodStart) return { error: "Period end can't be before the start." };
  // A PAID record defaults its payment date to today when none is given.
  const paymentDate = d.status === "PAID" ? (toUtc(d.paymentDate) ?? new Date()) : null;

  const created = await prisma.taxPayment.create({
    data: {
      companyId: caller.companyId,
      categoryId: category.id,
      status: d.status,
      periodStart,
      periodEnd,
      amount: d.amount,
      currency: d.currency,
      serialNumber: d.serialNumber?.trim() || null,
      authority: d.authority?.trim() || null,
      dueDate: toUtc(d.dueDate),
      paymentDate,
      notes: d.notes?.trim() || null,
      recordedById: caller.id,
    },
  });
  revalidatePath("/taxes");
  return { id: created.id };
}

const UpdateSchema = PaymentSchema.extend({ id: z.string().min(1) });
export type TaxPaymentUpdateInput = z.infer<typeof UpdateSchema>;

export async function updateTaxPaymentAction(input: TaxPaymentUpdateInput): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const existing = await prisma.taxPayment.findFirst({ where: { id: d.id, companyId: caller.companyId } });
  if (!existing) return { error: "Tax record not found." };
  const category = await resolveCategory(caller.companyId, d.categoryId);
  if (!category) return { error: "Invalid category." };

  const periodStart = toUtc(d.periodStart)!;
  const periodEnd = toUtc(d.periodEnd);
  if (periodEnd && periodEnd < periodStart) return { error: "Period end can't be before the start." };
  // Keep an existing payment date when still paid and none supplied; clear it if moved back to TO_PAY.
  const paymentDate = d.status === "PAID" ? (toUtc(d.paymentDate) ?? existing.paymentDate ?? new Date()) : null;

  await prisma.taxPayment.update({
    where: { id: existing.id },
    data: {
      categoryId: category.id,
      status: d.status,
      periodStart,
      periodEnd,
      amount: d.amount,
      currency: d.currency,
      serialNumber: d.serialNumber?.trim() || null,
      authority: d.authority?.trim() || null,
      dueDate: toUtc(d.dueDate),
      paymentDate,
      notes: d.notes?.trim() || null,
    },
  });
  revalidatePath("/taxes");
  revalidatePath(`/taxes/${existing.id}`);
  return {};
}

/** Quick "mark paid" from the list/detail without opening the full editor. */
export async function markTaxPaidAction(input: { id: string; paymentDate?: string | null }): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const id = z.string().min(1).safeParse(input.id);
  if (!id.success) return { error: "Invalid record." };

  const existing = await prisma.taxPayment.findFirst({ where: { id: id.data, companyId: caller.companyId } });
  if (!existing) return { error: "Tax record not found." };

  await prisma.taxPayment.update({
    where: { id: existing.id },
    data: { status: "PAID", paymentDate: toUtc(input.paymentDate) ?? existing.paymentDate ?? new Date() },
  });
  revalidatePath("/taxes");
  revalidatePath(`/taxes/${existing.id}`);
  return {};
}

export async function deleteTaxPaymentAction(id: string): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const existing = await prisma.taxPayment.findFirst({ where: { id, companyId: caller.companyId }, include: { documents: true } });
  if (!existing) return { error: "Tax record not found." };

  await prisma.taxPayment.delete({ where: { id: existing.id } }); // Document rows cascade
  for (const doc of existing.documents) await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath("/taxes");
  return {};
}

// ---------- documents (tax notice / payment receipt / other) ----------

const TAX_DOC_KINDS = ["TAX_NOTICE", "PAYMENT_RECEIPT", "OTHER"] as const;
type TaxDocKind = (typeof TAX_DOC_KINDS)[number];

export async function uploadTaxDocumentAction(taxPaymentId: string, formData: FormData): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const payment = await prisma.taxPayment.findFirst({ where: { id: taxPaymentId, companyId: caller.companyId }, select: { id: true } });
  if (!payment) return { error: "Tax record not found." };

  const kind = String(formData.get("kind") ?? "");
  if (!TAX_DOC_KINDS.includes(kind as TaxDocKind)) return { error: "Invalid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  if (!isAllowedReceiptType(file.type)) return { error: "Unsupported file type — use a PDF or an image (JPG/PNG/WEBP)." };

  const saved = await saveReceiptFile(file, "documents");
  await prisma.document.create({
    data: { companyId: caller.companyId, kind: kind as TaxDocKind, taxPaymentId, uploadedById: caller.id, ...saved },
  });
  revalidatePath(`/taxes/${taxPaymentId}`);
  return {};
}

export async function deleteTaxDocumentAction(documentId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("taxes:manage");
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId: caller.companyId, taxPaymentId: { not: null } } });
  if (!doc || !doc.taxPaymentId) return { error: "Document not found." };

  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath(`/taxes/${doc.taxPaymentId}`);
  return {};
}
