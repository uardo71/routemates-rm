/**
 * Walk a real Bug ticket through its stages, against the real database and the real rules.
 *
 * The agent can't sign in (the app is SSO-only), so this is how the STAGE-mode lifecycle is checked
 * end to end short of clicking it: it reads the Bug type's stages and gates as they actually are in
 * the DB, drives them through the pure rules in src/lib/ticket-stages.ts, and makes exactly the
 * writes the server actions make (Ticket.stageId, TicketGateCheck, a stage event). What it does NOT
 * cover is the session/permission layer and the rendering — those still want a human click-through.
 *
 *   pnpm exec tsx scripts/walkthrough-bug-stages.ts            # dry run, changes nothing
 *   pnpm exec tsx scripts/walkthrough-bug-stages.ts --apply    # create/reuse the ticket and write
 *
 * The walkthrough ticket is left alive, in Triage with both gates ticked and a stage history behind
 * it, so the same ticket can then be opened in the UI. Re-running reuses it rather than piling up.
 */
import { PrismaClient } from "@prisma/client";
import {
  closeTarget, decideStageMove, gateChecks, nextStage, reopenTarget, sortStages, stageByKey, stageMoveKind,
  type StageDef,
} from "../src/lib/ticket-stages";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const TITLE = "[walkthrough] Stage-mode Bug";

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
const step = (s: string) => console.log(`\n${s}`);

async function main() {
  console.log(APPLY ? "Walking the Bug stage lifecycle (WRITING)\n" : "Walking the Bug stage lifecycle (dry run — no writes)\n");

  // ---------- the type, as configured ----------
  const type = await prisma.ticketTypeDef.findFirst({
    where: { key: "bug" },
    include: { stages: { orderBy: { order: "asc" }, include: { gates: { orderBy: { order: "asc" } } } }, statuses: true },
  });
  if (!type) throw new Error("No Bug ticket type in this database.");

  const stages: StageDef[] = sortStages(type.stages.map((s) => ({
    key: s.key, name: s.name, description: s.description, order: s.order,
    isStarting: s.isStarting, isTerminal: s.isTerminal,
    gates: s.gates.map((g) => ({ key: g.key, label: g.label, description: g.description })),
  })));
  const rowOf = (key: string) => type.stages.find((s) => s.key === key)!;
  const gateIdOf = (stageKey: string, gateKey: string) => rowOf(stageKey).gates.find((g) => g.key === gateKey)!.id;

  step("Configuration");
  check("Bug runs on stages", type.lifecycleMode === "STAGE", `lifecycleMode=${type.lifecycleMode}`);
  check("Bug has no SLA", type.slaApplicable === false, `slaApplicable=${type.slaApplicable}`);
  check("four stages, in order", stages.map((s) => s.key).join(" → ") === "triage → in_progress → fix_verification → closed", stages.map((s) => s.key).join(" → "));
  check("Triage is the starting stage", !!stages.find((s) => s.isStarting && s.key === "triage"));
  check("Closed is terminal", !!stages.find((s) => s.isTerminal && s.key === "closed"));
  check("Triage gates: Reproduced + Severity set", stageByKey(stages, "triage")!.gates.map((g) => g.key).join(",") === "reproduced,severity_set");
  check("Fix verification gate: fix verified", stageByKey(stages, "fix_verification")!.gates.map((g) => g.key).join(",") === "fix_verified");
  check("every old Bug status is retired", type.statuses.every((s) => !!s.archivedAt), `${type.statuses.filter((s) => !s.archivedAt).length} still live`);

  const initialStatus = type.statuses.find((s) => s.isInitial) ?? type.statuses[0];
  if (!initialStatus) throw new Error("Bug has no status at all — a ticket needs one (Ticket.statusId is required).");
  const triage = rowOf("triage");

  // ---------- the ticket ----------
  step("The walkthrough ticket");
  let ticket = await prisma.ticket.findFirst({ where: { companyId: type.companyId, title: TITLE }, select: { id: true, number: true, stageId: true } });
  if (!ticket) {
    const client = await prisma.client.findFirst({ where: { companyId: type.companyId }, select: { id: true, name: true } });
    const actor = await prisma.user.findFirst({ where: { companyId: type.companyId, active: true, role: "ADMIN" }, select: { id: true, name: true } });
    if (!actor) throw new Error("No active admin to raise the ticket as.");
    if (!APPLY) {
      console.log(`  would create "${TITLE}" for ${client?.name ?? "no client"}, raised by ${actor.name}, in Triage`);
      return stopDryRun();
    }
    const last = await prisma.ticket.findFirst({ where: { companyId: type.companyId }, orderBy: { number: "desc" }, select: { number: true } });
    const number = `TKT-${String((last?.number ? parseInt(last.number.replace(/\D/g, ""), 10) || 0 : 0) + 1).padStart(8, "0")}`;
    ticket = await prisma.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          companyId: type.companyId, number, title: TITLE,
          description: "Raised by scripts/walkthrough-bug-stages.ts to exercise the STAGE-mode lifecycle. Safe to delete.",
          typeId: type.id, priority: "MEDIUM", statusId: initialStatus.id, stageId: triage.id,
          requesterId: actor.id, createdById: actor.id, clientId: client?.id ?? null,
          comments: { create: { authorId: actor.id, kind: "CREATED", body: "raised the ticket" } },
        },
        select: { id: true, number: true, stageId: true },
      });
      await tx.changeRequestStageEvent.create({ data: { ticketId: t.id, toKey: "triage", move: "START", byId: actor.id } });
      return t;
    });
    console.log(`  created ${ticket.number}`);
  } else {
    console.log(`  reusing ${ticket.number}`);
  }
  // Everything past here moves a real ticket and ticks real gates, so it only runs for real.
  if (!APPLY) return stopDryRun();
  const ticketId = ticket.id;
  const actorId = (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { createdById: true } })).createdById;

  // Back to the start, so a re-run walks the same path.
  if (APPLY) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { stageId: triage.id } });
    await prisma.ticketGateCheck.deleteMany({ where: { ticketId } });
  }
  check("starts in Triage", (await currentStageKey(ticketId)) === "triage");

  const ticked = async () => (await prisma.ticketGateCheck.findMany({ where: { ticketId }, select: { gate: { select: { key: true } } } })).map((r) => r.gate.key);
  const decide = async (from: string, to: string, extra: { note?: string; overrideReason?: string; canManage?: boolean; involved?: boolean } = {}) =>
    decideStageMove({ stages, from, to, ticked: await ticked(), canManage: true, involved: true, ...extra });

  async function apply(from: string, to: string, kind: string, note: string | null, overrideReason: string | null) {
    if (!APPLY) return;
    const target = rowOf(to);
    await prisma.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id: ticketId }, data: { stageId: target.id } });
      await tx.changeRequestStageEvent.create({ data: { ticketId, fromKey: from, toKey: to, move: kind, note, overrideReason, byId: actorId } });
    });
  }

  // ---------- Triage: the gates hold the ticket ----------
  step("Triage — the gates hold it");
  const blocked = await decide("triage", "in_progress");
  check("forward is refused with no gate ticked", !blocked.ok, blocked.ok ? "" : blocked.error);
  check("both gates are named as failing", blocked.failing.map((c) => c.key).join(",") === "reproduced,severity_set");

  if (APPLY) await prisma.ticketGateCheck.create({ data: { ticketId, gateId: gateIdOf("triage", "reproduced"), checkedById: actorId } });
  const half = await decide("triage", "in_progress");
  check("still refused with one gate ticked", !half.ok, half.ok ? "" : half.error);

  const overridden = await decide("triage", "in_progress", { overrideReason: "Severity agreed on the call" });
  check("the support team can go ahead with a written override", overridden.ok && overridden.overridden);
  const notTeam = await decide("triage", "in_progress", { canManage: false, overrideReason: "please" });
  check("someone off the team cannot override", !notTeam.ok);

  if (APPLY) await prisma.ticketGateCheck.create({ data: { ticketId, gateId: gateIdOf("triage", "severity_set"), checkedById: actorId } });
  const green = await decide("triage", "in_progress");
  check("forward is allowed once both gates are ticked", green.ok && green.kind === "FORWARD");
  check("Triage checks read green", (gateChecks(stageByKey(stages, "triage"), await ticked())).every((c) => c.ok));

  // ---------- forward, and forward again ----------
  step("Forward through the flow");
  await apply("triage", "in_progress", "FORWARD", null, null);
  check("now in In progress", (await currentStageKey(ticketId)) === "in_progress");
  check("next stage is Fix verification", nextStage(stages, "in_progress")?.key === "fix_verification");

  const skip = stageMoveKind(stages, "in_progress", "closed");
  check("a jump to Closed is a close, not a forward", skip.ok && skip.kind === "CLOSE", skip.ok ? skip.kind : skip.reason);
  const skipNoNote = await decide("in_progress", "closed");
  check("closing early needs a reason", !skipNoNote.ok, skipNoNote.ok ? "" : skipNoNote.error);
  const skipWithNote = await decide("in_progress", "closed", { note: "Duplicate of TKT-00000004" });
  check("with a reason, closing early is allowed", skipWithNote.ok && skipWithNote.kind === "CLOSE");

  const onward = await decide("in_progress", "fix_verification");
  check("In progress has no gates, so forward is free", onward.ok && onward.kind === "FORWARD");
  await apply("in_progress", "fix_verification", "FORWARD", null, null);
  check("now in Fix verification", (await currentStageKey(ticketId)) === "fix_verification");
  check("Closed is the next stage here, so there is no early-close escape", closeTarget(stages, "fix_verification") === null);
  const unverified = await decide("fix_verification", "closed");
  check("closing is gated on the fix being verified", !unverified.ok, unverified.ok ? "" : unverified.error);

  // ---------- send it back ----------
  step("Send it back");
  const bare = await decide("fix_verification", "triage");
  check("sending back needs a reason", !bare.ok, bare.ok ? "" : bare.error);
  const back = await decide("fix_verification", "triage", { note: "Fails on the second scenario" });
  check("with a reason it goes back", back.ok && back.kind === "BACK");
  await apply("fix_verification", "triage", "BACK", "Fails on the second scenario", null);
  check("back in Triage", (await currentStageKey(ticketId)) === "triage");
  check("the Triage gates it already passed are still ticked", (await ticked()).length === 2);

  // ---------- what closing and reopening would do (not applied) ----------
  step("Closing and reopening (decided, not applied — the ticket stays open)");
  const close = await decide("triage", "closed", { note: "Not a defect — works as designed" });
  check("the support team can close it early with a reason", close.ok && close.kind === "CLOSE");
  const closeNotTeam = await decide("triage", "closed", { canManage: false, note: "Not a defect" });
  check("someone off the team cannot", !closeNotTeam.ok, closeNotTeam.ok ? "" : closeNotTeam.error);
  check("a closed ticket reopens into Fix verification", reopenTarget(stages, "closed")?.key === "fix_verification");
  const reopenWrong = decideStageMove({ stages, from: "closed", to: "triage", ticked: [], canManage: true, involved: true, note: "back again" });
  check("and nowhere else", !reopenWrong.ok, reopenWrong.ok ? "" : reopenWrong.error);

  // ---------- where it ends up ----------
  step("Final state");
  const final = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { number: true, stageDef: { select: { name: true } }, statusDef: { select: { name: true, archivedAt: true } }, closedAt: true },
  });
  const events = await prisma.changeRequestStageEvent.findMany({ where: { ticketId }, orderBy: { at: "asc" }, select: { fromKey: true, toKey: true, move: true } });
  console.log(`  ${final.number} — stage "${final.stageDef?.name}", legacy status "${final.statusDef.name}"${final.statusDef.archivedAt ? " (retired)" : ""}`);
  console.log(`  history: ${events.map((e) => `${e.move}${e.fromKey ? ` ${e.fromKey}→${e.toKey}` : ` →${e.toKey}`}`).join(", ") || "none"}`);
  check("the ticket is still open", final.closedAt === null);
  check("it kept a status the old list would recognise", !!final.statusDef.name);

  report();
}

async function currentStageKey(ticketId: string): Promise<string | null> {
  const t = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { stageDef: { select: { key: true } } } });
  return t.stageDef?.key ?? null;
}

function stopDryRun() {
  console.log("\n  (the stage walk itself needs --apply: it moves a real ticket)");
  report();
}

function report() {
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  if (!APPLY) console.log("Dry run — nothing was written. Re-run with --apply to walk it for real.");
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
