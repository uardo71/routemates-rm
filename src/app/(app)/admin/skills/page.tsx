import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/session";
import { SkillsCatalogueClient } from "./skills-catalogue-client";

export const metadata = { title: "Skills catalogue" };

// The company's skill catalogue. Gated on skills:manage (Admin).
export default async function SkillsCataloguePage() {
  const user = await requirePermission("skills:manage");
  const skills = await prisma.skill.findMany({
    where: { companyId: user.companyId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true, _count: { select: { userSkills: true } } },
  });
  return (
    <SkillsCatalogueClient
      skills={skills.map((s) => ({ id: s.id, name: s.name, category: s.category, people: s._count.userSkills }))}
    />
  );
}
