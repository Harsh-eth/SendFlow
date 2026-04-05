import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { TRANSFER_LIMITS } from "@sendflow/plugin-intent-parser";
import { alert } from "./adminAlerter";
import { behavioralConfirmKeyboard } from "./keyboards";
import type { InlineKeyboard } from "./keyboards";

const dataRoot = () => process.env.SENDFLOW_DATA_DIR?.trim() || pathJoin(process.cwd(), "data");
const DATA_BEHAVIOR = () => pathJoin(dataRoot(), "behavior");
const DATA_FROZEN = () => pathJoin(dataRoot(), "frozen");

const EMA_ALPHA = 0.1;
const MAX_INTERVAL_SAMPLES = 50;
const MAX_AMOUNTS = 20;
const MAX_RECIPIENTS = 10;
const MAX_HOUR_SAMPLES = 50;
const SESSION_GAP_MS = 30 * 60 * 1000;
const DORMANT_MS = 7 * 24 * 60 * 60 * 1000;
const BEHAVIORAL_PENDING_TTL_MS = 120_000;

export interface BehaviorProfile {
  avgMessageIntervalMs: number;
  typicalActiveHoursUTC: number[];
  typicalAmounts: number[];
  typicalRecipients: string[];
  sessionCount: number;
  lastSeenAt: number;
  /** Last message timestamp (for intervals & dormant) */
  lastMessageAt: number | null;
  /** Rolling UTC hours for last messages (max 50) */
  recentHoursUTC: number[];
  /** If true, next transfer scoring may apply dormant + large amount */
  pendingDormantResume: boolean;
  /** Interval (ms) between the previous and current message; used for anomaly scoring */
  lastMessageIntervalMs: number | null;
}

const defaultProfile = (): BehaviorProfile => ({
  avgMessageIntervalMs: 60_000,
  typicalActiveHoursUTC: [],
  typicalAmounts: [],
  typicalRecipients: [],
  sessionCount: 0,
  lastSeenAt: 0,
  lastMessageAt: null,
  recentHoursUTC: [],
  pendingDormantResume: false,
  lastMessageIntervalMs: null,
});

function profilePath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return pathJoin(DATA_BEHAVIOR(), `${safe}.json`);
}

export async function loadProfile(userId: string): Promise<BehaviorProfile> {
  try {
    const raw = await readFile(profilePath(userId), "utf8");
    const p = JSON.parse(raw) as BehaviorProfile;
    if (typeof p.avgMessageIntervalMs !== "number") return defaultProfile();
    return {
      ...defaultProfile(),
      ...p,
      recentHoursUTC: Array.isArray(p.recentHoursUTC) ? p.recentHoursUTC : [],
      lastMessageIntervalMs:
        typeof p.lastMessageIntervalMs === "number" || p.lastMessageIntervalMs === null
          ? p.lastMessageIntervalMs
          : null,
    };
  } catch {
    return defaultProfile();
  }
}

async function saveProfile(userId: string, p: BehaviorProfile): Promise<void> {
  await mkdir(DATA_BEHAVIOR(), { recursive: true });
  await writeFile(profilePath(userId), JSON.stringify(p, null, 2), "utf8");
}

function updateTypicalHours(hours: number[]): number[] {
  const counts = new Map<number, number>();
  for (const h of hours) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return [];
  const maxC = entries[0]![1];
  const threshold = Math.max(1, Math.ceil(maxC * 0.35));
  return entries.filter(([, c]) => c >= threshold).map(([h]) => h);
}

/**
 * Call on every inbound message (before heavy handlers).
 */
export async function recordUserMessage(userId: string): Promise<void> {
  const now = Date.now();
  const p = await loadProfile(userId);
  if (p.lastSeenAt === 0) p.lastSeenAt = now;

  if (p.lastMessageAt !== null) {
    const gap = now - p.lastMessageAt;
    if (gap > SESSION_GAP_MS) {
      p.sessionCount += 1;
    }
    const interval = Math.min(gap, 24 * 60 * 60 * 1000);
    p.lastMessageIntervalMs = interval;
    p.avgMessageIntervalMs =
      p.avgMessageIntervalMs === 0
        ? interval
        : EMA_ALPHA * interval + (1 - EMA_ALPHA) * p.avgMessageIntervalMs;
  }

  if (p.lastMessageAt !== null && now - p.lastMessageAt > DORMANT_MS) {
    p.pendingDormantResume = true;
  }

  const hour = new Date(now).getUTCHours();
  p.recentHoursUTC.push(hour);
  if (p.recentHoursUTC.length > MAX_HOUR_SAMPLES) {
    p.recentHoursUTC = p.recentHoursUTC.slice(-MAX_HOUR_SAMPLES);
  }
  p.typicalActiveHoursUTC = updateTypicalHours(p.recentHoursUTC);

  p.lastMessageAt = now;
  p.lastSeenAt = now;
  await saveProfile(userId, p);
}

/**
 * Call after a successful transfer to enrich amount/recipient baselines.
 */
export async function recordTransferForProfile(userId: string, amountUsdc: number, recipientAddress: string): Promise<void> {
  const p = await loadProfile(userId);
  p.typicalAmounts.push(amountUsdc);
  if (p.typicalAmounts.length > MAX_AMOUNTS) {
    p.typicalAmounts = p.typicalAmounts.slice(-MAX_AMOUNTS);
  }
  const r = recipientAddress.trim();
  if (r && !p.typicalRecipients.includes(r)) {
    p.typicalRecipients.push(r);
    if (p.typicalRecipients.length > MAX_RECIPIENTS) {
      p.typicalRecipients = p.typicalRecipients.slice(-MAX_RECIPIENTS);
    }
  }
  if (p.pendingDormantResume) {
    p.pendingDormantResume = false;
  }
  await saveProfile(userId, p);
}

export interface TransferEvent {
  amountUsdc: number;
  recipientAddress: string;
  utcHour: number;
  messageIntervalMs: number;
}

export interface AnomalyScore {
  score: number;
  triggers: string[];
}

export function computeAnomalyScore(profile: BehaviorProfile, event: TransferEvent): AnomalyScore {
  const triggers: string[] = [];
  let score = 0;

  const amounts = profile.typicalAmounts.length ? profile.typicalAmounts : [0];
  const maxTypical = Math.max(...amounts, 1e-9);

  if (event.amountUsdc > 3 * maxTypical && event.amountUsdc > TRANSFER_LIMITS.MULTISIG_THRESHOLD) {
    score += 40;
    triggers.push("amount_spike");
  }

  const normRec = event.recipientAddress.trim();
  if (!profile.typicalRecipients.includes(normRec) && event.amountUsdc > 20) {
    score += 25;
    triggers.push("new_recipient");
  }

  const hours = profile.typicalActiveHoursUTC;
  if (hours.length > 0 && profile.sessionCount > 5) {
    const h = event.utcHour;
    const matchesTypical = hours.some((th) => {
      const d = Math.abs(h - th);
      return Math.min(d, 24 - d) <= 1;
    });
    if (!matchesTypical) {
      score += 20;
      triggers.push("off_hours");
    }
  }

  if (profile.avgMessageIntervalMs > 0 && event.messageIntervalMs < profile.avgMessageIntervalMs * 0.3) {
    score += 30;
    triggers.push("fast_messages");
  }

  if (profile.pendingDormantResume && event.amountUsdc > 30) {
    score += 35;
    triggers.push("dormant_resume");
  }

  return { score, triggers };
}

export async function scoreAnomaly(userId: string, event: TransferEvent): Promise<AnomalyScore> {
  const profile = await loadProfile(userId);
  return computeAnomalyScore(profile, event);
}

export interface TelegramContext {
  chatId: string;
  sendHtml: (html: string) => Promise<void>;
  sendKeyboard: (html: string, keyboard: InlineKeyboard) => Promise<void>;
}

export type StepUpResult =
  | { proceed: true }
  | { proceed: false; kind: "inline"; pendingId: string; expiresAt: number }
  | { proceed: false; kind: "pin" };

export interface BehavioralPendingConfirm {
  id: string;
  userId: string;
  expiresAt: number;
}

const behavioralInlinePending = new Map<string, BehavioralPendingConfirm>();

export function setBehavioralPending(id: string, meta: BehavioralPendingConfirm): void {
  behavioralInlinePending.set(id, meta);
}

export function takeBehavioralPending(id: string): BehavioralPendingConfirm | undefined {
  const p = behavioralInlinePending.get(id);
  if (!p) return undefined;
  behavioralInlinePending.delete(id);
  return p;
}

export function peekBehavioralPending(id: string): BehavioralPendingConfirm | undefined {
  return behavioralInlinePending.get(id);
}

export function pruneExpiredBehavioralPending(): void {
  const now = Date.now();
  for (const [k, v] of behavioralInlinePending) {
    if (v.expiresAt < now) behavioralInlinePending.delete(k);
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * score < 30: proceed. 30–59: inline confirm. ≥60: PIN step-up.
 */
export async function stepUpIfNeededWithKeyboard(
  userId: string,
  anomaly: AnomalyScore,
  ctx: TelegramContext,
  buildKeyboard: (pendingId: string) => InlineKeyboard
): Promise<StepUpResult> {
  if (anomaly.score < 30) {
    return { proceed: true };
  }
  if (anomaly.score >= 60) {
    return { proceed: false, kind: "pin" };
  }
  const id = randomId();
  const expiresAt = Date.now() + BEHAVIORAL_PENDING_TTL_MS;
  setBehavioralPending(id, { id, userId, expiresAt });
  await ctx.sendKeyboard(
    [
      `⚠️ <b>Unusual transfer pattern</b>`,
      `Score: <b>${anomaly.score}</b> (${anomaly.triggers.join(", ") || "unknown"})`,
      ``,
      `Confirm this unusual transfer?`,
    ].join("\n"),
    buildKeyboard(id)
  );
  return { proceed: false, kind: "inline", pendingId: id, expiresAt };
}

/** Returns true when the transfer may proceed immediately (no step-up UI). */
export async function stepUpIfNeeded(userId: string, anomaly: AnomalyScore, ctx: TelegramContext): Promise<boolean> {
  const r = await stepUpIfNeededWithKeyboard(userId, anomaly, ctx, behavioralConfirmKeyboard);
  return r.proceed === true;
}

export interface FrozenRecord {
  frozenAt: number;
  reason: "user_requested" | "admin";
}

export function frozenPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return pathJoin(DATA_FROZEN(), `${safe}.json`);
}

export async function isFrozen(userId: string): Promise<boolean> {
  try {
    await readFile(frozenPath(userId), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function freezeAccount(userId: string, reason: FrozenRecord["reason"] = "user_requested"): Promise<void> {
  await mkdir(DATA_FROZEN(), { recursive: true });
  const rec: FrozenRecord = { frozenAt: Date.now(), reason };
  await writeFile(frozenPath(userId), JSON.stringify(rec, null, 2), "utf8");
}

export async function unfreezeAccount(userId: string): Promise<void> {
  try {
    await unlink(frozenPath(userId));
  } catch {
    /* noop */
  }
}

export async function notifyAdminFreeze(userId: string, kind: "freeze" | "unfreeze"): Promise<void> {
  if (kind === "freeze") {
    await alert("critical", "account.freeze", { userId, source: "user_or_admin" });
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!token || !admin) return;
  const text = `✅ Account unfrozen: ${userId}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: admin, text }),
  }).catch(() => {});
}
