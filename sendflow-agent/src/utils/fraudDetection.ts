import { isBlocklistedWallet } from "@sendflow/plugin-intent-parser";
import { TRANSFER_LIMITS } from "./transferLimits";

export interface SuspiciousPattern {
  userId: string;
  pattern: string;
  severity: "low" | "medium" | "high";
  timestamp: string;
}

const recipientCounts = new Map<string, Map<string, number[]>>();
const lastTransferAt = new Map<string, number>();

function hourWindow(ts: number[]): number[] {
  const now = Date.now();
  return ts.filter((t) => now - t < 3_600_000);
}

export function analyzeMessage(_userId: string, text: string): SuspiciousPattern | null {
  const lower = text.toLowerCase();
  if (/\b(seed\s*phrase|private\s*key|give\s*me\s*your)\b/i.test(lower)) {
    return {
      userId: _userId,
      pattern: "phishing_language",
      severity: "high",
      timestamp: new Date().toISOString(),
    };
  }
  return null;
}

export function analyzeTransaction(
  userId: string,
  amount: number,
  recipient: string,
  opts?: { isNewUser?: boolean; maxTransferUsd?: number }
): SuspiciousPattern | null {
  const rec = recipient.trim();
  if (isBlocklistedWallet(rec)) {
    return {
      userId,
      pattern: "known_scam_wallet",
      severity: "high",
      timestamp: new Date().toISOString(),
    };
  }

  let map = recipientCounts.get(userId);
  if (!map) {
    map = new Map();
    recipientCounts.set(userId, map);
  }
  const arr = hourWindow(map.get(rec) ?? []);
  arr.push(Date.now());
  map.set(rec, arr);
  if (arr.length >= 3) {
    return {
      userId,
      pattern: "same_recipient_3x_hour",
      severity: "medium",
      timestamp: new Date().toISOString(),
    };
  }

  const maxT = opts?.maxTransferUsd ?? TRANSFER_LIMITS.MAX_USDC;
  if (amount >= maxT - 0.1 && amount <= maxT) {
    return {
      userId,
      pattern: "amount_at_limit",
      severity: "low",
      timestamp: new Date().toISOString(),
    };
  }

  if (opts?.isNewUser && amount >= maxT * 0.95) {
    return {
      userId,
      pattern: "new_user_max_amount",
      severity: "high",
      timestamp: new Date().toISOString(),
    };
  }

  const last = lastTransferAt.get(userId);
  const now = Date.now();
  if (last && now - last < 30_000) {
    return {
      userId,
      pattern: "rapid_fire_transfer",
      severity: "high",
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}

export function markTransferCompleted(userId: string): void {
  lastTransferAt.set(userId, Date.now());
}
