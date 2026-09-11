"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canManageClientTickets } from "@/lib/permissions";
import { isOpenCategory } from "@/lib/ticket-config";
import { loadTicketConfig, findType, isStageMode, type LoadedType } from "@/lib/ticket-config.server";
import { decideStageMove, stageByKey, type StageDef } from "@/lib/ticket-stages";
import { tickedGateKeys } from "@/lib/ticket-stages.server";
import { notifyTicketParticipants, userName } from "@/lib/ticket-notify";

// Stage lifecycle actions for STAGE-mode ticket types: move between stages (gated by
// src/lib/ticket-stages.ts) and tick or untick one of the current stage's gates.
//
// The change request has its own pair in cr-actions.ts: its checks read a record rather than a
// manual tick, and it has a Rejected state outside the stage list. Both write the same ledger.

async function loadTicket(ticketId: string, companyId: string) {
  return prisma.ticket.findFirst({
    where: { id: ticketId, companyId },
    select: {
      id: true, clientId: true, requesterId: true, assigneeId: true, createdById: true, typeId: true,
      stageId: true, statusId: true, firstResponseAt: true,
      stageDef: { select: { key: true, name: true } },
      statusDef: { select: { key: true, name: true, category: true } },
    },
  });
}

type Access =
  | { error: string }
  | {
      user: Awaited<ReturnType<typeof requireUser>>;
      t: NonNullable<Awaited<ReturnType<typeof loadTicket>>>;
      type: LoadedType;
      stages: StageDef[];
      canManage: boolean;
      involved: boolean;
    };

async function access(ticketId: string): Promise<Access> {
  const user = await requireUser();
  const t = await loadTicket(ticketId, user.companyId);
  if (!t) return { error: "Not found" };
  const canManage = await canManageClientTickets(user, t.clientId);
  const involved = t.requesterId === user.id || t.assigneeId === user.id || t.createdById === user.id;
  if (!canManage && !involved) return { error: "Forbidden" };
  const type = findType(await loadTicketConfig(user.companyId), t.typeId);
  if (!type || !isStageMode(type)) return { error: "This ticket type doesn't run on stages." };
  return { user, t, type, stages: type.stages, canManage, involved };
}

/** Keep the legacy status in step with the stage's open/closed sense, so everything that counts
 *  tickets by status category (lists, the client overview, SLA) still reads a stage ticket right.
 *  Returns null when the status already says the same thing, or the type has no counterpart. */
function statusForStage(type: LoadedType, nowTerminal: boolean, currentCategory: string): string | null {
  const all = [...type.statuses, ...type.archivedStatuses];
  const wasOpen = isOpenCategory(currentCategory as never);
  if (nowTerminal && wasOpen) {
    const done = all.find((s) => s.category === "DONE") ?? all.find((s) => s.category === "CANCELLED");
    return done?.id ?? null;
  }
  if (!nowTerminal && !wasOpen) {
    const open = all.find((s) => s.isInitial && isOpenCategory(s.category)) ?? all.find((s) => isOpenCategory(s.category));
    return open?.id ?? null;
  }
  return null;
}

const MoveSchema = z.object({
  to: z.string().min(1).max(80),
  note: z.string().max(2000).optional(),
  overrideReason: z.string().max(1000).optional(),
});

export async function moveTicketStageAction(
  ticketId: string, input: { to: string; note?: string; overrideReason?: string },
): Promise<{ error?: string }> {
  const a = await access(ticketId);
  if ("error" in a) return { error: a.error };
  const { user, t, type, stages, canManage, involved } = a;
  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const fromKey = t.stageDef?.key ?? null;
  if (!fromKey) return { error: `This ticket isn't on one of ${type.name}'s stages yet — an administrator can set its stage in ticket settings.` };
  const to = stageByKey(stages, parsed.data.to);
  if (!to) return { error: "Unknown stage." };
  const from = stageByKey(stages, fromKey)!;

  const note = parsed.data.note?.trim() || null;
  const overrideReason = parsed.data.overrideReason?.trim() || null;
  const decision = decideStageMove({
    stages, from: fromKey, to: to.key, ticked: await tickedGateKeys(ticketId),
    canManage, involved, note, overrideReason,
  });
  if (!decision.ok) return { error: decision.error };

  const stageRow = type.stages.find((s) => s.key === to.key)!;
  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = { stageId: stageRow.id };
  if (!t.firstResponseAt) data.firstResponseAt = now;
  const wasOpen = isOpenCategory(t.statusDef.category);
  if (to.isTerminal && wasOpen) { data.resolvedAt = now; data.closedAt = now; }
  if (!to.isTerminal && !wasOpen) { data.resolvedAt = null; data.closedAt = null; }
  const statusId = statusForStage(type, to.isTerminal, t.statusDef.category);
  if (statusId) data.statusId = statusId;

  const body = [`${from.name} → ${to.name}`, note, decision.overridden ? `checks overridden: ${overrideReason}` : null]
    .filter(Boolean).join(" — ");
  const kind = to.isTerminal ? "RESOLVED" : decision.kind === "REOPEN" ? "REOPENED" : "STATUS";
  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id: ticketId }, data });
    await tx.changeRequestStageEvent.create({
      data: {
        ticketId, fromKey: from.key, toKey: to.key, move: decision.kind,
        note, overrideReason: decision.overridden ? overrideReason : null, byId: user.id,
      },
    });
    await tx.ticketComment.create({ data: { ticketId, authorId: user.id, kind, body, internal: false } });
  });
  await notifyTicketParticipants({
    ticketId, companyId: user.companyId, actorId: user.id, actorName: await userName(user.id),
    kind: "STATUS", summary: `moved the ticket to ${to.name}`,
  });
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return {};
}

/** Tick or untick one gate of the ticket's current stage. Only the current stage's gates can be
 *  changed — an earlier stage's ticks are history, and a later stage's aren't due yet. */
export async function setGateCheckAction(ticketId: string, gateKey: string, ok: boolean): Promise<{ error?: string }> {
  const a = await access(ticketId);
  if ("error" in a) return { error: a.error };
  const { user, t, type } = a;
  const stage = t.stageDef ? type.stages.find((s) => s.key === t.stageDef!.key) : null;
  if (!stage) return { error: "This ticket isn't on one of the type's stages." };
  const gateId = stage.gateIdByKey[gateKey];
  if (!gateId) return { error: `"${gateKey}" isn't one of ${stage.name}'s checks.` };

  if (ok) {
    await prisma.ticketGateCheck.upsert({
      where: { ticketId_gateId: { ticketId, gateId } },
      create: { ticketId, gateId, checkedById: user.id },
      update: {},
    });
  } else {
    await prisma.ticketGateCheck.deleteMany({ where: { ticketId, gateId } });
  }
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}
