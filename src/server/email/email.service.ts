import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
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

type MailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

type EmailSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  appUrl: string;
};

let transporter: Transporter | null = null;
let transporterKey: string | null = null;

function parseSmtpPort(value: string | undefined) {
  if (!value) {
    return null;
  }

  const port = Number(value);

  return Number.isInteger(port) && port > 0 ? port : null;
}

function parseSmtpSecure(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no"].includes(normalized)) {
    return false;
  }

  return null;
}

function getEmailSettings(): EmailSettings | null {
  const host = process.env.SMTP_HOST?.trim();
  const port = parseSmtpPort(process.env.SMTP_PORT?.trim());
  const secure = parseSmtpSecure(process.env.SMTP_SECURE);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();
  const appUrl = process.env.APP_URL?.trim();

  if (!host || !port || secure === null || !user || !pass || !from || !appUrl) {
    return null;
  }

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    appUrl,
  };
}

export function isEmailDeliveryEnabled() {
  return getEmailSettings() !== null;
}

function getTransporter(settings: EmailSettings): Transporter {
  const nextTransporterKey = [
    settings.host,
    settings.port,
    settings.secure,
    settings.user,
    settings.from,
  ].join("|");

  if (transporter && transporterKey === nextTransporterKey) {
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  });
  transporterKey = nextTransporterKey;

  return transporter;
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

function buildSubject(title: string) {
  return `${appName} | ${title}`;
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

export async function sendMail(
  input: MailInput,
): Promise<NotificationEmailDeliveryResult> {
  const settings = getEmailSettings();

  if (!settings) {
    return { messageId: null };
  }

  const result = await getTransporter(settings).sendMail({
    from: settings.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return {
    messageId: typeof result.messageId === "string" ? result.messageId : null,
  };
}

export async function sendNotificationEmail(
  input: NotificationEmailInput,
): Promise<NotificationEmailDeliveryResult> {
  const settings = getEmailSettings();

  if (!settings) {
    return { messageId: null };
  }

  const actionUrl = toAbsoluteUrl(input.link, settings.appUrl);
  return sendMail({
    to: input.email,
    subject: buildSubject(input.title),
    text: buildTextBody(input, actionUrl),
    html: buildHtmlBody(input, actionUrl),
  });
}
