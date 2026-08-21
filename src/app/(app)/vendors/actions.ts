"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (v: string | null | undefined): Date | null =>
  v && dateOnly.test(v) ? new Date(`${v}T00:00:00.000Z`) : null;

// ---------- vendors ----------

const VendorSchema = z.object({ name: z.string().trim().min(1, "Name is required.").max(150), notes: z.string().max(1000).optional().nullable() });

export async function createVendorAction(input: { name: string; notes?: string | null }): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const parsed = VendorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const existing = await prisma.vendor.findFirst({ where: { companyId: caller.companyId, name: parsed.data.name } });
  if (existing) return { error: "A vendor with this name already exists." };

  await prisma.vendor.create({ data: { companyId: caller.companyId, name: parsed.data.name, notes: parsed.data.notes?.trim() || null } });
  revalidatePath("/vendors");
  return {};
}

export async function deleteVendorAction(vendorId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, companyId: caller.companyId } });
  if (!vendor) return { error: "Vendor not found." };

  const count = await prisma.vendorPayment.count({ where: { vendorId } });
  if (count > 0) return { error: `Can't delete — ${count} payment${count === 1 ? "" : "s"} still reference this vendor.` };

  await prisma.vendor.delete({ where: { id: vendor.id } });
  revalidatePath("/vendors");
  return {};
}

// ---------- payments ----------

const PaymentSchema = z.object({
  vendorId: z.string().min(1, "Pick a vendor."),
  projectId: z.string().optional().nullable(),
  status: z.enum(["TO_PAY", "PAID"]),
  description: z.string().max(300).optional().nullable(),
  invoiceNumber: z.string().max(100).optional().nullable(),
  amount: z.coerce.number().positive("Amount must be greater than 0."),
  currency: z.string().min(1).max(10),
  invoiceDate: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  paymentDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
export type VendorPaymentInput = z.infer<typeof PaymentSchema>;

async function resolveRefs(companyId: string, vendorId: string, projectId: string | null | undefined) {
  const vendor = await prisma.vendor.findFirst({ where: { id: vendorId, companyId } });
  if (!vendor) return { error: "Invalid vendor." as const };
  let projId: string | null = null;
  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
    if (!project) return { error: "Invalid project." as const };
    projId = project.id;
  }
  return { vendorId: vendor.id, projectId: projId };
}

export async function createVendorPaymentAction(input: VendorPaymentInput): Promise<{ error?: string; id?: string }> {
  const caller = await requirePermission("vendors:manage");
  const parsed = PaymentSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const refs = await resolveRefs(caller.companyId, d.vendorId, d.projectId);
  if ("error" in refs) return { error: refs.error };

  const paymentDate = d.status === "PAID" ? (toUtc(d.paymentDate) ?? new Date()) : null;
  const created = await prisma.vendorPayment.create({
    data: {
      companyId: caller.companyId,
      vendorId: refs.vendorId,
      projectId: refs.projectId,
      status: d.status,
      description: d.description?.trim() || null,
      invoiceNumber: d.invoiceNumber?.trim() || null,
      amount: d.amount,
      currency: d.currency,
      invoiceDate: toUtc(d.invoiceDate),
      dueDate: toUtc(d.dueDate),
      paymentDate,
      notes: d.notes?.trim() || null,
      recordedById: caller.id,
    },
  });
  revalidatePath("/vendors");
  return { id: created.id };
}

const UpdateSchema = PaymentSchema.extend({ id: z.string().min(1) });
export type VendorPaymentUpdateInput = z.infer<typeof UpdateSchema>;

export async function updateVendorPaymentAction(input: VendorPaymentUpdateInput): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const existing = await prisma.vendorPayment.findFirst({ where: { id: d.id, companyId: caller.companyId } });
  if (!existing) return { error: "Payment not found." };
  const refs = await resolveRefs(caller.companyId, d.vendorId, d.projectId);
  if ("error" in refs) return { error: refs.error };

  const paymentDate = d.status === "PAID" ? (toUtc(d.paymentDate) ?? existing.paymentDate ?? new Date()) : null;
  await prisma.vendorPayment.update({
    where: { id: existing.id },
    data: {
      vendorId: refs.vendorId,
      projectId: refs.projectId,
      status: d.status,
      description: d.description?.trim() || null,
      invoiceNumber: d.invoiceNumber?.trim() || null,
      amount: d.amount,
      currency: d.currency,
      invoiceDate: toUtc(d.invoiceDate),
      dueDate: toUtc(d.dueDate),
      paymentDate,
      notes: d.notes?.trim() || null,
    },
  });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${existing.id}`);
  return {};
}

export async function markVendorPaidAction(input: { id: string; paymentDate?: string | null }): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const id = z.string().min(1).safeParse(input.id);
  if (!id.success) return { error: "Invalid record." };
  const existing = await prisma.vendorPayment.findFirst({ where: { id: id.data, companyId: caller.companyId } });
  if (!existing) return { error: "Payment not found." };

  await prisma.vendorPayment.update({
    where: { id: existing.id },
    data: { status: "PAID", paymentDate: toUtc(input.paymentDate) ?? existing.paymentDate ?? new Date() },
  });
  revalidatePath("/vendors");
  revalidatePath(`/vendors/${existing.id}`);
  return {};
}

export async function deleteVendorPaymentAction(id: string): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const existing = await prisma.vendorPayment.findFirst({ where: { id, companyId: caller.companyId }, include: { documents: true } });
  if (!existing) return { error: "Payment not found." };

  await prisma.vendorPayment.delete({ where: { id: existing.id } }); // documents cascade
  for (const doc of existing.documents) await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath("/vendors");
  return {};
}

// ---------- documents (vendor invoice / payment receipt / other) ----------

const VENDOR_DOC_KINDS = ["VENDOR_INVOICE", "PAYMENT_RECEIPT", "OTHER"] as const;
type VendorDocKind = (typeof VENDOR_DOC_KINDS)[number];

export async function uploadVendorDocumentAction(vendorPaymentId: string, formData: FormData): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const payment = await prisma.vendorPayment.findFirst({ where: { id: vendorPaymentId, companyId: caller.companyId }, select: { id: true } });
  if (!payment) return { error: "Payment not found." };

  const kind = String(formData.get("kind") ?? "");
  if (!VENDOR_DOC_KINDS.includes(kind as VendorDocKind)) return { error: "Invalid document type." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pick a file to upload." };
  if (file.size > MAX_RECEIPT_SIZE_BYTES) return { error: `File is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
  if (!isAllowedReceiptType(file.type)) return { error: "Unsupported file type — use a PDF or an image (JPG/PNG/WEBP)." };

  const saved = await saveReceiptFile(file, "documents");
  await prisma.document.create({
    data: { companyId: caller.companyId, kind: kind as VendorDocKind, vendorPaymentId, uploadedById: caller.id, ...saved },
  });
  revalidatePath(`/vendors/${vendorPaymentId}`);
  return {};
}

export async function deleteVendorDocumentAction(documentId: string): Promise<{ error?: string }> {
  const caller = await requirePermission("vendors:manage");
  const doc = await prisma.document.findFirst({ where: { id: documentId, companyId: caller.companyId, vendorPaymentId: { not: null } } });
  if (!doc || !doc.vendorPaymentId) return { error: "Document not found." };

  await prisma.document.delete({ where: { id: doc.id } });
  await deleteReceiptFile(doc.fileName, "documents");
  revalidatePath(`/vendors/${doc.vendorPaymentId}`);
  return {};
}
