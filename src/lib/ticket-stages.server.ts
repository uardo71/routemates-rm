import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Server-side helpers for the generic stage lifecycle. The rules are pure and live in
// src/lib/ticket-stages.ts; this module only reads and writes the rows they reason about.
//
// The stage-move ledger is `ChangeRequestStageEvent`. Its name is historical — it was added for the
// change request, but not one of its columns is change-request-specific (ticket, from, to, move,
// note, override, who, when), and a STAGE-mode ticket needs exactly that. Reusing it keeps every
// lifecycle's history in one table and needs no migration; renaming the model would need one, so it
// waits for the migration the owner authorises next.

/** The gate keys someone has ticked on a ticket, by gate key (not id — the rules speak in keys). */
export async function tickedGateKeys(ticketId: string): Promise<string[]> {
  const rows = await prisma.ticketGateCheck.findMany({
    where: { ticketId },
    select: { gate: { select: { key: true } } },
  });
  return rows.map((r) => r.gate.key);
}

/** A ticket entered its first stage (created, or its type changed into a STAGE-mode one).
 *  Runs inside the caller's transaction. */
export async function startTicketStage(
  tx: Prisma.TransactionClient, ticketId: string, stageKey: string, byId: string,
): Promise<void> {
  await tx.changeRequestStageEvent.create({ data: { ticketId, toKey: stageKey, move: "START", byId } });
}
