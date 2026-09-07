import "server-only";
import { prisma } from "@/lib/prisma";

/** Look up a user's display name (for the actorName snapshot on a notification). */
export async function userName(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? "Someone";
}

/** Notify everyone involved in a ticket (requester + assignee + anyone who commented), minus the
 *  actor. `staffOnly` drops customer recipients — used for internal notes. Summaries are kept
 *  generic (no status names) so nothing internal leaks to a customer's bell. */
export async function notifyTicketParticipants(opts: {
  ticketId: string; companyId: string; actorId: string; actorName: string; kind: string; summary: string; staffOnly?: boolean;
}): Promise<void> {
  const t = await prisma.ticket.findUnique({ where: { id: opts.ticketId }, select: { requesterId: true, assigneeId: true } });
  if (!t) return;
  const commenters = await prisma.ticketComment.findMany({
    where: { ticketId: opts.ticketId, kind: "COMMENT", deletedAt: null },
    select: { authorId: true }, distinct: ["authorId"],
  });
  const ids = new Set<string>([t.requesterId, ...(t.assigneeId ? [t.assigneeId] : []), ...commenters.map((c) => c.authorId)]);
  ids.delete(opts.actorId);
  let recipients = [...ids];
  if (opts.staffOnly && recipients.length) {
    const staff = await prisma.user.findMany({ where: { id: { in: recipients }, role: { not: "CUSTOMER" } }, select: { id: true } });
    recipients = staff.map((s) => s.id);
  }
  if (!recipients.length) return;
  await prisma.ticketNotification.createMany({
    data: recipients.map((uid) => ({ companyId: opts.companyId, userId: uid, ticketId: opts.ticketId, actorName: opts.actorName, kind: opts.kind, summary: opts.summary })),
  });
}

/** Notify one specific user (e.g. the new assignee). No-op if they're the actor. */
export async function notifyTicketUser(opts: {
  ticketId: string; companyId: string; userId: string; actorId: string; actorName: string; kind: string; summary: string;
}): Promise<void> {
  if (opts.userId === opts.actorId) return;
  await prisma.ticketNotification.create({
    data: { companyId: opts.companyId, userId: opts.userId, ticketId: opts.ticketId, actorName: opts.actorName, kind: opts.kind, summary: opts.summary },
  });
}
