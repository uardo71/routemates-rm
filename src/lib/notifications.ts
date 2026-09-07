import "server-only";
import { prisma } from "@/lib/prisma";

export type NotificationItem = {
  id: string; ticketId: string; ticketNumber: string; kind: string;
  actorName: string; summary: string; createdAt: string; read: boolean;
};

/** Latest notifications + unread count for a user (works for staff and portal customers). */
export async function loadNotifications(userId: string): Promise<{ items: NotificationItem[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.ticketNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { ticket: { select: { number: true } } },
    }),
    prisma.ticketNotification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id, ticketId: r.ticketId, ticketNumber: r.ticket.number, kind: r.kind,
      actorName: r.actorName, summary: r.summary, createdAt: r.createdAt.toISOString(), read: r.readAt !== null,
    })),
    unread,
  };
}
