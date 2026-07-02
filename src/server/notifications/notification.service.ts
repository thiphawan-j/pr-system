import "server-only";

import { NotificationType } from "@prisma/client";
import type { NotificationItem } from "@/lib/types";
import { getDb } from "@/server/db";
import {
  isEmailDeliveryEnabled,
  sendNotificationEmail,
} from "@/server/email/email.service";
import { AppError } from "@/server/shared/errors";

type NotificationDraft = {
  userId: string;
  title: string;
  message: string;
  link?: string;
  type?: NotificationType;
};

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

async function deliverNotificationEmails(notifications: NotificationDraft[]) {
  if (!notifications.length || !isEmailDeliveryEnabled()) {
    return;
  }

  const db = getDb();
  const recipientIds = Array.from(
    new Set(notifications.map((notification) => notification.userId)),
  );
  const recipients = await db.user.findMany({
    where: {
      id: {
        in: recipientIds,
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });
  const recipientsById = new Map(recipients.map((recipient) => [recipient.id, recipient]));

  const results = await Promise.allSettled(
    notifications.map(async (notification) => {
      const recipient = recipientsById.get(notification.userId);

      if (!recipient?.email) {
        return;
      }

      await sendNotificationEmail({
        email: recipient.email,
        name: recipient.name,
        title: notification.title,
        message: notification.message,
        link: notification.link,
      });
    }),
  );

  const failures = results.filter((result) => result.status === "rejected");

  if (failures.length) {
    console.error(
      `Failed to send ${failures.length} notification email(s)`,
      failures.map((failure) =>
        failure.status === "rejected"
          ? failure.reason
          : null,
      ),
    );
  }
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

  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      message: input.message,
      link: input.link,
      type: input.type ?? NotificationType.INFO,
    },
  });

  await deliverNotificationEmails([input]);

  return notification;
}

export async function createNotifications(notifications: NotificationDraft[]) {
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

  await deliverNotificationEmails(notifications);
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
