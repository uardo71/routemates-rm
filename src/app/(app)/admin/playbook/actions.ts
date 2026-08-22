"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

const Schema = z.object({
  phase: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1, "Title is required.").max(300),
  description: z.string().max(1000).optional().nullable(),
  offsetDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
  active: z.boolean().optional(),
});

export async function createPlaybookTaskAction(input: z.infer<typeof Schema>): Promise<{ error?: string }> {
  const user = await requirePermission("projects:manage:any");
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const max = await prisma.playbookTask.aggregate({ where: { companyId: user.companyId }, _max: { sortOrder: true } });
  await prisma.playbookTask.create({
    data: {
      companyId: user.companyId,
      phase: parsed.data.phase,
      title: parsed.data.title,
      description: parsed.data.description?.trim() || null,
      offsetDays: parsed.data.offsetDays ?? null,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath("/admin/playbook");
  return {};
}

const UpdateSchema = Schema.extend({ id: z.string().min(1) });
export async function updatePlaybookTaskAction(input: z.infer<typeof UpdateSchema>): Promise<{ error?: string }> {
  const user = await requirePermission("projects:manage:any");
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const existing = await prisma.playbookTask.findFirst({ where: { id: parsed.data.id, companyId: user.companyId } });
  if (!existing) return { error: "Task not found." };
  await prisma.playbookTask.update({
    where: { id: existing.id },
    data: {
      phase: parsed.data.phase,
      title: parsed.data.title,
      description: parsed.data.description?.trim() || null,
      offsetDays: parsed.data.offsetDays ?? null,
      active: parsed.data.active ?? existing.active,
    },
  });
  revalidatePath("/admin/playbook");
  return {};
}

export async function deletePlaybookTaskAction(id: string): Promise<{ error?: string }> {
  const user = await requirePermission("projects:manage:any");
  const existing = await prisma.playbookTask.findFirst({ where: { id, companyId: user.companyId } });
  if (!existing) return { error: "Task not found." };
  await prisma.playbookTask.delete({ where: { id: existing.id } });
  revalidatePath("/admin/playbook");
  return {};
}
