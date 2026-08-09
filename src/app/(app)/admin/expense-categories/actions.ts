"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

const NameSchema = z.string().trim().min(1, "Name is required.").max(100);

export async function createExpenseCategoryAction(name: string): Promise<{ error?: string }> {
  const caller = await requirePermission("expenses:manage");
  const parsed = NameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const existing = await prisma.expenseCategory.findFirst({ where: { companyId: caller.companyId, name: parsed.data } });
  if (existing) return { error: "A category with this name already exists." };

  await prisma.expenseCategory.create({ data: { companyId: caller.companyId, name: parsed.data } });
  revalidatePath("/admin/expense-categories");
  return {};
}

export async function deleteExpenseCategoryAction(categoryId: string): Promise<void> {
  const caller = await requirePermission("expenses:manage");

  const category = await prisma.expenseCategory.findFirst({ where: { id: categoryId, companyId: caller.companyId } });
  if (!category) throw new Error("Category not found.");

  const count = await prisma.expense.count({ where: { categoryId } });
  if (count > 0) throw new Error(`Can't delete — ${count} expense${count === 1 ? "" : "s"} still use this category.`);

  await prisma.expenseCategory.delete({ where: { id: categoryId } });
  revalidatePath("/admin/expense-categories");
}
