"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { recomputeEmploymentCostRate } from "@/lib/cost-rate";
import { recordAudit } from "@/lib/audit";

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

  await prisma.$transaction(async (tx) => {
    const created = await tx.salary.create({
      data: {
        userId: data.userId,
        monthlyAmount: data.monthlyAmount,
        currency: data.currency,
        effectiveFrom: new Date(data.effectiveFrom),
      },
    });
    await recordAudit(tx, { entityType: "Salary", entityId: created.id, action: "create", actor: caller, after: created, label: target.name });
  });

  await recomputeEmploymentCostRate(data.userId, (tx, before, after) =>
    recordAudit(tx, { entityType: "Employment", entityId: String(after.id), action: "update", actor: caller, before, after, fields: ["costRate"], label: target.name, note: "recomputed from salary" }),
  );

  revalidatePath(`/admin/users/${data.userId}`);
}

export async function deleteSalaryAction(salaryId: string) {
  const caller = await requirePermission("salaries:manage");

  const salary = await prisma.salary.findFirst({
    where: { id: salaryId, user: { companyId: caller.companyId } },
    include: { user: { select: { name: true } } },
  });
  if (!salary) throw new Error("Salary record not found.");

  await prisma.$transaction(async (tx) => {
    await tx.salary.delete({ where: { id: salaryId } });
    await recordAudit(tx, { entityType: "Salary", entityId: salaryId, action: "delete", actor: caller, before: salary, label: salary.user.name });
  });
  await recomputeEmploymentCostRate(salary.userId, (tx, before, after) =>
    recordAudit(tx, { entityType: "Employment", entityId: String(after.id), action: "update", actor: caller, before, after, fields: ["costRate"], label: salary.user.name, note: "recomputed after salary removed" }),
  );

  revalidatePath(`/admin/users/${salary.userId}`);
}
