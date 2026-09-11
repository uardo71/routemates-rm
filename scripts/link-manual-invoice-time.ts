/**
 * Repair: re-match approved time to MANUALLY typed invoices, billing period by billing period.
 *
 * Uses exactly the routine the live invoice actions run on create/edit (src/lib/invoice-time-link*):
 * a line naming a task ("[P019912] …") takes that task's time; time logged without a task fills the
 * period's remaining room in date order; same-day corrections travel with the hours they correct.
 * Lines created from approved time (milestone-tied, already exactly linked) are never touched.
 *
 *   pnpm exec tsx scripts/link-manual-invoice-time.ts            # dry run, changes nothing
 *   pnpm exec tsx scripts/link-manual-invoice-time.ts --apply    # back up current links, then write
 *
 * Before writing, the previous invoiceLineId of every entry it will change is saved to
 * backups/relink-<timestamp>.json (gitignored). To undo, set each entry back to its `from` value.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { relinkInvoicePeriod, manualInvoicePeriods, type RelinkReport } from "../src/lib/invoice-time-link-db";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

function print(r: RelinkReport, projectName: string) {
  console.log(`\n${projectName} · ${r.periodStart} → ${r.periodEnd}`);
  for (const l of r.lines) {
    const flag = l.locked ? " (from approved time — untouched)" : Math.abs(l.after - l.quantity) > 0.005 ? `  ≠ qty by ${Math.round((l.after - l.quantity) * 100) / 100}h` : "";
    console.log(`  ${l.invoiceNumber.padEnd(9)} ${l.description.slice(0, 40).padEnd(40)} qty ${String(l.quantity).padStart(6)}h  linked ${String(l.before).padStart(6)}h → ${String(l.after).padStart(6)}h${flag}`);
  }
  console.log(`  ${r.changes.length} entr${r.changes.length === 1 ? "y" : "ies"} change · still unbilled in this period: ${r.unbilledHours}h`);
}

async function main() {
  const periods = await manualInvoicePeriods(prisma);
  const names = new Map((await prisma.project.findMany({ where: { id: { in: periods.map((p) => p.projectId) } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  console.log(`DRY RUN — ${periods.length} billing period(s)`);

  const plans: RelinkReport[] = [];
  for (const p of periods) {
    const r = await relinkInvoicePeriod(prisma, p.projectId, p.periodStart, p.periodEnd, { apply: false });
    if (!r) continue;
    plans.push(r);
    if (r.changes.length > 0) print(r, names.get(p.projectId) ?? p.projectId);
  }
  const total = plans.reduce((s, r) => s + r.changes.length, 0);
  console.log(`\n${total} entr${total === 1 ? "y" : "ies"} would change across ${plans.filter((r) => r.changes.length).length} period(s).`);
  if (!APPLY || total === 0) {
    if (total > 0) console.log("Re-run with --apply to write these links.");
    return;
  }

  mkdirSync("backups", { recursive: true });
  const file = `backups/relink-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(plans.flatMap((r) => r.changes), null, 2));
  console.log(`\nBacked up ${total} previous link(s) to ${file}. Applying…`);
  for (const p of periods) await relinkInvoicePeriod(prisma, p.projectId, p.periodStart, p.periodEnd, { apply: true });
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
