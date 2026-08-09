"use server";

import { revalidatePath } from "next/cache";
import { parseISO } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requirePermission } from "@/lib/session";
import { can } from "@/lib/permissions";
import { MAX_RECEIPT_SIZE_BYTES, isAllowedReceiptType, saveReceiptFile, deleteReceiptFile } from "@/lib/receipt-storage";

const ExpenseFieldsSchema = z.object({
  categoryId: z.string().min(1, "Pick a category."),
  date: z.string().min(1),
  amount: z.coerce.number().positive("Amount must be greater than 0."),
  currency: z.string().min(1).max(10),
  description: z.string().min(1, "Description is required.").max(500),
  vendor: z.string().max(200).optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidBy: z.enum(["COMPANY", "EMPLOYEE"]),
  // Manager-only proxy target — who this expense is for/owed to. Ignored for anyone without
  // expenses:manage, who can only ever submit for themselves.
  userId: z.string().optional(),
});

/** Handles the whole create flow including receipt uploads — FormData rather than a plain
 *  object since File values can't round-trip through a serialized server-action argument the
 *  way plain objects can. Auto-approves when the submitter has expenses:manage (Admin/Finance),
 *  regardless of paidBy — anyone else's entry (company-card purchase or personal reimbursement
 *  claim alike) lands PENDING for review, since the point of the review step is verifying the
 *  record is accurate before it hits the books, not just authorizing a payout. */
export async function createExpenseAction(formData: FormData): Promise<{ error?: string }> {
  const caller = await requireUser();
  const parsed = ExpenseFieldsSchema.safeParse({
    categoryId: formData.get("categoryId"),
    date: formData.get("date"),
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    description: formData.get("description"),
    vendor: formData.get("vendor") || undefined,
    paymentMethod: formData.get("paymentMethod"),
    paidBy: formData.get("paidBy"),
    userId: formData.get("userId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const isManager = can(caller, "expenses:manage");
  const targetUserId = isManager && data.userId ? data.userId : caller.id;

  const targetUser = await prisma.user.findFirst({ where: { id: targetUserId, companyId: caller.companyId } });
  if (!targetUser) return { error: "Invalid user." };

  const category = await prisma.expenseCategory.findFirst({ where: { id: data.categoryId, companyId: caller.companyId } });
  if (!category) return { error: "Invalid category." };

  // parseISO, not the native Date constructor — matches this app's established convention for
  // date-only strings (see docs/PROJECT_CONTEXT.md / rm_ops_project memory: the constructor
  // treats them as UTC, which drifts off local midnight on non-UTC servers).
  const date = parseISO(data.date);
  if (Number.isNaN(date.getTime())) return { error: "Invalid date." };

  // Validate every file before writing any of them, so a single bad file doesn't leave a
  // partially-saved batch behind.
  const rawFiles = formData.getAll("receipts").filter((f): f is File => f instanceof File && f.size > 0);
  for (const f of rawFiles) {
    if (f.size > MAX_RECEIPT_SIZE_BYTES) return { error: `${f.name} is too large (max ${MAX_RECEIPT_SIZE_BYTES / 1024 / 1024}MB).` };
    if (!isAllowedReceiptType(f.type)) return { error: `${f.name}: unsupported file type — use a photo (JPG/PNG/WEBP/HEIC) or PDF.` };
  }
  const saved = [];
  for (const f of rawFiles) {
    saved.push(await saveReceiptFile(f));
  }

  const now = new Date();
  await prisma.expense.create({
    data: {
      companyId: caller.companyId,
      categoryId: category.id,
      date,
      amount: data.amount,
      currency: data.currency,
      description: data.description,
      vendor: data.vendor,
      paymentMethod: data.paymentMethod,
      paidBy: data.paidBy,
      userId: targetUserId,
      submittedById: caller.id,
      status: isManager ? "APPROVED" : "PENDING",
      decidedById: isManager ? caller.id : null,
      decidedAt: isManager ? now : null,
      receipts: { create: saved },
    },
  });

  revalidatePath("/expenses");
  return {};
}

const DecideSchema = z.object({
  expenseId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  comment: z.string().max(500).optional(),
});
export type DecideExpenseInput = z.infer<typeof DecideSchema>;

export async function decideExpenseAction(input: DecideExpenseInput): Promise<{ error?: string }> {
  const caller = await requirePermission("expenses:manage");
  const parsed = DecideSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input." };
  const data = parsed.data;

  const expense = await prisma.expense.findFirst({ where: { id: data.expenseId, companyId: caller.companyId } });
  if (!expense) return { error: "Expense not found." };
  if (expense.status !== "PENDING") return { error: "This expense has already been decided." };

  await prisma.expense.update({
    where: { id: expense.id },
    data: {
      status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedById: caller.id,
      decidedAt: new Date(),
      comment: data.comment,
    },
  });
  revalidatePath("/expenses");
  return {};
}

export async function deleteExpenseAction(expenseId: string): Promise<{ error?: string }> {
  const caller = await requireUser();
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, companyId: caller.companyId },
    include: { receipts: true },
  });
  if (!expense) return { error: "Expense not found." };
  const isOwner = expense.userId === caller.id || expense.submittedById === caller.id;
  const isManager = can(caller, "expenses:manage");
  if (!isOwner && !isManager) return { error: "You cannot delete this expense." };
  // Same discipline as leave requests: only a still-PENDING record can be pulled back, even for
  // a manager — once decided it's part of the audit trail, correct it with a fresh entry/comment
  // rather than erasing it.
  if (expense.status !== "PENDING") return { error: "Only pending expenses can be deleted." };

  await prisma.expenseReceipt.deleteMany({ where: { expenseId: expense.id } });
  await prisma.expense.delete({ where: { id: expense.id } });
  for (const r of expense.receipts) {
    await deleteReceiptFile(r.fileName);
  }
  revalidatePath("/expenses");
  return {};
}
