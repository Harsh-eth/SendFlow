import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSync, hashSync } from "bcryptjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIN_DIR = join(__dirname, "..", "..", "data", "pins");

const failedAttempts = new Map<string, { count: number; blockedUntil?: number }>();

function pinPath(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(PIN_DIR, `${safe}.json`);
}

interface PinRecord {
  hash: string;
}

export async function setupPin(userId: string, pin: string): Promise<void> {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN must be 6 digits");
  const hash = hashSync(pin, 10);
  await mkdir(PIN_DIR, { recursive: true });
  await writeFile(pinPath(userId), JSON.stringify({ hash } satisfies PinRecord), "utf8");
}

export async function verifyPin(userId: string, pin: string): Promise<boolean> {
  try {
    const raw = await readFile(pinPath(userId), "utf8");
    const { hash } = JSON.parse(raw) as PinRecord;
    return compareSync(pin, hash);
  } catch {
    return false;
  }
}

export async function hasPin(userId: string): Promise<boolean> {
  try {
    await readFile(pinPath(userId), "utf8");
    return true;
  } catch {
    return false;
  }
}

export function generateOTP(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function recordPinFailure(userId: string): { blocked: boolean; blockedUntil?: number } {
  const cur = failedAttempts.get(userId) ?? { count: 0 };
  cur.count += 1;
  if (cur.count >= 3) {
    cur.blockedUntil = Date.now() + 10 * 60_000;
    cur.count = 0;
  }
  failedAttempts.set(userId, cur);
  return { blocked: Boolean(cur.blockedUntil), blockedUntil: cur.blockedUntil };
}

export function isPinBlocked(userId: string): boolean {
  const cur = failedAttempts.get(userId);
  if (!cur?.blockedUntil) return false;
  if (Date.now() >= cur.blockedUntil) {
    failedAttempts.delete(userId);
    return false;
  }
  return true;
}

export function clearPinFailures(userId: string): void {
  failedAttempts.delete(userId);
}
