CREATE TYPE "NotificationEmailStatus" AS ENUM ('DISABLED', 'PENDING', 'SENT', 'FAILED', 'SKIPPED');

ALTER TABLE "Notification"
ADD COLUMN "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "emailSentAt" TIMESTAMP(3),
ADD COLUMN "emailError" TEXT,
ADD COLUMN "emailMessageId" TEXT;

UPDATE "Notification"
SET "emailStatus" = 'SKIPPED',
    "emailError" = 'Email delivery status was not tracked for this legacy notification';
