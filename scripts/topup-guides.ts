// Idempotent top-up: insert any DEFAULT_GUIDES entry that a company doesn't already have
// (matched by title). Safe to run repeatedly — it never duplicates and never touches guides
// an admin has edited or added. Run with:
//   pnpm exec tsx scripts/topup-guides.ts
import { PrismaClient } from "@prisma/client";
import { DEFAULT_GUIDES } from "../src/lib/guides";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const c of companies) {
    const existing = await prisma.sopGuide.findMany({ where: { companyId: c.id }, select: { title: true, sortOrder: true } });
    const haveTitles = new Set(existing.map((g) => g.title));
    let nextOrder = existing.reduce((m, g) => Math.max(m, g.sortOrder), 0) + 1;
    const toAdd = DEFAULT_GUIDES.filter((g) => !haveTitles.has(g.title));
    if (toAdd.length === 0) {
      console.log(`${c.name}: up to date (${existing.length} guides).`);
      continue;
    }
    await prisma.sopGuide.createMany({
      data: toAdd.map((g) => ({
        companyId: c.id,
        title: g.title,
        category: g.category,
        summary: g.summary,
        steps: g.steps.join("\n"),
        source: g.source,
        sortOrder: nextOrder++,
      })),
    });
    console.log(`${c.name}: added ${toAdd.length} guide(s) -> ${toAdd.map((g) => g.title).join("; ")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
