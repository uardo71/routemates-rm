/**
 * Proves, against real erp_dev data, that Support tickets reach the Actions register correctly.
 *
 *   NODE_PATH=scripts/shims pnpm exec tsx scripts/verify-actions-tickets.ts
 *
 * It calls the REAL loader (no re-implementation), temporarily makes one ticket breached and one
 * stage ticket gate-waiting, checks what the register says, and puts both back exactly as they were.
 * Nothing is left behind.
 */
import { PrismaClient } from "@prisma/client";
import { loadActions } from "../src/lib/actions-register-data";
import { attentionActions, groupByClient } from "../src/lib/actions-register";
import type { SessionUser } from "../src/lib/permissions";

const prisma = new PrismaClient();
const todayIso = new Date().toISOString().slice(0, 10);
let pass = 0, fail = 0;
const check = (ok: boolean, label: string, extra = "") => {
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (ok) pass++; else fail++;
};

async function load(user: SessionUser) {
  return loadActions(user, { projectIds: "ALL", mineOnly: false, todayIso, include: "open", tickets: true });
}

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", active: true }, select: { id: true, name: true, companyId: true, role: true, email: true } });
  const user = { id: admin.id, companyId: admin.companyId, role: admin.role, name: admin.name, email: admin.email } as unknown as SessionUser;
  console.log(`Acting as ${admin.name} (ADMIN)\n`);

  const before = await load(user);
  const beforeTickets = before.filter((a) => a.source === "TICKET");
  console.log(`Baseline: ${before.length} open actions, ${beforeTickets.length} of them tickets.`);
  for (const t of beforeTickets) console.log(`   ${t.ref}  ${t.clientName ?? "(no client)"}  ${t.owner}  ${t.status}`);

  // ---------- 1. a STATUS-mode ticket pushed past its respond target ----------
  const slaTicket = await prisma.ticket.findFirst({
    where: { assigneeId: { not: null }, stageId: null, typeDef: { slaApplicable: true }, statusDef: { category: { notIn: ["DONE", "CANCELLED"] } } },
    select: { id: true, number: true, respondBy: true, firstResponseAt: true, clientId: true, client: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  console.log("\n1. Breached SLA ticket");
  // This database may have no OPEN status-mode ticket at all; borrow a closed one, put it back after.
  const closedSla = slaTicket ? null : await prisma.ticket.findFirst({
    where: { assigneeId: { not: null }, stageId: null, typeDef: { slaApplicable: true } },
    select: { id: true, number: true, respondBy: true, firstResponseAt: true, statusId: true, typeId: true, clientId: true, client: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  const openStatus = closedSla
    ? await prisma.ticketStatusDef.findFirst({ where: { typeId: closedSla.typeId, category: "OPEN", archivedAt: null }, select: { id: true } })
    : null;
  const subject = slaTicket ?? (closedSla && openStatus ? closedSla : null);

  if (!subject) {
    console.log("   (no STATUS-mode ticket to exercise in this database — skipped)");
  } else {
    const borrowed = !slaTicket;
    const original = { respondBy: subject.respondBy, firstResponseAt: subject.firstResponseAt, statusId: (subject as { statusId?: string }).statusId };
    await prisma.ticket.update({
      where: { id: subject.id },
      data: {
        respondBy: new Date(Date.now() - 6 * 3_600_000), firstResponseAt: null,
        ...(borrowed && openStatus ? { statusId: openStatus.id } : {}),
      },
    });
    if (borrowed) console.log(`   (borrowed the closed ${subject.number} and reopened it for this check — restored below)`);
    const rows = await load(user);
    const row = rows.find((a) => a.source === "TICKET" && a.id === subject.id);
    check(!!row, `${subject.number} appears in the register once breached`);
    check(row?.slaKind === "breached", "carries the badge's own verdict", row?.status ?? "absent");
    check(!!row && attentionActions(rows).some((a) => a.id === subject.id), "is listed in Needs attention");
    check(row?.completableHere === false, "offers no completion tick");
    check(row?.href === `/tickets/${subject.id}`, "links to the ticket itself", row?.href);
    const group = groupByClient(rows).find((g) => g.actions.some((a) => a.id === subject.id));
    check(group?.clientName === (subject.client?.name ?? "No client"), "groups under its own client", group?.clientName ?? "none");
    check(row?.owner === subject.assignee?.name, "is attributed to the assignee", row?.owner ?? "none");
    await prisma.ticket.update({ where: { id: subject.id }, data: { respondBy: original.respondBy, firstResponseAt: original.firstResponseAt, ...(borrowed && original.statusId ? { statusId: original.statusId } : {}) } });
    const restored = (await load(user)).find((a) => a.source === "TICKET" && a.id === subject.id && a.slaKind === "breached");
    check(!restored, "disappears again once the deadline is restored");
    const back = await prisma.ticket.findUniqueOrThrow({ where: { id: subject.id }, select: { statusId: true, respondBy: true, firstResponseAt: true } });
    check(back.statusId === original.statusId && String(back.respondBy) === String(original.respondBy) && String(back.firstResponseAt) === String(original.firstResponseAt), "the borrowed ticket is exactly as it was");
  }

  // ---------- 2. a STAGE-mode ticket with a gate nobody ticked ----------
  console.log("\n2. Gate-waiting stage ticket");
  const stageTicket = await prisma.ticket.findFirst({
    where: { assigneeId: { not: null }, stageId: { not: null }, statusDef: { category: { notIn: ["DONE", "CANCELLED"] } } },
    select: { id: true, number: true, stageDef: { select: { name: true, gates: { select: { id: true, key: true } } } }, gateChecks: { select: { id: true, gateId: true, checkedById: true, checkedAt: true } }, client: { select: { name: true } } },
  });
  if (!stageTicket || !stageTicket.stageDef) {
    console.log("   (no assigned STAGE-mode ticket in this database — skipped)");
  } else {
    const removed = stageTicket.gateChecks;
    // Temporarily untick everything on its current stage, so a gate is genuinely waiting.
    if (removed.length) await prisma.ticketGateCheck.deleteMany({ where: { id: { in: removed.map((g) => g.id) } } });
    const rows = await load(user);
    const row = rows.find((a) => a.source === "TICKET" && a.id === stageTicket.id);
    check(!!row, `${stageTicket.number} appears while a gate is unticked`);
    check((row?.gatesWaiting ?? 0) > 0, "reports how many gates wait", String(row?.gatesWaiting ?? 0));
    check(row?.stageName === stageTicket.stageDef.name, "names the stage it sits in", row?.stageName ?? "none");
    check(!!row && attentionActions(rows).some((a) => a.id === stageTicket.id), "is listed in Needs attention");
    check(row?.completableHere === false, "offers no completion tick");
    // Put every tick back exactly as it was.
    for (const g of removed) {
      await prisma.ticketGateCheck.create({ data: { ticketId: stageTicket.id, gateId: g.gateId, checkedById: g.checkedById, checkedAt: g.checkedAt } });
    }
    const after = await load(user);
    const stillThere = after.find((a) => a.source === "TICKET" && a.id === stageTicket.id);
    const gatesNow = await prisma.ticketGateCheck.count({ where: { ticketId: stageTicket.id } });
    check(gatesNow === removed.length, "every gate tick restored", `${gatesNow} of ${removed.length}`);
    if (removed.length === stageTicket.stageDef.gates.length) {
      check(!stillThere, "leaves the register once nothing is waiting");
    } else {
      console.log("   (its stage still has unticked gates of its own — it legitimately stays listed)");
    }
  }

  // ---------- 3. nothing else moved ----------
  console.log("\n3. The other four sources");
  const after = await load(user);
  const nonTicket = after.filter((a) => a.source !== "TICKET");
  const baselineNonTicket = before.filter((a) => a.source !== "TICKET");
  check(nonTicket.length === baselineNonTicket.length, "same number of non-ticket actions as at the start", `${nonTicket.length} vs ${baselineNonTicket.length}`);
  check(nonTicket.every((a) => a.clientName !== undefined), "every action carries a client for grouping");
  check(nonTicket.filter((a) => a.critical).every((a) => !a.completableHere), "critical items require Resolve");
  check(nonTicket.filter((a) => !a.critical).every((a) => a.completableHere), "routine items keep one-click completion");

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
