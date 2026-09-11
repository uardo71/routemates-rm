/**
 * Verifies the portal-raised-ticket notification against real local data, by calling the very helper
 * the portal action calls (src/lib/ticket-notify.ts#notifyClientTeam).
 *
 *   NODE_PATH=scripts/shims pnpm exec tsx scripts/verify-portal-notify.ts
 *
 * Three cases: a customer's ticket notifies exactly that client's active support team and never the
 * customer; a staff-created ticket produces no team notification; a client with no team falls back to
 * the company's admins. Everything it creates is deleted again at the end.
 */
import { PrismaClient } from "@prisma/client";
import { notifyClientTeam } from "../src/lib/ticket-notify";

const prisma = new PrismaClient();
const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort().join(", ") || "(nobody)";
let failures = 0;

function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`        ${detail}`);
  if (!ok) failures++;
}

async function makeTicket(opts: { companyId: string; clientId: string | null; requesterId: string; title: string }) {
  const type = await prisma.ticketTypeDef.findFirst({
    where: { companyId: opts.companyId, customerCanCreate: true },
    include: { statuses: { orderBy: { order: "asc" } } },
  });
  if (!type) throw new Error("no customer-creatable ticket type in this company");
  const status = type.statuses.find((s) => s.isInitial) ?? type.statuses[0];
  return prisma.ticket.create({
    data: {
      companyId: opts.companyId, number: `VERIFY-${Date.now()}`, title: opts.title,
      typeId: type.id, statusId: status.id, priority: "MEDIUM",
      requesterId: opts.requesterId, createdById: opts.requesterId, clientId: opts.clientId,
    },
    select: { id: true },
  });
}

async function recipientsOf(ticketId: string) {
  const rows = await prisma.ticketNotification.findMany({ where: { ticketId }, select: { userId: true, kind: true, summary: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  return { rows, users };
}

async function main() {
  const created: string[] = [];
  let tempClientId: string | null = null;
  try {
    const customers = await prisma.user.findMany({
      where: { role: "CUSTOMER", active: true, clientId: { not: null } },
      select: { id: true, name: true, companyId: true, clientId: true },
      orderBy: { name: "asc" },
    });
    console.log(`Portal customers found: ${customers.length}\n`);

    // ---- 1. a customer's ticket notifies that client's active support team ----
    for (const c of customers) {
      const client = await prisma.client.findUnique({ where: { id: c.clientId! }, select: { name: true } });
      const team = await prisma.clientTeamMember.findMany({
        where: { clientId: c.clientId!, user: { active: true } },
        select: { user: { select: { id: true, name: true } } },
      });
      const expected = team.map((m) => m.user);
      const ticket = await makeTicket({ companyId: c.companyId, clientId: c.clientId, requesterId: c.id, title: `[verify] portal ticket from ${c.name}` });
      created.push(ticket.id);

      const res = await notifyClientTeam({
        ticketId: ticket.id, companyId: c.companyId, clientId: c.clientId, actorId: c.id,
        actorName: c.name, kind: "CREATED", summary: "raised a ticket from the portal",
      });
      const { rows, users } = await recipientsOf(ticket.id);

      console.log(`${c.name} (customer of ${client?.name}) raises a ticket:`);
      console.log(`        support team: ${names(expected)}`);
      console.log(`        notified:     ${names(users)}`);
      const sameSet = users.length === expected.length && expected.every((e) => users.some((u) => u.id === e.id));
      check("notified exactly that client's support team", sameSet, `${users.length} notification(s), fallback=${res.viaFallback}`);
      check("the customer was not notified", !rows.some((r) => r.userId === c.id), `recipients exclude ${c.name}`);
      check("kind and summary match the other in-app ticket notifications",
        rows.every((r) => r.kind === "CREATED" && r.summary === "raised a ticket from the portal"),
        'kind="CREATED", summary="raised a ticket from the portal"');
      console.log("");
    }

    // ---- 2. a staff-created ticket notifies no team (the staff path never calls the helper) ----
    const first = customers[0];
    const staff = first
      ? await prisma.user.findFirst({ where: { companyId: first.companyId, role: { not: "CUSTOMER" }, active: true }, select: { id: true, name: true, companyId: true } })
      : null;
    if (staff && first) {
      const ticket = await makeTicket({ companyId: staff.companyId, clientId: first.clientId, requesterId: staff.id, title: "[verify] staff-created ticket" });
      created.push(ticket.id);
      const { rows } = await recipientsOf(ticket.id);
      console.log(`${staff.name} (staff) creates a ticket on the same client:`);
      check("no client-team notification for a staff-created ticket", rows.length === 0, `${rows.length} notification(s) on that ticket`);
      console.log("");
    }

    // ---- 3. a client with no team falls back to the company's admins ----
    if (first) {
      const companyId = first.companyId;
      const temp = await prisma.client.create({ data: { companyId, name: `ZZ verify no-team ${Date.now()}` }, select: { id: true, name: true } });
      tempClientId = temp.id;
      const admins = await prisma.user.findMany({ where: { companyId, role: "ADMIN", active: true }, select: { id: true, name: true } });
      const ticket = await makeTicket({ companyId, clientId: temp.id, requesterId: first.id, title: "[verify] ticket for a client with no team" });
      created.push(ticket.id);

      const res = await notifyClientTeam({
        ticketId: ticket.id, companyId, clientId: temp.id, actorId: first.id,
        actorName: first.name, kind: "CREATED", summary: "raised a ticket from the portal",
      });
      const { users } = await recipientsOf(ticket.id);
      console.log(`A client with no support team (${temp.name}):`);
      console.log(`        active admins: ${names(admins)}`);
      console.log(`        notified:      ${names(users)}`);
      const sameSet = users.length === admins.length && admins.every((a) => users.some((u) => u.id === a.id));
      check("falls back to the company's admins", res.viaFallback && sameSet, `fallback=${res.viaFallback}, ${users.length} notified`);
      console.log("");
    }
  } finally {
    if (created.length) await prisma.ticket.deleteMany({ where: { id: { in: created } } }); // notifications cascade
    if (tempClientId) await prisma.client.delete({ where: { id: tempClientId } });
    console.log(`Cleaned up: ${created.length} ticket(s)${tempClientId ? " + 1 temporary client" : ""}.`);
  }
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
