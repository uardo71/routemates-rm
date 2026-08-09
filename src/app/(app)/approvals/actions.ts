"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canDecideApproval } from "@/lib/permissions";

export async function decideApprovalsAction(
  cardIds: string[],
  decision: "APPROVED" | "REJECTED",
  comment?: string
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (cardIds.length === 0) return { error: "Nothing selected." };

  const cards = await prisma.timeCard.findMany({ where: { id: { in: cardIds } } });
  if (cards.length !== cardIds.length) return { error: "One or more lines were not found." };

  for (const card of cards) {
    if (!canDecideApproval(user, card)) {
      return { error: "You do not have permission to decide one or more of these." };
    }
    if (card.status !== "SUBMITTED") {
      return { error: "One or more lines have already been decided." };
    }
  }

  // approverId was only ever a pre-assignment (the project's manager, set at submit time so the
  // right person's queue picks it up) — once someone actually decides it, that field should record
  // who really made the call, which can differ (e.g. an Admin deciding on a PM's behalf).
  await prisma.timeCard.updateMany({
    where: { id: { in: cardIds } },
    data: { status: decision, comment: comment?.trim() || null, decidedAt: new Date(), approverId: user.id },
  });

  revalidatePath("/approvals");
  revalidatePath("/time");
  return {};
}
