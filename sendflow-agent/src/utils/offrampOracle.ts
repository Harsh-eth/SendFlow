import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { recordOfframpAttempt } from "./metricsState";
import { alert } from "./adminAlerter";

const dataRoot = () => process.env.SENDFLOW_DATA_DIR?.trim() || pathJoin(process.cwd(), "data");

const LEDGER_DIR = () => pathJoin(dataRoot(), "offramp-ledger");
const ONRAMP_DIR = () => pathJoin(dataRoot(), "onramp-ledger");
const VELOCITY_DIR = () => pathJoin(dataRoot(), "offramp-velocity");
const FROZEN_OFFRAMP_DIR = () => pathJoin(dataRoot(), "offramp-frozen");
const AUDIT_DIR = () => pathJoin(dataRoot(), "audit");

const COOLING_MS = 2 * 60 * 60 * 1000;
const VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const VELOCITY_MAX_ATTEMPTS = 5;
const VELOCITY_FREEZE_MS = 4 * 60 * 60 * 1000;

function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Env-driven tier caps (USDC / day), with hackathon-safe defaults. */
export function getOfframpTierLimits(): { tier0: number; tier1: number; tier2: number } {
  const tier0 = Number(process.env.OFFRAMP_TIER0_LIMIT ?? 100);
  const tier1 = Number(process.env.OFFRAMP_TIER1_LIMIT ?? 500);
  const tier2 = Number(process.env.OFFRAMP_TIER2_LIMIT ?? 2000);
  return {
    tier0: Number.isFinite(tier0) ? tier0 : 100,
    tier1: Number.isFinite(tier1) ? tier1 : 500,
    tier2: Number.isFinite(tier2) ? tier2 : 2000,
  };
}

export type OfframpTier = 0 | 1 | 2 | 3;

function dailyLedgerPath(userId: string, date: string): string {
  return pathJoin(LEDGER_DIR(), safeUserId(userId), `${date}.json`);
}

export interface DailyOfframpLedger {
  cumulativeUsdc: number;
}

export async function getDailyOfframpTotal(userId: string, date: string = todayUtc()): Promise<number> {
  try {
    const raw = await readFile(dailyLedgerPath(userId, date), "utf8");
    const j = JSON.parse(raw) as DailyOfframpLedger;
    return typeof j.cumulativeUsdc === "number" ? j.cumulativeUsdc : 0;
  } catch {
    return 0;
  }
}

export async function addDailyOfframpUsage(userId: string, amountUsdc: number, date: string = todayUtc()): Promise<void> {
  const prev = await getDailyOfframpTotal(userId, date);
  const next: DailyOfframpLedger = { cumulativeUsdc: prev + amountUsdc };
  const dir = pathJoin(LEDGER_DIR(), safeUserId(userId));
  await mkdir(dir, { recursive: true });
  await writeFile(pathJoin(dir, `${date}.json`), JSON.stringify(next, null, 2), "utf8");
}

export interface TierCheckResult {
  allowed: boolean;
  tier: OfframpTier;
  limitUsd: number;
  usedUsd: number;
  wouldTotal: number;
  reason?: string;
}

/**
 * Tier 0 — no KYC; Tier 1 — phone; Tier 2 — ID; Tier 3 — above tier2 cap → manual only (blocked here).
 */
export async function checkTierLimit(
  userId: string,
  amountUsdc: number,
  tier: OfframpTier
): Promise<TierCheckResult> {
  const limits = getOfframpTierLimits();
  const used = await getDailyOfframpTotal(userId);
  const wouldTotal = used + amountUsdc;

  if (tier === 3) {
    recordOfframpAttempt(3, false);
    return {
      allowed: false,
      tier: 3,
      limitUsd: limits.tier2,
      usedUsd: used,
      wouldTotal,
      reason: "tier3_manual_review",
    };
  }

  const cap = tier === 0 ? limits.tier0 : tier === 1 ? limits.tier1 : limits.tier2;
  const allowed = wouldTotal <= cap + 1e-9;
  recordOfframpAttempt(tier, allowed);
  return {
    allowed,
    tier,
    limitUsd: cap,
    usedUsd: used,
    wouldTotal,
    reason: allowed ? undefined : "daily_tier_limit",
  };
}

export interface OnRampEvent {
  ts: number;
  amountUsdc: number;
}

export interface OnRampLedgerFile {
  events: OnRampEvent[];
}

function onRampPath(userId: string): string {
  return pathJoin(ONRAMP_DIR(), `${safeUserId(userId)}.json`);
}

export async function loadOnRampLedger(userId: string): Promise<OnRampLedgerFile> {
  try {
    const raw = await readFile(onRampPath(userId), "utf8");
    const j = JSON.parse(raw) as OnRampLedgerFile;
    return { events: Array.isArray(j.events) ? j.events : [] };
  } catch {
    return { events: [] };
  }
}

/** Call when a card on-ramp (MoonPay/Transak) completes. */
export async function logOnRamp(userId: string, amountUsdc: number): Promise<void> {
  const ledger = await loadOnRampLedger(userId);
  ledger.events.push({ ts: Date.now(), amountUsdc });
  await mkdir(ONRAMP_DIR(), { recursive: true });
  await writeFile(onRampPath(userId), JSON.stringify(ledger, null, 2), "utf8");
}

/**
 * After any on-ramp, block off-ramp of the same amount or less for 2h (wash round-trip).
 * If any on-ramp in the last 2h has amount >= this off-ramp amount, cooling applies.
 */
export async function checkCooling(
  userId: string,
  amount: number
): Promise<{ allowed: boolean; minutesLeft?: number }> {
  const { events } = await loadOnRampLedger(userId);
  const now = Date.now();
  for (const ev of events) {
    if (ev.amountUsdc < amount) continue;
    const elapsed = now - ev.ts;
    if (elapsed >= COOLING_MS) continue;
    const minutesLeft = Math.ceil((COOLING_MS - elapsed) / 60_000);
    return { allowed: false, minutesLeft };
  }
  return { allowed: true };
}

export function buildKycLink(
  provider: "transak" | "moonpay",
  tier: 1 | 2,
  userId: string,
  amount: number,
  custodialWalletAddress: string
): string {
  const partnerOrderId = `${userId}-${Date.now()}`;
  void tier;

  if (provider === "transak") {
    const apiKey = process.env.TRANSAK_API_KEY?.trim() ?? "";
    const u = new URL("https://global.transak.com/");
    u.searchParams.set("apiKey", apiKey);
    u.searchParams.set("network", "solana");
    u.searchParams.set("cryptoCurrencyCode", "USDC");
    u.searchParams.set("walletAddress", custodialWalletAddress);
    u.searchParams.set("partnerOrderId", partnerOrderId);
    u.searchParams.set("isFeeCalculationHidden", "true");
    if (amount > 0) u.searchParams.set("defaultCryptoAmount", String(amount));
    return u.toString();
  }

  const moonBase = process.env.MOONPAY_URL?.trim() || "https://buy.moonpay.com";
  const u = new URL(moonBase.includes("://") ? moonBase : `https://${moonBase}`);
  u.searchParams.set("currencyCode", "usdc_sol");
  u.searchParams.set("walletAddress", custodialWalletAddress);
  u.searchParams.set("baseCurrencyAmount", String(amount > 0 ? amount : ""));
  u.searchParams.set("externalCustomerId", userId);
  u.searchParams.set("externalTransactionId", partnerOrderId);
  return u.toString();
}

export interface VelocityFile {
  attempts: number[];
}

function velocityPath(userId: string): string {
  return pathJoin(VELOCITY_DIR(), `${safeUserId(userId)}.json`);
}

function frozenOffRampPath(userId: string): string {
  return pathJoin(FROZEN_OFFRAMP_DIR(), `${safeUserId(userId)}.json`);
}

export interface OffRampFrozenRecord {
  frozenUntil: number;
  reason: "velocity";
}

export async function isOfframpVelocityFrozen(userId: string): Promise<boolean> {
  try {
    const raw = await readFile(frozenOffRampPath(userId), "utf8");
    const j = JSON.parse(raw) as OffRampFrozenRecord;
    if (j.frozenUntil > Date.now()) return true;
    return false;
  } catch {
    return false;
  }
}

export async function getOfframpVelocityFrozenUntil(userId: string): Promise<number | null> {
  try {
    const raw = await readFile(frozenOffRampPath(userId), "utf8");
    const j = JSON.parse(raw) as OffRampFrozenRecord;
    return j.frozenUntil > Date.now() ? j.frozenUntil : null;
  } catch {
    return null;
  }
}

async function notifyAdminOfframp(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!token || !admin) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: admin, text }),
  }).catch(() => {});
}

async function setVelocityFreeze(userId: string): Promise<void> {
  const rec: OffRampFrozenRecord = {
    frozenUntil: Date.now() + VELOCITY_FREEZE_MS,
    reason: "velocity",
  };
  await mkdir(FROZEN_OFFRAMP_DIR(), { recursive: true });
  await writeFile(frozenOffRampPath(userId), JSON.stringify(rec, null, 2), "utf8");
  void alert("critical", "offramp.velocity_breaker_freeze", { userId, freezeHours: 4 });
}

/**
 * Record one off-ramp attempt for velocity tracking. If >5 attempts in 60m, freeze 4h and notify admin.
 */
export async function recordOffRampVelocityAttempt(userId: string): Promise<{
  allowed: boolean;
  frozenJustNow: boolean;
  attemptsInWindow: number;
}> {
  if (await isOfframpVelocityFrozen(userId)) {
    return { allowed: false, frozenJustNow: false, attemptsInWindow: 0 };
  }
  const now = Date.now();
  let vf: VelocityFile;
  try {
    const raw = await readFile(velocityPath(userId), "utf8");
    vf = JSON.parse(raw) as VelocityFile;
  } catch {
    vf = { attempts: [] };
  }
  vf.attempts = Array.isArray(vf.attempts) ? vf.attempts : [];
  vf.attempts = vf.attempts.filter((t) => now - t < VELOCITY_WINDOW_MS);
  vf.attempts.push(now);
  await mkdir(VELOCITY_DIR(), { recursive: true });
  await writeFile(velocityPath(userId), JSON.stringify(vf, null, 2), "utf8");

  const inWindow = vf.attempts.length;
  if (inWindow > VELOCITY_MAX_ATTEMPTS) {
    await setVelocityFreeze(userId);
    return { allowed: false, frozenJustNow: true, attemptsInWindow: inWindow };
  }
  return { allowed: true, frozenJustNow: false, attemptsInWindow: inWindow };
}

export type ChainRiskLevel = "low" | "medium" | "high";

export async function checkAddressRisk(address: string): Promise<{ risk: ChainRiskLevel; source?: string }> {
  const key = process.env.CHAINALYSIS_API_KEY?.trim();
  if (!key) {
    return { risk: "low", source: "stub" };
  }
  try {
    const url = `https://api.chainalysis.com/api/risk/v2/entities/${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      return { risk: "low", source: `chainalysis_http_${res.status}` };
    }
    const j = (await res.json()) as { risk?: string; riskLevel?: string; overallRisk?: string };
    const raw = String(j.risk ?? j.riskLevel ?? j.overallRisk ?? "low").toLowerCase();
    let risk: ChainRiskLevel = "low";
    if (raw.includes("high")) risk = "high";
    else if (raw.includes("medium") || raw.includes("med")) risk = "medium";
    return { risk, source: "chainalysis" };
  } catch {
    return { risk: "low", source: "chainalysis_error" };
  }
}

export async function notifyAdminHighChainRisk(userId: string, address: string): Promise<void> {
  await notifyAdminOfframp(`⛔ High chain risk for off-ramp — user ${userId}\nAddress: ${address}`);
}

/** When risk is high, notifies admin and returns true (caller should block off-ramp). */
export async function shouldBlockOffRampForChainRisk(userId: string, address: string): Promise<boolean> {
  const r = await checkAddressRisk(address);
  if (r.risk === "high") {
    await notifyAdminHighChainRisk(userId, address);
    return true;
  }
  return false;
}

export interface OfframpAuditEntry {
  ts: string;
  userId: string;
  amountUsdc: number;
  tier: number;
  kycStatus: string;
  allowed: boolean;
  reason: string;
  chainRisk: string;
}

export async function appendOfframpAudit(entry: OfframpAuditEntry): Promise<void> {
  await mkdir(AUDIT_DIR(), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  await appendFile(pathJoin(AUDIT_DIR(), "offramp-audit.jsonl"), line, "utf8");
}

export const MANUAL_REVIEW_MESSAGE =
  "This withdrawal exceeds automated limits. Our team will review your request — you will be contacted on Telegram.";

export const INLINE_KYC_BUTTON_LABEL = "Complete verification to withdraw";
