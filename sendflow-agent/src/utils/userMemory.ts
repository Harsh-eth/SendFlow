import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpeedMode } from "@sendflow/plugin-intent-parser";
import { loggerCompat as logger } from "./structuredLogger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data", "users");

export interface UserMemory {
  userId: string;
  displayName: string;
  preferredLanguage: string;
  defaultSpeedMode: SpeedMode;
  notifyOnReceive: boolean;
  monthlyBudget?: number;
  monthlySpent: number;
  monthlyResetAt: string;
  trustedWallets: string[];
  lastSeen: string;
  totalTransfers: number;
  totalVolume: number;
}

const memoryCache = new Map<string, UserMemory>();

function defaultMemory(userId: string): UserMemory {
  return {
    userId,
    displayName: "",
    preferredLanguage: "en",
    defaultSpeedMode: "normal",
    notifyOnReceive: false,
    monthlySpent: 0,
    monthlyResetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
    trustedWallets: [],
    lastSeen: new Date().toISOString(),
    totalTransfers: 0,
    totalVolume: 0,
  };
}

function filePath(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(DATA_DIR, `${safeId}.json`);
}

export async function loadMemory(userId: string): Promise<UserMemory> {
  const cached = memoryCache.get(userId);
  if (cached) {
    resetMonthlyIfNeeded(cached);
    return cached;
  }
  try {
    const raw = await readFile(filePath(userId), "utf8");
    const mem = { ...defaultMemory(userId), ...JSON.parse(raw) } as UserMemory;
    resetMonthlyIfNeeded(mem);
    memoryCache.set(userId, mem);
    return mem;
  } catch {
    const mem = defaultMemory(userId);
    memoryCache.set(userId, mem);
    return mem;
  }
}

export async function saveMemory(userId: string, partial: Partial<UserMemory>): Promise<void> {
  const mem = await loadMemory(userId);
  Object.assign(mem, partial);
  mem.lastSeen = new Date().toISOString();
  memoryCache.set(userId, mem);
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(filePath(userId), JSON.stringify(mem, null, 2), "utf8");
  } catch (err) {
    logger.warn(`Failed to persist user memory for ${userId}: ${err}`);
  }
}

export async function updateStats(userId: string, amount: number): Promise<void> {
  const mem = await loadMemory(userId);
  mem.totalTransfers += 1;
  mem.totalVolume += amount;
  mem.monthlySpent += amount;
  await saveMemory(userId, mem);
}

export function checkBudget(mem: UserMemory, amount: number): { allowed: boolean; remaining: number } {
  if (!mem.monthlyBudget) return { allowed: true, remaining: Infinity };
  const remaining = mem.monthlyBudget - mem.monthlySpent;
  return { allowed: amount <= remaining, remaining: Math.max(0, remaining) };
}

function resetMonthlyIfNeeded(mem: UserMemory): void {
  const resetAt = new Date(mem.monthlyResetAt);
  if (new Date() >= resetAt) {
    mem.monthlySpent = 0;
    mem.monthlyResetAt = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();
  }
}
