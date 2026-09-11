import "server-only";
import type { ChangeRequest, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EMPTY_CR_DRAFT, asCrStage, type CrDraft, type CrStageKey } from "@/lib/change-request";

const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** The stored record as the form's text fields. */
export function crDraftFromRow(r: ChangeRequest | null): CrDraft {
  if (!r) return { ...EMPTY_CR_DRAFT };
  return {
    assessment: r.assessment ?? "", estimateHours: r.estimateHours?.toString() ?? "", quoteReference: r.quoteReference ?? "",
    approvedByName: r.approvedByName ?? "", approvedOn: d10(r.approvedOn), approvalReference: r.approvalReference ?? "",
    plannedGoLive: d10(r.plannedGoLive), buildReference: r.buildReference ?? "",
    unitTestNotes: r.unitTestNotes ?? "", unitTestedOn: d10(r.unitTestedOn),
    uatSignedOffBy: r.uatSignedOffBy ?? "", uatSignedOffOn: d10(r.uatSignedOffOn), uatNotes: r.uatNotes ?? "",
    goLiveOn: d10(r.goLiveOn),
    nextStep: r.nextStep ?? "", nextStepOwnerId: r.nextStepOwnerId ?? "", nextStepDue: d10(r.nextStepDue),
  };
}

/** A ticket just became a change request (created as one, or its type changed): its record and the
 *  first stage event. Runs inside the caller's transaction. */
export async function startChangeRequest(tx: Prisma.TransactionClient, ticketId: string, statusKey: string, byId: string): Promise<void> {
  await tx.changeRequest.upsert({ where: { ticketId }, create: { ticketId }, update: {} });
  await tx.changeRequestStageEvent.create({ data: { ticketId, toKey: statusKey, move: "START", byId } });
}

/** Attachments filed under each stage — the evidence the Unit testing check accepts. */
export async function evidenceByStage(ticketId: string): Promise<Partial<Record<CrStageKey, number>>> {
  const rows = await prisma.ticketAttachment.groupBy({ by: ["stageKey"], where: { ticketId, stageKey: { not: null } }, _count: { _all: true } });
  const out: Partial<Record<CrStageKey, number>> = {};
  for (const r of rows) {
    const k = asCrStage(r.stageKey);
    if (k) out[k] = r._count._all;
  }
  return out;
}
