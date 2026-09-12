/**
 * Before/after for the SLA policy source (Phase 1 item 10), against real local data.
 *
 *   NODE_PATH=scripts/shims pnpm exec tsx scripts/sla-source-before-after.ts
 *
 * It configures a TEMPORARY override on one client, prints what the new-ticket form showed BEFORE
 * this change (the built-in hours, via the old `slaLabel`) next to what it shows AFTER (the resolved
 * policy), lists that client's open tickets with their stored deadlines, and deletes the temporary
 * override again. It never writes to a ticket: stored deadlines are printed only to show they don't
 * move.
 */
import { PrismaClient } from "@prisma/client";
import { TICKET_PRIORITIES, slaLabel } from "../src/lib/ticket";
import { pickPolicy, targetsLabel, SLA_SOURCE_LABEL } from "../src/lib/sla";

const prisma = new PrismaClient();
// Four deliberately DIFFERENT pairs, so the report proves each priority resolves on its own.
const OVERRIDE = {
  CRITICAL: { respond: 1, resolve: 2 },
  HIGH: { respond: 2, resolve: 6 },
  MEDIUM: { respond: 3, resolve: 12 },
  LOW: { respond: 5, resolve: 36 },
};

async function main() {
  const company = await prisma.company.findFirstOrThrow({ select: { id: true } });
  // Prefer a client that actually has tickets, so the "stored deadlines don't move" half of this
  // report has something real to show.
  const withTickets = await prisma.ticket.groupBy({ by: ["clientId"], _count: { _all: true }, orderBy: { _count: { clientId: "desc" } } });
  const preferredId = withTickets.find((g) => g.clientId)?.clientId ?? null;
  const client = preferredId
    ? await prisma.client.findFirstOrThrow({ where: { id: preferredId }, select: { id: true, name: true } })
    : await prisma.client.findFirstOrThrow({ where: { companyId: company.id }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const existing = await prisma.slaPolicy.findFirst({ where: { companyId: company.id, clientId: client.id }, select: { id: true } });
  if (existing) {
    console.log(`${client.name} already has a real override — leaving it alone and reporting on it.`);
  } else {
    await prisma.slaPolicy.create({ data: { companyId: company.id, clientId: client.id, targets: OVERRIDE } });
    console.log(`Temporary override configured on ${client.name}: ${JSON.stringify(OVERRIDE.MEDIUM)} for Medium.\n`);
  }

  const policies = await prisma.slaPolicy.findMany({ where: { companyId: company.id }, select: { clientId: true, targets: true } });
  const companyPolicy = policies.find((p) => p.clientId === null);
  console.log(`Policies configured: ${policies.length} (company default: ${companyPolicy ? "yes" : "no"})\n`);

  const other = await prisma.client.findFirst({ where: { companyId: company.id, id: { not: client.id } }, select: { id: true, name: true } });
  for (const target of [{ id: client.id, name: client.name }, ...(other ? [other] : []), { id: null as string | null, name: "(no client)" }]) {
    const resolved = pickPolicy(policies, target.id);
    console.log(`New-ticket form, client = ${target.name}:`);
    for (const p of TICKET_PRIORITIES) {
      console.log(`   ${p.padEnd(8)} before: SLA ${slaLabel(p).padEnd(30)} after: SLA ${targetsLabel(resolved.targets, p).padEnd(30)} (${SLA_SOURCE_LABEL[resolved.source]})`);
    }
    console.log("");
  }

  const tickets = await prisma.ticket.findMany({
    where: { companyId: company.id, clientId: client.id },
    select: {
      number: true, title: true, createdAt: true, respondBy: true, resolveBy: true,
      typeDef: { select: { name: true, slaApplicable: true } },
      statusDef: { select: { name: true, category: true } },
    },
    orderBy: { number: "asc" },
  });
  console.log(`${client.name}'s tickets — stored deadlines are NOT recalculated by this change:`);
  if (!tickets.length) console.log("   (none)");
  for (const t of tickets) {
    const hrs = (d: Date | null) => (d ? `${Math.round((d.getTime() - t.createdAt.getTime()) / 3_600_000)}h` : "—");
    const shown = t.typeDef.slaApplicable ? `respond ${hrs(t.respondBy)} · resolve ${hrs(t.resolveBy)}` : "no SLA shown (type has none)";
    console.log(`   ${t.number}  ${t.typeDef.name.padEnd(15)} ${t.statusDef.name.padEnd(13)} stored: respond ${hrs(t.respondBy)} / resolve ${hrs(t.resolveBy)}  -> displays: ${shown}`);
  }

  if (!existing) {
    await prisma.slaPolicy.deleteMany({ where: { companyId: company.id, clientId: client.id } });
    console.log(`\nTemporary override on ${client.name} removed.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
