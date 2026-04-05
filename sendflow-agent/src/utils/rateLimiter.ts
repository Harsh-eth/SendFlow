import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRANSFER_LIMITS } from "@sendflow/plugin-intent-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOCKLIST_PATH = join(__dirname, "..", "..", "data", "blocklist.json");

interface RateLimit {
  requests: number[];
  transfers: number[];
  failed: number[];
  blocked: boolean;
  blockedUntil?: number;
  violations: number;
  /** Soft throttle after rapid-fire messages (threat classifier burst). */
  classifierSoftUntil?: number;
}

const store = new Map<string, RateLimit>();

export const limits = {
  messages: { window: 60_000, max: TRANSFER_LIMITS.RATE_LIMIT_MESSAGES },
  transfers: { window: 3_600_000, max: TRANSFER_LIMITS.RATE_LIMIT_TRANSFERS },
  failed: { window: 300_000, max: 5 },
} as const;

let permanentBlock = new Set<string>();

async function loadBlocklist(): Promise<void> {
  try {
    const raw = await readFile(BLOCKLIST_PATH, "utf8");
    const data = JSON.parse(raw) as { blocked?: string[] };
    permanentBlock = new Set(data.blocked ?? []);
  } catch {
    permanentBlock = new Set();
  }
}

void loadBlocklist();

export async function persistBlocklist(): Promise<void> {
  await mkdir(dirname(BLOCKLIST_PATH), { recursive: true });
  await writeFile(BLOCKLIST_PATH, JSON.stringify({ blocked: [...permanentBlock] }, null, 2), "utf8");
}

function bucket(userId: string): RateLimit {
  let r = store.get(userId);
  if (!r) {
    r = { requests: [], transfers: [], failed: [], blocked: false, violations: 0 };
    store.set(userId, r);
  }
  return r;
}

function prune(arr: number[], windowMs: number, now: number): void {
  while (arr.length && now - arr[0]! > windowMs) arr.shift();
}

export function checkRateLimit(
  userId: string,
  type: keyof typeof limits
): { allowed: boolean; retryAfter?: number } {
  if (permanentBlock.has(userId)) {
    return { allowed: false, retryAfter: 86400 };
  }
  const now = Date.now();
  const r = bucket(userId);
  if (r.blocked && r.blockedUntil && now < r.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((r.blockedUntil - now) / 1000) };
  }
  if (r.blocked && r.blockedUntil && now >= r.blockedUntil) {
    r.blocked = false;
    r.blockedUntil = undefined;
  }

  const cfg = limits[type];
  const arr = type === "messages" ? r.requests : type === "transfers" ? r.transfers : r.failed;
  prune(arr, cfg.window, now);
  if (arr.length >= cfg.max) {
    const oldest = arr[0] ?? now;
    const retryAfter = Math.ceil((cfg.window - (now - oldest)) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
  }
  return { allowed: true };
}

export function recordRequest(userId: string, type: keyof typeof limits): void {
  const now = Date.now();
  const r = bucket(userId);
  const arr = type === "messages" ? r.requests : type === "transfers" ? r.transfers : r.failed;
  prune(arr, limits[type].window, now);
  arr.push(now);
}

export function recordViolation(userId: string): void {
  const r = bucket(userId);
  r.violations += 1;
  if (r.violations >= 3) {
    r.blocked = true;
    r.blockedUntil = Date.now() + 5 * 60_000;
  }
}

export function recordFailedAttempt(userId: string): void {
  recordRequest(userId, "failed");
  const r = bucket(userId);
  const now = Date.now();
  prune(r.failed, limits.failed.window, now);
  if (r.failed.length >= limits.failed.max) {
    r.blocked = true;
    r.blockedUntil = Date.now() + 5 * 60_000;
  }
}

export function isBlocked(userId: string): boolean {
  if (permanentBlock.has(userId)) return true;
  const r = store.get(userId);
  if (!r?.blocked) return false;
  if (r.blockedUntil && Date.now() >= r.blockedUntil) {
    r.blocked = false;
    r.blockedUntil = undefined;
    return false;
  }
  return true;
}

export async function blockUserPermanent(userId: string): Promise<void> {
  permanentBlock.add(userId);
  await persistBlocklist();
}

export async function unblockUser(userId: string): Promise<void> {
  permanentBlock.delete(userId);
  await persistBlocklist();
}

export function isPermanentlyBlocked(userId: string): boolean {
  return permanentBlock.has(userId);
}

/** 10s soft throttle after classifier burst skip (messages 2–5 in a 10s window). */
export function applyClassifierSoftThrottle(userId: string): void {
  const r = bucket(userId);
  r.classifierSoftUntil = Date.now() + 10_000;
}

export function isClassifierSoftThrottled(userId: string): boolean {
  const r = store.get(userId);
  if (!r?.classifierSoftUntil) return false;
  if (Date.now() >= r.classifierSoftUntil) {
    r.classifierSoftUntil = undefined;
    return false;
  }
  return true;
}

/** @internal tests */
export function resetClassifierThrottleForTests(userId?: string): void {
  if (userId) {
    const r = store.get(userId);
    if (r) r.classifierSoftUntil = undefined;
    return;
  }
  for (const r of store.values()) {
    r.classifierSoftUntil = undefined;
  }
}
