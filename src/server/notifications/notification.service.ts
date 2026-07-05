import "server-only";

import { NotificationEmailStatus, NotificationType } from "@prisma/client";
import { toBangkokIsoString } from "@/lib/format";
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
  link?: string | null;
  type?: NotificationType;
};

type PersistedNotificationDraft = NotificationDraft & {
  id: string;
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
    readAt: notification.readAt ? toBangkokIsoString(notification.readAt) : null,
    createdAt: toBangkokIsoString(notification.createdAt),
  } satisfies NotificationItem;
}

function toEmailStatusError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const smtpPass = process.env.SMTP_PASS;

  return smtpPass ? message.replaceAll(smtpPass, "[redacted]") : message;
}

async function createNotificationRecords(notifications: NotificationDraft[]) {
  if (!notifications.length) {
    return [];
  }

  const db = getDb();
  const initialEmailStatus = isEmailDeliveryEnabled()
    ? NotificationEmailStatus.PENDING
    : NotificationEmailStatus.DISABLED;
  const initialEmailError = isEmailDeliveryEnabled()
    ? null
    : "Email delivery is disabled";

  return db.$transaction(
    notifications.map((notification) =>
      db.notification.create({
        data: {
          userId: notification.userId,
          title: notification.title,
          message: notification.message,
          link: notification.link,
          type: notification.type ?? NotificationType.INFO,
          emailStatus: initialEmailStatus,
          emailError: initialEmailError,
        },
      }),
    ),
  );
}

async function deliverNotificationEmails(notifications: PersistedNotificationDraft[]) {
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

  await Promise.all(
    notifications.map(async (notification) => {
      const recipient = recipientsById.get(notification.userId);

      if (!recipient?.email) {
        await db.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: NotificationEmailStatus.SKIPPED,
            emailError: "Recipient has no email address",
            emailSentAt: null,
            emailMessageId: null,
          },
        });
        return;
      }

      try {
        const result = await sendNotificationEmail({
          email: recipient.email,
          name: recipient.name,
          title: notification.title,
          message: notification.message,
          link: notification.link,
        });

        await db.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: NotificationEmailStatus.SENT,
            emailSentAt: new Date(),
            emailError: null,
            emailMessageId: result.messageId,
          },
        });
      } catch (error) {
        const emailError = toEmailStatusError(error);

        await db.notification.update({
          where: { id: notification.id },
          data: {
            emailStatus: NotificationEmailStatus.FAILED,
            emailError,
            emailSentAt: null,
            emailMessageId: null,
          },
        });

        console.error("Failed to send notification email", emailError);
      }
    }),
  );
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
  link?: string | null;
  type?: NotificationType;
}) {
  const [notification] = await createNotificationRecords([input]);

  await deliverNotificationEmails([notification]);

  return notification;
}

export async function createNotifications(notifications: NotificationDraft[]) {
  if (!notifications.length) {
    return;
  }

  const createdNotifications = await createNotificationRecords(notifications);

  await deliverNotificationEmails(createdNotifications);
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
