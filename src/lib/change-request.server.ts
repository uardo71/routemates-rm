import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { EMPTY_CR_DRAFT, asCrStage, type CrDraft, type CrStageKey } from "@/lib/change-request";
import { crDraftFromValues } from "@/lib/change-request-fields";
import { loadTicketConfig, type LoadedField } from "@/lib/ticket-config.server";

const d10 = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** The record as the form's text fields. Values come from the stage-scoped custom fields
 *  (migration 20260912092000); only the next step still lives on the ChangeRequest row. */
export function crDraftFrom(
  row: { nextStep: string | null; nextStepOwnerId: string | null; nextStepDue: Date | null } | null,
  stageFields: Pick<LoadedField, "id" | "key">[],
  valueByFieldId: Map<string, unknown>,
): CrDraft {
  const byFieldKey: Record<string, unknown> = {};
  for (const f of stageFields) byFieldKey[f.key] = valueByFieldId.get(f.id);
  return {
    ...EMPTY_CR_DRAFT,
    ...crDraftFromValues(byFieldKey),
    nextStep: row?.nextStep ?? "",
    nextStepOwnerId: row?.nextStepOwnerId ?? "",
    nextStepDue: d10(row?.nextStepDue ?? null),
  };
}

/** The same draft, loaded on its own (the gate checks need it outside the ticket page's query). */
export async function loadCrDraft(ticketId: string, companyId: string, typeId: string): Promise<CrDraft> {
  const [row, values, cfg] = await Promise.all([
    prisma.changeRequest.findUnique({ where: { ticketId }, select: { nextStep: true, nextStepOwnerId: true, nextStepDue: true } }),
    prisma.ticketFieldValue.findMany({ where: { ticketId }, select: { fieldId: true, value: true } }),
    loadTicketConfig(companyId),
  ]);
  const stageFields = cfg.types.find((t) => t.id === typeId)?.stageFields ?? [];
  return crDraftFrom(row, stageFields, new Map(values.map((v) => [v.fieldId, v.value])));
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
