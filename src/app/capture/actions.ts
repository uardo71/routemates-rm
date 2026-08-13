"use server";

import { revalidatePath } from "next/cache";
import { parseISO } from "date-fns";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { deleteReceiptFile } from "@/lib/receipt-storage";

const ConfirmSchema = z.object({
  draftId: z.string().min(1),
  categoryId: z.string().min(1, "Pick a category."),
  date: z.string().min(1),
  amount: z.coerce.number().positive("Amount must be greater than 0."),
  currency: z.string().min(1).max(10),
  description: z.string().min(1, "Description is required.").max(500),
  vendor: z.string().max(200).optional(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "OTHER"]),
  paidBy: z.enum(["COMPANY", "EMPLOYEE"]),
});
export type ConfirmCaptureInput = z.infer<typeof ConfirmSchema>;

/** Confirms a captured receipt: updates the SAME draft row and moves it out of DRAFT into the normal
 *  flow using the existing expense auto-approval (manager → APPROVED, else PENDING). */
export async function confirmCapturedExpenseAction(input: ConfirmCaptureInput): Promise<{ error?: string }> {
  const caller = await requireUser();
  const parsed = ConfirmSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const draft = await prisma.expense.findFirst({ where: { id: d.draftId, companyId: caller.companyId } });
  if (!draft) return { error: "Draft not found." };
  if (draft.submittedById !== caller.id && draft.userId !== caller.id) return { error: "This isn't your capture." };
  if (draft.status !== "DRAFT") return { error: "This receipt has already been confirmed." };

  const category = await prisma.expenseCategory.findFirst({ where: { id: d.categoryId, companyId: caller.companyId } });
  if (!category) return { error: "Invalid category." };

  const date = parseISO(d.date);
  if (Number.isNaN(date.getTime())) return { error: "Invalid date." };

  const isManager = can(caller, "expenses:manage");
  const now = new Date();
  await prisma.expense.update({
    where: { id: draft.id },
    data: {
      categoryId: category.id,
      date,
      amount: d.amount,
      currency: d.currency,
      description: d.description,
      vendor: d.vendor,
      paymentMethod: d.paymentMethod,
      paidBy: d.paidBy,
      status: isManager ? "APPROVED" : "PENDING",
      decidedById: isManager ? caller.id : null,
      decidedAt: isManager ? now : null,
    },
  });

  revalidatePath("/expenses");
  return {};
}

/** Discards an unconfirmed capture — deletes the draft row and its receipt file. */
export async function discardCapturedExpenseAction(draftId: string): Promise<{ error?: string }> {
  const caller = await requireUser();
  const draft = await prisma.expense.findFirst({
    where: { id: draftId, companyId: caller.companyId },
    include: { receipts: true },
  });
  if (!draft) return { error: "Draft not found." };
  if (draft.submittedById !== caller.id && draft.userId !== caller.id) return { error: "This isn't your capture." };
  if (draft.status !== "DRAFT") return { error: "Only unconfirmed captures can be discarded." };

  await prisma.expenseReceipt.deleteMany({ where: { expenseId: draft.id } });
  await prisma.expense.delete({ where: { id: draft.id } });
  for (const r of draft.receipts) await deleteReceiptFile(r.fileName);

  return {};
}
