"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";

const GuideSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  category: z.string().trim().min(1).max(40),
  summary: z.string().trim().max(300).optional().or(z.literal("")),
  steps: z.string().trim().min(1, "Add at least one step").max(4000),
  source: z.string().trim().max(160).optional().or(z.literal("")),
});

function parse(formData: FormData) {
  return GuideSchema.safeParse({
    title: formData.get("title"),
    category: formData.get("category"),
    summary: formData.get("summary") ?? "",
    steps: formData.get("steps"),
    source: formData.get("source") ?? "",
  });
}

export async function createGuideAction(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await requirePermission("users:manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const max = await prisma.sopGuide.aggregate({ where: { companyId: user.companyId }, _max: { sortOrder: true } });
  await prisma.sopGuide.create({
    data: {
      companyId: user.companyId,
      title: d.title,
      category: d.category,
      summary: d.summary || null,
      steps: d.steps,
      source: d.source || null,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  revalidatePath("/admin/guides");
  revalidatePath("/delivery");
  return { ok: true };
}

export async function updateGuideAction(
  guideId: string,
  _prev: unknown,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  const user = await requirePermission("users:manage");
  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const existing = await prisma.sopGuide.findFirst({ where: { id: guideId, companyId: user.companyId } });
  if (!existing) return { error: "Guide not found" };
  const d = parsed.data;
  await prisma.sopGuide.update({
    where: { id: guideId },
    data: {
      title: d.title,
      category: d.category,
      summary: d.summary || null,
      steps: d.steps,
      source: d.source || null,
    },
  });
  revalidatePath("/admin/guides");
  revalidatePath("/delivery");
  return { ok: true };
}

export async function toggleGuideAction(guideId: string, active: boolean): Promise<{ error?: string }> {
  const user = await requirePermission("users:manage");
  const existing = await prisma.sopGuide.findFirst({ where: { id: guideId, companyId: user.companyId } });
  if (!existing) return { error: "Guide not found" };
  await prisma.sopGuide.update({ where: { id: guideId }, data: { active } });
  revalidatePath("/admin/guides");
  revalidatePath("/delivery");
  return {};
}

export async function deleteGuideAction(guideId: string): Promise<{ error?: string }> {
  const user = await requirePermission("users:manage");
  const existing = await prisma.sopGuide.findFirst({ where: { id: guideId, companyId: user.companyId } });
  if (!existing) return { error: "Guide not found" };
  await prisma.sopGuide.delete({ where: { id: guideId } });
  revalidatePath("/admin/guides");
  revalidatePath("/delivery");
  return {};
}
