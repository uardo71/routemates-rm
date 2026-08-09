"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { recomputeEmploymentCostRate } from "@/lib/cost-rate";

const SalarySchema = z.object({
  userId: z.string().min(1),
  monthlyAmount: z.coerce.number().positive("Must be a positive number"),
  currency: z.enum(["ALL", "EUR"]),
  effectiveFrom: z.string().min(1, "Effective date is required"),
});

export async function addSalaryAction(_prevState: string | undefined, formData: FormData) {
  const caller = await requirePermission("salaries:manage");

  const parsed = SalarySchema.safeParse({
    userId: formData.get("userId"),
    monthlyAmount: formData.get("monthlyAmount"),
    currency: formData.get("currency"),
    effectiveFrom: formData.get("effectiveFrom"),
  });
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid input";
  const data = parsed.data;

  const target = await prisma.user.findFirst({ where: { id: data.userId, companyId: caller.companyId } });
  if (!target) return "User not found.";

  await prisma.salary.create({
    data: {
      userId: data.userId,
      monthlyAmount: data.monthlyAmount,
      currency: data.currency,
      effectiveFrom: new Date(data.effectiveFrom),
    },
  });

  await recomputeEmploymentCostRate(data.userId);

  revalidatePath(`/admin/users/${data.userId}`);
}

export async function deleteSalaryAction(salaryId: string) {
  const caller = await requirePermission("salaries:manage");

  const salary = await prisma.salary.findFirst({
    where: { id: salaryId, user: { companyId: caller.companyId } },
  });
  if (!salary) throw new Error("Salary record not found.");

  await prisma.salary.delete({ where: { id: salaryId } });
  await recomputeEmploymentCostRate(salary.userId);

  revalidatePath(`/admin/users/${salary.userId}`);
}
