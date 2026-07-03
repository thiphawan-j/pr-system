import { getDictionary, getIntlLocale, type Locale, defaultLocale } from "@/lib/i18n";
import type { ApprovalAction, Priority, PurchaseRequestStatus } from "@/lib/types";

export const appTimeZone = "Asia/Bangkok";

const bangkokUtcOffset = "+07:00";

type DateInput = string | Date;

function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value);
}

function getBangkokDateTimeParts(value: DateInput) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: appTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

export function toBangkokDateValue(value: DateInput = new Date()) {
  const { year, month, day } = getBangkokDateTimeParts(value);

  return `${year}-${month}-${day}`;
}

export function toBangkokMonthValue(value: DateInput) {
  const { year, month } = getBangkokDateTimeParts(value);

  return `${year}-${month}`;
}

export function toBangkokIsoString(value: DateInput) {
  const { year, month, day, hour, minute, second } = getBangkokDateTimeParts(value);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${bangkokUtcOffset}`;
}

export function toUtcStartOfDayFromDateValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toUtcEndOfDayFromDateValue(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

export function formatCurrency(value: number, locale: Locale = defaultLocale) {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatNumber(value: number, locale: Locale = defaultLocale) {
  return value.toLocaleString(getIntlLocale(locale));
}

export function formatDate(value: string | Date, locale: Locale = defaultLocale) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(
  value: string | Date,
  locale: Locale = defaultLocale,
) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    timeZone: appTimeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatStatus(
  status: PurchaseRequestStatus,
  locale: Locale = defaultLocale,
) {
  return getDictionary(locale).statuses[status];
}

export function formatPriority(priority: Priority, locale: Locale = defaultLocale) {
  return getDictionary(locale).priorities[priority];
}

export function formatApprovalAction(
  action: ApprovalAction,
  locale: Locale = defaultLocale,
) {
  return getDictionary(locale).approvalActions[action];
}

export function formatFileSize(bytes: number, locale: Locale = defaultLocale) {
  const units = ["B", "KB", "MB", "GB"] as const;
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat(getIntlLocale(locale), {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(size)} ${units[unitIndex]}`;
}

export function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
