import { extractSolanaAddress } from "./solanaAddress";
import { extractSolDomain } from "./resolveDomain";

/** Lightweight amount parse for phone-send (avoids circular import with parseRemittanceIntent). */
function extractAmountQuick(text: string): number | null {
  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,6})?)/);
  if (dollar?.[1]) return Number(dollar[1]);
  const usd = text.match(/\bUSD\s*([0-9]+(?:\.[0-9]{1,6})?)\b/i);
  if (usd?.[1]) return Number(usd[1]);
  const stp = text.match(/\b(?:send|transfer|pay)\s+(\d+(?:\.\d+)?)\b/i);
  if (stp?.[1]) return Number(stp[1]);
  const usdcAlt = text.match(/\b(\d+(?:\.\d+)?)\s*(usdc|usd)\b/i);
  if (usdcAlt?.[1]) return Number(usdcAlt[1]);
  return null;
}

/** Loose phone segment: optional +, digits/spaces/dashes, 7–15 chars of “phone-ish” content after collapse. */
const PHONE_SEGMENT = /\+?[\d\s\-]{7,15}/;

/**
 * Normalize for storage / Twilio: strip spaces and dashes; ensure leading +.
 * US 10-digit numbers get +1. Otherwise prefix + if missing.
 */
export function normalizePhoneNumber(raw: string): string {
  const trimmed = raw.trim();
  const noSep = trimmed.replace(/[\s-]/g, "");
  if (!noSep) return "";
  const digits = noSep.replace(/\D/g, "");
  if (!digits) return "";
  if (noSep.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export interface PhoneRemittanceDetect {
  normalizedPhone: string;
  amount: number;
}

/**
 * True when message looks like a remittance to a phone (amount + phone segment) and
 * does not also carry a Solana recipient (address or .sol).
 */
export function tryExtractPhoneRemittance(userText: string): PhoneRemittanceDetect | null {
  const amount = extractAmountQuick(userText);
  if (amount == null || amount <= 0) return null;
  if (extractSolanaAddress(userText)) return null;
  if (extractSolDomain(userText)) return null;
  if (/\bsendflow\/[a-z0-9_]{3,20}\b/i.test(userText)) return null;

  const m = userText.match(PHONE_SEGMENT);
  if (!m?.[0]) return null;
  const normalizedPhone = normalizePhoneNumber(m[0]);
  const digitCount = normalizedPhone.replace(/\D/g, "").length;
  if (digitCount < 7 || digitCount > 15) return null;
  return { normalizedPhone, amount };
}
