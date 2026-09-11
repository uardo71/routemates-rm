/**
 * Move existing Bug tickets from the old status list onto the seeded Bug stages.
 *
 * Mapping (agreed with the owner): a status in a finished category (DONE or CANCELLED — Closed,
 * Verified, Won't fix) lands on the Closed stage; everything still in flight (New, Triaged,
 * In progress, In review, Fixed) lands on Triage. The rule reads each status's CATEGORY, so a
 * status an admin added later maps sensibly too.
 *
 * Nothing is deleted: every ticket keeps its statusId, and the Bug status rows are archived
 * (archivedAt/archivedById) exactly like archived custom fields — so the ticket can still show its
 * old status read-only, and switching the type back restores it.
 *
 *   pnpm exec tsx scripts/migrate-bug-stage-mode.ts            # dry run, changes nothing
 *   pnpm exec tsx scripts/migrate-bug-stage-mode.ts --apply    # write
 *
 * Runs against whatever DATABASE_URL is set; it is idempotent (a ticket that already has a stage,
 * and an already-archived status, are left alone).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SYSTEM_ACTOR = "system";
const FINISHED = new Set(["DONE", "CANCELLED"]);

async function main() {
  const types = await prisma.ticketTypeDef.findMany({
    where: { key: "bug" },
    select: {
      id: true, companyId: true, name: true, lifecycleMode: true,
      statuses: { select: { id: true, key: true, name: true, category: true, archivedAt: true }, orderBy: { order: "asc" } },
      stages: { select: { id: true, key: true, name: true, isStarting: true, isTerminal: true }, orderBy: { order: "asc" } },
    },
  });
  if (types.length === 0) {
    console.log("No Bug type found — nothing to do.");
    return;
  }
  console.log(APPLY ? "APPLY — writing" : "DRY RUN — nothing is written");

  for (const type of types) {
    const triage = type.stages.find((s) => s.isStarting);
    const closed = type.stages.find((s) => s.isTerminal);
    console.log(`\n${type.name} (company ${type.companyId}) · mode ${type.lifecycleMode}`);
    if (!triage || !closed) {
      console.log("  ✗ stages not seeded yet (need a starting and a terminal stage) — run the seed migration first.");
      continue;
    }

    const tickets = await prisma.ticket.findMany({
      where: { typeId: type.id },
      select: { id: true, number: true, title: true, stageId: true, statusDef: { select: { key: true, name: true, category: true } } },
      orderBy: { number: "asc" },
    });
    console.log(`  ${tickets.length} ticket(s)`);

    const moves: { id: string; stageId: string }[] = [];
    for (const t of tickets) {
      const target = FINISHED.has(t.statusDef.category) ? closed : triage;
      if (t.stageId === target.id) {
        console.log(`  ${t.number}  ${t.statusDef.name.padEnd(14)} → ${target.name}  (already there — skipped)`);
        continue;
      }
      console.log(`  ${t.number}  ${t.statusDef.name.padEnd(14)} → ${target.name}   ${t.title.slice(0, 50)}`);
      moves.push({ id: t.id, stageId: target.id });
    }

    const toArchive = type.statuses.filter((s) => !s.archivedAt);
    console.log(`  statuses to archive (kept, shown read-only): ${toArchive.map((s) => s.name).join(", ") || "none"}`);
    console.log(`  → ${moves.length} ticket(s) would move, ${toArchive.length} status(es) would be archived`);

    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      for (const m of moves) await tx.ticket.update({ where: { id: m.id }, data: { stageId: m.stageId } });
      if (toArchive.length > 0) {
        await tx.ticketStatusDef.updateMany({
          where: { id: { in: toArchive.map((s) => s.id) } },
          data: { archivedAt: new Date(), archivedById: SYSTEM_ACTOR },
        });
      }
    });
    console.log(`  ✓ applied: ${moves.length} ticket(s) moved, ${toArchive.length} status(es) archived`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
