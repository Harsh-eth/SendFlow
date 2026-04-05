import type { P2PTrade } from "./p2pMarket";
import { getReputation } from "./p2pMarket";
import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";

const DAILY_VOL_FILE = "p2p-daily-volume.json";
const FROZEN_FILE = "p2p-frozen-users.json";

function envNum(key: string, fallback: number): number {
  const n = Number(process.env[key] ?? "");
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type P2pTier = "new_user" | "regular" | "trusted" | "verified";

export function tierLimits(tier: P2pTier): { maxPerTrade: number; maxPerDay: number } {
  switch (tier) {
    case "verified":
      return {
        maxPerTrade: envNum("P2P_MAX_TRADE_VERIFIED", 2000),
        maxPerDay: envNum("P2P_MAX_DAY_VERIFIED", 10_000),
      };
    case "trusted":
      return {
        maxPerTrade: envNum("P2P_MAX_TRADE_TRUSTED", 500),
        maxPerDay: envNum("P2P_MAX_DAY_TRUSTED", 2000),
      };
    case "regular":
      return {
        maxPerTrade: envNum("P2P_MAX_TRADE_REGULAR", 100),
        maxPerDay: envNum("P2P_MAX_DAY_REGULAR", 500),
      };
    default:
      return {
        maxPerTrade: envNum("P2P_MAX_TRADE_NEW_USER", 10),
        maxPerDay: envNum("P2P_MAX_DAY_NEW_USER", 20),
      };
  }
}

/** @deprecated Use tierLimits() — kept for README / external refs */
export const P2P_LIMITS = {
  get new_user() {
    return tierLimits("new_user");
  },
  get regular() {
    return tierLimits("regular");
  },
  get trusted() {
    return tierLimits("trusted");
  },
  get verified() {
    return tierLimits("verified");
  },
} as const;

type DailyRec = { date: string; volume: number };

function loadDaily(): Record<string, DailyRec> {
  return persistLoad<Record<string, DailyRec>>(DAILY_VOL_FILE, {});
}

function saveDaily(m: Record<string, DailyRec>): void {
  persistSave(DAILY_VOL_FILE, m);
}

function loadFrozen(): Set<string> {
  const arr = persistLoad<string[]>(FROZEN_FILE, []);
  return new Set(arr);
}

function saveFrozen(s: Set<string>): void {
  persistSave(FROZEN_FILE, [...s]);
}

export function isP2pFrozen(userId: string): boolean {
  return loadFrozen().has(userId);
}

export function setP2pFrozen(userId: string, frozen: boolean): void {
  const s = loadFrozen();
  if (frozen) s.add(userId);
  else s.delete(userId);
  saveFrozen(s);
}

export function getUserTier(userId: string): P2pTier {
  const r = getReputation(userId);
  if (r.verified) return "verified";
  if (r.completedTrades >= 50) return "trusted";
  if (r.completedTrades >= 5) return "regular";
  return "new_user";
}

export function checkDailyLimit(userId: string, amount: number): { allowed: boolean; remaining: number } {
  const tier = getUserTier(userId);
  const limit = tierLimits(tier).maxPerDay;
  const today = new Date().toISOString().slice(0, 10);
  const m = loadDaily();
  let rec = m[userId];
  if (!rec || rec.date !== today) {
    rec = { date: today, volume: 0 };
  }
  const remaining = Math.max(0, limit - rec.volume);
  return { allowed: amount <= remaining + 1e-9, remaining };
}

export function recordDailyVolume(userId: string, amount: number): void {
  const today = new Date().toISOString().slice(0, 10);
  const m = { ...loadDaily() };
  let rec = m[userId];
  if (!rec || rec.date !== today) {
    rec = { date: today, volume: 0 };
  }
  rec = { date: today, volume: rec.volume + amount };
  m[userId] = rec;
  saveDaily(m);
}

export function canInitiateTrade(userId: string, amount: number): { allowed: boolean; reason?: string } {
  if (isP2pFrozen(userId)) {
    return { allowed: false, reason: "P2P trading is paused for your account. Contact support." };
  }
  const min = Number(process.env.P2P_MIN_TRADE_USDC ?? "1");
  const floor = Number.isFinite(min) && min > 0 ? min : 1;
  if (amount < floor) {
    return { allowed: false, reason: `Minimum trade is ${floor} USDC` };
  }
  const tier = getUserTier(userId);
  const lim = tierLimits(tier);
  if (amount > lim.maxPerTrade) {
    return { allowed: false, reason: `Max per trade for your tier is ${lim.maxPerTrade} USDC` };
  }
  const day = checkDailyLimit(userId, amount);
  if (!day.allowed) {
    return { allowed: false, reason: `Daily P2P limit reached (${lim.maxPerDay} USDC). Remaining today: ~${day.remaining.toFixed(2)} USDC` };
  }
  return { allowed: true };
}

export function detectScamPattern(userId: string, trade: P2PTrade): boolean {
  const r = getReputation(userId);
  const peer = trade.buyerUserId === userId ? trade.sellerUserId : trade.buyerUserId;
  const peerRep = getReputation(peer);
  if (r.completedTrades < 3 && trade.usdcAmount >= 50 && peerRep.completedTrades < 3) return true;
  const created = new Date(trade.createdAt).getTime();
  if (trade.paidAt && new Date(trade.paidAt).getTime() - created < 30_000 && trade.usdcAmount > 25) return true;
  return false;
}

export function getStaleTrades(trades: Iterable<P2PTrade>): P2PTrade[] {
  const out: P2PTrade[] = [];
  const now = Date.now();
  for (const t of trades) {
    if (t.status !== "matched" || !t.paidAt) continue;
    if (now - new Date(t.paidAt).getTime() > 2 * 3600_000) out.push(t);
  }
  return out;
}

export function __resetP2pSafetyForTests(): void {
  persistSave(DAILY_VOL_FILE, {});
  persistSave(FROZEN_FILE, []);
}
