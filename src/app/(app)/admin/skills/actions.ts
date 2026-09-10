"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { SKILL_CATEGORIES, STARTER_SKILLS } from "@/lib/skills";

// The skill catalogue (admin only). People rate themselves against it on /profile.

const SkillSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "Give the skill a name.").max(120),
  category: z.enum(SKILL_CATEGORIES),
});
export type SkillInput = z.infer<typeof SkillSchema>;

function revalidate() {
  revalidatePath("/admin/skills");
  revalidatePath("/profile");
  revalidatePath("/people");
  revalidatePath("/people/matrix");
}

export async function saveSkillAction(input: SkillInput): Promise<{ error?: string; id?: string }> {
  const user = await requirePermission("skills:manage");
  const parsed = SkillSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;
  try {
    if (d.id) {
      const own = await prisma.skill.findFirst({ where: { id: d.id, companyId: user.companyId }, select: { id: true } });
      if (!own) return { error: "Skill not found." };
      await prisma.skill.update({ where: { id: d.id }, data: { name: d.name, category: d.category } });
      revalidate();
      return { id: d.id };
    }
    const created = await prisma.skill.create({ data: { companyId: user.companyId, name: d.name, category: d.category } });
    revalidate();
    return { id: created.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: `"${d.name}" is already in the catalogue.` };
    throw e;
  }
}

/** Removes a skill and every rating against it (people lose that row on their profile). */
export async function deleteSkillAction(id: string): Promise<{ error?: string }> {
  const user = await requirePermission("skills:manage");
  const own = await prisma.skill.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!own) return { error: "Skill not found." };
  await prisma.skill.delete({ where: { id } });
  revalidate();
  return {};
}

/** Adds the SAP-practice starter set; names already present are left alone. */
export async function seedStarterSkillsAction(): Promise<{ error?: string; added?: number }> {
  const user = await requirePermission("skills:manage");
  const existing = new Set((await prisma.skill.findMany({ where: { companyId: user.companyId }, select: { name: true } })).map((s) => s.name.toLowerCase()));
  const toAdd = STARTER_SKILLS.filter((s) => !existing.has(s.name.toLowerCase()));
  if (toAdd.length) await prisma.skill.createMany({ data: toAdd.map((s) => ({ companyId: user.companyId, name: s.name, category: s.category })) });
  revalidate();
  return { added: toAdd.length };
}
