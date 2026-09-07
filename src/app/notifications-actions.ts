"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { loadNotifications, type NotificationItem } from "@/lib/notifications";

/** Poll endpoint for the notification bell (staff + portal). */
export async function getMyNotificationsAction(): Promise<{ items: NotificationItem[]; unread: number }> {
  const user = await requireUser();
  return loadNotifications(user.id);
}

export async function markNotificationReadAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  await prisma.ticketNotification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return {};
}

export async function markAllNotificationsReadAction(): Promise<{ error?: string }> {
  const user = await requireUser();
  await prisma.ticketNotification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  return {};
}
