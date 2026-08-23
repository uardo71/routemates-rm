/**
 * One-off: lock time entry on any milestone whose ENTIRE value has already been taken out via
 * negative value-adjustments (effective value ~0) but that was absorbed before the auto-lock rule
 * existed. Mirrors createMilestoneAdjustmentAction's new behaviour for historical data.
 *
 * Run:  pnpm exec tsx scripts/lock-absorbed-milestones.ts
 * Idempotent — only touches milestones that are fully absorbed AND still have timeEntryOpen=true.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const milestones = await prisma.milestone.findMany({
    where: { timeEntryOpen: true, adjustments: { some: {} } },
    select: {
      id: true,
      name: true,
      salesPrice: true,
      budgetHours: true,
      project: { select: { billingType: true } },
      adjustments: { select: { amount: true } },
    },
  });

  let locked = 0;
  for (const m of milestones) {
    const base =
      m.project.billingType === "FIXED_PRICE"
        ? Number(m.salesPrice)
        : Number(m.salesPrice) * Number(m.budgetHours ?? 0);
    const totalAdj = m.adjustments.reduce((s, a) => s + Number(a.amount), 0);
    const effective = base + totalAdj;
    if (base > 0 && totalAdj < 0 && effective <= 0.005) {
      await prisma.milestone.update({ where: { id: m.id }, data: { timeEntryOpen: false } });
      console.log(`Locked time entry: ${m.name} (effective ${effective.toFixed(2)})`);
      locked++;
    }
  }
  console.log(`Done. Locked ${locked} fully-absorbed milestone(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
