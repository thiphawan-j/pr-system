import "server-only";

import { randomUUID } from "node:crypto";

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

type MailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type EmailSettings = {
  provider: "google_apps_script";
  webhookUrl: string;
  webhookSecret: string;
  fromName: string;
  appUrl?: string;
};

const googleAppsScriptProvider = "google_apps_script";
const emailGatewayTimeoutMs = 10_000;

function parseHttpsUrl(value: string | undefined) {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function getEmailSettings(): EmailSettings | null {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const webhookUrl = parseHttpsUrl(process.env.GOOGLE_MAIL_WEBHOOK_URL);
  const webhookSecret = process.env.GOOGLE_MAIL_WEBHOOK_SECRET;
  const fromName = process.env.EMAIL_FROM_NAME?.trim();
  const appUrl = process.env.APP_URL?.trim();

  if (
    provider !== googleAppsScriptProvider ||
    !webhookUrl ||
    !webhookSecret?.trim() ||
    !fromName
  ) {
    return null;
  }

  return {
    provider,
    webhookUrl,
    webhookSecret,
    fromName,
    appUrl,
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

function buildSubject(title: string, fromName: string) {
  return `${fromName} | ${title}`;
}

function buildTextBody(
  input: NotificationEmailInput,
  actionUrl: string | null,
  fromName: string,
) {
  return [
    input.name ? `สวัสดี ${input.name},` : "สวัสดี,",
    "",
    input.title,
    input.message,
    actionUrl ? `เปิดรายการ: ${actionUrl}` : null,
    "",
    `ข้อความนี้ส่งจาก ${fromName}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildHtmlBody(
  input: NotificationEmailInput,
  actionUrl: string | null,
  fromName: string,
) {
  const safeTitle = escapeHtml(input.title);
  const safeMessage = escapeHtml(input.message);
  const safeName = input.name ? escapeHtml(input.name) : null;
  const safeUrl = actionUrl ? escapeHtml(actionUrl) : null;

  return `
    <div style="margin:0;background:#f5f7fb;padding:32px 16px;font-family:'Noto Sans Thai',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="margin:0 auto;max-width:560px;overflow:hidden;border-radius:20px;background:#ffffff;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#0f766e,#155e75);padding:24px 28px;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.82;">${escapeHtml(fromName)}</p>
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

function redactWebhookSecret(value: string, secret: string) {
  return value.replaceAll(secret, "[redacted]");
}

function getGatewayErrorDetail(payload: unknown, secret: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as { error?: unknown; message?: unknown };
  const detail =
    typeof candidate.error === "string"
      ? candidate.error
      : typeof candidate.message === "string"
        ? candidate.message
        : null;

  return detail
    ? redactWebhookSecret(detail, secret).slice(0, 500)
    : null;
}

async function postToGoogleMailGateway(
  settings: EmailSettings,
  input: MailInput,
): Promise<NotificationEmailDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), emailGatewayTimeoutMs);

  try {
    let response: Response;

    try {
      response = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          secret: settings.webhookSecret,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html ?? "",
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Google Mail gateway timed out after ${emailGatewayTimeoutMs}ms`,
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Google Mail gateway request failed: ${redactWebhookSecret(message, settings.webhookSecret)}`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new Error(
          `Google Mail gateway timed out after ${emailGatewayTimeoutMs}ms`,
        );
      }

      if (!response.ok) {
        throw new Error(`Google Mail gateway returned HTTP ${response.status}`);
      }

      throw new Error("Google Mail gateway returned invalid JSON");
    }

    if (!response.ok) {
      const detail = getGatewayErrorDetail(payload, settings.webhookSecret);
      throw new Error(
        `Google Mail gateway returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      (payload as { ok?: unknown }).ok !== true
    ) {
      const detail = getGatewayErrorDetail(payload, settings.webhookSecret);
      throw new Error(
        `Google Mail gateway did not confirm delivery${detail ? `: ${detail}` : ""}`,
      );
    }

    return {
      messageId: `google-apps-script:${randomUUID()}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendMail(
  input: MailInput,
): Promise<NotificationEmailDeliveryResult> {
  const settings = getEmailSettings();

  if (!settings) {
    throw new Error("Email delivery is disabled");
  }

  return postToGoogleMailGateway(settings, input);
}

export async function sendNotificationEmail(
  input: NotificationEmailInput,
): Promise<NotificationEmailDeliveryResult> {
  const settings = getEmailSettings();

  if (!settings) {
    throw new Error("Email delivery is disabled");
  }

  const actionUrl = toAbsoluteUrl(input.link, settings.appUrl);
  return postToGoogleMailGateway(settings, {
    to: input.email,
    subject: buildSubject(input.title, settings.fromName),
    text: buildTextBody(input, actionUrl, settings.fromName),
    html: buildHtmlBody(input, actionUrl, settings.fromName),
  });
}
