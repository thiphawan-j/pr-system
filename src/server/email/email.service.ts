import "server-only";

import { appName } from "@/lib/constants";

type NotificationEmailInput = {
  email: string;
  name?: string | null;
  title: string;
  message: string;
  link?: string | null;
};

type NotificationEmailDeliveryResult = {
  messageId: string | null;
};

type EmailSettings = {
  apiKey: string;
  from: string;
  replyTo?: string;
  appUrl?: string;
  subjectPrefix: string;
};

function getEmailSettings(): EmailSettings | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();

  if (!apiKey || !from) {
    return null;
  }

  return {
    apiKey,
    from,
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    appUrl: process.env.APP_URL?.trim() || undefined,
    subjectPrefix:
      process.env.EMAIL_SUBJECT_PREFIX?.trim() || appName,
  };
}

export function isEmailDeliveryEnabled() {
  return getEmailSettings() !== null;
}

function toAbsoluteUrl(link: string | null | undefined, appUrl?: string) {
  if (!link) {
    return null;
  }

  if (/^https?:\/\//i.test(link)) {
    return link;
  }

  if (!appUrl) {
    return null;
  }

  try {
    return new URL(link, appUrl).toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildSubject(title: string, subjectPrefix: string) {
  return `${subjectPrefix} | ${title}`;
}

function buildTextBody(input: NotificationEmailInput, actionUrl: string | null) {
  return [
    input.name ? `สวัสดี ${input.name},` : "สวัสดี,",
    "",
    input.title,
    input.message,
    actionUrl ? `เปิดรายการ: ${actionUrl}` : null,
    "",
    `ข้อความนี้ส่งจาก ${appName}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHtmlBody(input: NotificationEmailInput, actionUrl: string | null) {
  const safeTitle = escapeHtml(input.title);
  const safeMessage = escapeHtml(input.message);
  const safeName = input.name ? escapeHtml(input.name) : null;
  const safeUrl = actionUrl ? escapeHtml(actionUrl) : null;

  return `
    <div style="margin:0;background:#f5f7fb;padding:32px 16px;font-family:'Noto Sans Thai',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="margin:0 auto;max-width:560px;overflow:hidden;border-radius:20px;background:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#0f766e,#155e75);padding:24px 28px;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.82;">${escapeHtml(appName)}</p>
          <h1 style="margin:0;font-size:22px;line-height:1.4;">${safeTitle}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.8;">${safeName ? `สวัสดี ${safeName},` : "สวัสดี,"}</p>
          <p style="margin:0;font-size:15px;line-height:1.8;color:#334155;">${safeMessage}</p>
          ${
            safeUrl
              ? `<p style="margin:24px 0 0;"><a href="${safeUrl}" style="display:inline-block;border-radius:999px;background:#0f766e;padding:12px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">เปิดรายการ</a></p>`
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

export async function sendNotificationEmail(
  input: NotificationEmailInput,
): Promise<NotificationEmailDeliveryResult> {
  const settings = getEmailSettings();

  if (!settings) {
    return { messageId: null };
  }

  const actionUrl = toAbsoluteUrl(input.link, settings.appUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: settings.from,
      to: input.email,
      reply_to: settings.replyTo,
      subject: buildSubject(input.title, settings.subjectPrefix),
      text: buildTextBody(input, actionUrl),
      html: buildHtmlBody(input, actionUrl),
    }),
  });
  const rawPayload = await response.text();
  let payload: { id?: unknown; message?: unknown } | null = null;

  if (rawPayload) {
    try {
      payload = JSON.parse(rawPayload) as { id?: unknown; message?: unknown };
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? JSON.stringify(payload)
        : rawPayload;
    throw new Error(
      `Failed to send notification email to ${input.email}: ${response.status} ${detail}`,
    );
  }

  return {
    messageId: typeof payload?.id === "string" ? payload.id : null,
  };
}
