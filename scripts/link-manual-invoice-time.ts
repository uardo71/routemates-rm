/**
 * Backfill: attach approved time entries to invoices that were created MANUALLY.
 *
 * Only `createTimeInvoiceAction` ever set `TimeEntry.invoiceLineId`. Invoices typed by hand left
 * their entries unlinked, so the same hours appeared both on the invoice and as "still to bill".
 * `linkTimeEntriesToInvoice` now does this at creation time; this script repairs invoices raised
 * before that existed.
 *
 * Matching is the same conservative rule as the live code: time-billed projects only, the invoice
 * must carry a service period, entries must be approved and unlinked and fall inside that period,
 * and a line only claims entries that fit WHOLE inside its remaining quantity (oldest first).
 *
 *   pnpm exec tsx scripts/link-manual-invoice-time.ts            # dry run, changes nothing
 *   pnpm exec tsx scripts/link-manual-invoice-time.ts --apply    # write the links
 *
 * Reversible: `UPDATE "TimeEntry" SET "invoiceLineId" = NULL WHERE id IN (...)`.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const COMMISSION_DESC = "Sales comision";

async function main() {
  const invoices = await prisma.invoice.findMany({
    where: {
      type: "INVOICE",
      status: { not: "VOID" },
      projectId: { not: null },
      periodStart: { not: null },
      periodEnd: { not: null },
      project: { billingType: { in: ["TIME_AND_MATERIALS", "RETAINER"] } },
    },
    select: {
      id: true, invoiceNumber: true, status: true, projectId: true, periodStart: true, periodEnd: true,
      project: { select: { name: true } },
      lines: { select: { id: true, description: true, quantity: true, milestoneId: true }, orderBy: { id: "asc" } },
    },
    orderBy: { issueDate: "asc" },
  });

  console.log(`${APPLY ? "APPLYING" : "DRY RUN (nothing will be written)"} — ${invoices.length} candidate invoice(s)\n`);
  let totalLinked = 0;
  let totalHours = 0;

  for (const inv of invoices) {
    const periodEnd = new Date(inv.periodEnd!);
    periodEnd.setUTCHours(23, 59, 59, 999);

    const candidates = await prisma.timeEntry.findMany({
      where: {
        invoiceLineId: null,
        timeCard: { status: "APPROVED" },
        date: { gte: inv.periodStart!, lte: periodEnd },
        milestone: { billable: true, projectId: inv.projectId! },
      },
      select: { id: true, hours: true, milestoneId: true, date: true },
      orderBy: { date: "asc" },
    });
    if (candidates.length === 0) continue;

    const used = new Set<string>();
    let invLinked = 0;
    let invHours = 0;
    for (const line of inv.lines) {
      if (line.description === COMMISSION_DESC) continue;
      let remaining = Number(line.quantity);
      if (!(remaining > 0)) continue;
      const claim: string[] = [];
      let claimedHours = 0;
      for (const e of candidates) {
        if (used.has(e.id)) continue;
        if (line.milestoneId && e.milestoneId !== line.milestoneId) continue;
        const h = Number(e.hours);
        if (h <= 0 || h > remaining + 0.001) continue;
        claim.push(e.id);
        used.add(e.id);
        remaining -= h;
        claimedHours += h;
        if (remaining <= 0.001) break;
      }
      if (claim.length === 0) continue;
      if (APPLY) {
        const r = await prisma.timeEntry.updateMany({
          where: { id: { in: claim }, invoiceLineId: null },
          data: { invoiceLineId: line.id },
        });
        invLinked += r.count;
      } else {
        invLinked += claim.length;
      }
      invHours += claimedHours;
      const left = Math.round(remaining * 100) / 100;
      console.log(
        `  ${inv.invoiceNumber} [${inv.status}] "${line.description.slice(0, 34)}" qty ${Number(line.quantity)}h ` +
          `→ ${claim.length} entr${claim.length === 1 ? "y" : "ies"} / ${Math.round(claimedHours * 100) / 100}h` +
          (left > 0.005 ? `  (${left}h of the line left unmatched)` : ""),
      );
    }
    if (invLinked > 0) {
      totalLinked += invLinked;
      totalHours += invHours;
    }
  }

  console.log(
    `\n${APPLY ? "Linked" : "Would link"} ${totalLinked} time entries (${Math.round(totalHours * 100) / 100}h).`,
  );
  if (!APPLY && totalLinked > 0) console.log("Re-run with --apply to write these links.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
