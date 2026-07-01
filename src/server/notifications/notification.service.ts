import "server-only";

import { NotificationType } from "@prisma/client";
import type { NotificationItem } from "@/lib/types";
import { getDb } from "@/server/db";
import { AppError } from "@/server/shared/errors";

function toNotificationDto(notification: {
  id: string;
  title: string;
  message: string;
  link: string | null;
  type: NotificationType;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    link: notification.link,
    type: notification.type,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  } satisfies NotificationItem;
}

export async function listNotificationsForUser(userId: string, limit = 8) {
  const db = getDb();
  const notifications = await db.notification.findMany({
    where: { userId },
    take: limit,
    orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
  });

  return notifications.map(toNotificationDto);
}

export async function getUnreadNotificationCount(userId: string) {
  const db = getDb();

  return db.notification.count({
    where: {
      userId,
      readAt: null,
    },
  });
}

export async function createNotification(input: {
  userId: string;
  title: string;
  message: string;
  link?: string;
  type?: NotificationType;
}) {
  const db = getDb();

  return db.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      message: input.message,
      link: input.link,
      type: input.type ?? NotificationType.INFO,
    },
  });
}

export async function createNotifications(
  notifications: Array<{
    userId: string;
    title: string;
    message: string;
    link?: string;
    type?: NotificationType;
  }>,
) {
  if (!notifications.length) {
    return;
  }

  const db = getDb();

  await db.notification.createMany({
    data: notifications.map((notification) => ({
      userId: notification.userId,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      type: notification.type ?? NotificationType.INFO,
    })),
  });
}

export async function markNotificationAsRead(id: string, userId: string) {
  const db = getDb();
  const notification = await db.notification.findUnique({ where: { id } });

  if (!notification || notification.userId !== userId) {
    throw new AppError("ไม่พบการแจ้งเตือนที่ต้องการ", 404);
  }

  await db.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}
