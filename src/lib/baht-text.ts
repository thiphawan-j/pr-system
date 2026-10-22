const digitNames = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const placeNames = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function readGroup(digits: string, hasHigherGroup: boolean) {
  let text = "";

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const place = digits.length - index - 1;
    if (digit === 0) continue;

    if (place === 0 && digit === 1 && (text.length > 0 || hasHigherGroup)) {
      text += "เอ็ด";
    } else if (place === 1) {
      text += digit === 1 ? "สิบ" : digit === 2 ? "ยี่สิบ" : `${digitNames[digit]}สิบ`;
    } else {
      text += `${digitNames[digit]}${placeNames[place]}`;
    }
  }

  return text;
}

function readInteger(digits: string) {
  const normalized = digits.replace(/^0+/, "") || "0";
  if (normalized === "0") return "ศูนย์";

  const firstGroupLength = normalized.length % 6 || 6;
  let text = readGroup(normalized.slice(0, firstGroupLength), false);

  for (let index = firstGroupLength; index < normalized.length; index += 6) {
    text += `ล้าน${readGroup(normalized.slice(index, index + 6), true)}`;
  }

  return text;
}

/**
 * Read an already established baht amount without rounding it again.
 * Prefer a canonical decimal string (for example, Decimal.toFixed(2)).
 * Missing, negative, imprecise, or otherwise invalid input has no amount text.
 */
export function toThaiBahtText(value: number | string | null): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) {
    return null;
  }

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return null;

  const baht = readInteger(match[1]);
  const satang = (match[2] ?? "").padEnd(2, "0");

  return satang === "00"
    ? `${baht}บาทถ้วน`
    : `${baht}บาท${readInteger(satang)}สตางค์`;
}
