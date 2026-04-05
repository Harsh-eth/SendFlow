import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Language } from "./i18n";
import { getUserLanguage, t } from "./i18n";

/** Updated by sendflow-agent market pulse (Jupiter SOL price); env SOL_PRICE_USD overrides. */
let cachedSolUsd = 150;

export function updateCachedSolPriceUsd(usd: number): void {
  if (Number.isFinite(usd) && usd > 0) cachedSolUsd = usd;
}

export function getCachedSolPriceUsd(): number {
  const env = Number(process.env.SOL_PRICE_USD ?? "");
  if (Number.isFinite(env) && env > 0) return env;
  return cachedSolUsd;
}

function wuRate(): number {
  const n = Number(process.env.SENDFLOW_WU_RATE ?? process.env.WU_RATE);
  return Number.isFinite(n) && n > 0 ? n : 0.065;
}

function mgRate(): number {
  const n = Number(process.env.SENDFLOW_MG_RATE ?? process.env.MG_RATE);
  return Number.isFinite(n) && n > 0 ? n : 0.055;
}

export type SavingsRegion = "ph" | "in" | "generic";

export interface SavingsResult {
  sendflowFeeUsd: number;
  westernUnionFeeUsd: number;
  moneygramFeeUsd: number;
  savingVsWU: number;
  savingVsMG: number;
  savingPercent: number;
  humanMessage: string;
}

export interface SavingsCalculateOptions {
  language?: Language;
  recipientLabel?: string;
  receiverWallet?: string;
}

function inferRegion(label?: string, wallet?: string): SavingsRegion {
  const s = `${label ?? ""} ${wallet ?? ""}`.toLowerCase();
  if (/\bphil|philippines|manila|pinoy|ph\b|\.ph\b/i.test(s)) return "ph";
  if (/\bindia|mumbai|delhi|bangalore|inr|\.in\b/i.test(s)) return "in";
  return "generic";
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function round2(n: number): number {
  return Math.round(n * 1e2) / 1e2;
}

/**
 * Human copy by savings amount (vs WU), optional region flavor for PH/IN.
 */
function humanMessageFromSavings(
  savingVsWU: number,
  region: SavingsRegion,
  lang: Language
): string {
  const amt = `$${round2(savingVsWU).toFixed(2)}`;
  const tier =
    savingVsWU < 2
      ? "lt2"
      : savingVsWU < 5
        ? "2_5"
        : savingVsWU < 15
          ? "5_15"
          : savingVsWU < 30
            ? "15_30"
            : savingVsWU < 60
              ? "30_60"
              : savingVsWU < 100
                ? "60_100"
                : "100p";

  if (tier === "5_15" && region === "ph") {
    return t("savings.human_5_15_ph", lang, { amount: amt });
  }
  if (tier === "5_15" && region === "in") {
    return t("savings.human_5_15_in", lang, { amount: amt });
  }

  const key = `savings.human_${tier}` as const;
  return t(key, lang, { amount: amt });
}

export function calculateSavings(
  amountUsdc: number,
  txFeeLamports: number,
  opts?: SavingsCalculateOptions
): SavingsResult {
  const solUsd = getCachedSolPriceUsd();
  const sendflowFeeUsd = round4((txFeeLamports * solUsd) / 1e9);
  const westernUnionFeeUsd = round4(amountUsdc * wuRate());
  const moneygramFeeUsd = round4(amountUsdc * mgRate());
  const savingVsWU = round2(Math.max(0, westernUnionFeeUsd - sendflowFeeUsd));
  const savingVsMG = round2(Math.max(0, moneygramFeeUsd - sendflowFeeUsd));
  const savingPercent =
    westernUnionFeeUsd > 0 ? round2((savingVsWU / westernUnionFeeUsd) * 100) : 0;

  const lang = opts?.language ?? "en";
  const region = inferRegion(opts?.recipientLabel, opts?.receiverWallet);
  const humanMessage = humanMessageFromSavings(savingVsWU, region, lang);

  return {
    sendflowFeeUsd,
    westernUnionFeeUsd,
    moneygramFeeUsd,
    savingVsWU,
    savingVsMG,
    savingPercent,
    humanMessage,
  };
}

function dataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function savingsDir(): string {
  return join(dataRoot(), "savings");
}

function safeUserFile(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(savingsDir(), `${safe}.json`);
}

export interface SavingsLedgerEntry {
  ts: string;
  amountUsdc: number;
  savedVsWU: number;
  txSig: string;
}

interface UserSavingsFileV1 {
  version: 1;
  entries: SavingsLedgerEntry[];
  milestonesFired?: string[];
}

/** In-process aggregates for Prometheus (updated on append + init scan). */
let platformTotalSavedUsd = 0;
let platformTotalTransfers = 0;
let platformTotalVolumeUsdc = 0;

export function getPlatformSavingsSync(): {
  totalSavedUsd: number;
  totalTransfers: number;
  totalVolumeUsdc: number;
} {
  return {
    totalSavedUsd: round2(platformTotalSavedUsd),
    totalTransfers: platformTotalTransfers,
    totalVolumeUsdc: round2(platformTotalVolumeUsdc),
  };
}

function applyEntryToPlatform(entry: SavingsLedgerEntry): void {
  platformTotalSavedUsd += entry.savedVsWU;
  platformTotalTransfers += 1;
  platformTotalVolumeUsdc += entry.amountUsdc;
}

export async function initSavingsPlatformAggregates(): Promise<void> {
  platformTotalSavedUsd = 0;
  platformTotalTransfers = 0;
  platformTotalVolumeUsdc = 0;
  let names: string[] = [];
  try {
    names = await readdir(savingsDir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(savingsDir(), name), "utf8");
      const j = JSON.parse(raw) as UserSavingsFileV1 | SavingsLedgerEntry[];
      const entries = Array.isArray(j) ? j : j.entries ?? [];
      for (const e of entries) {
        if (e && typeof e.savedVsWU === "number" && typeof e.amountUsdc === "number") {
          applyEntryToPlatform(e);
        }
      }
    } catch {
      /* skip */
    }
  }
}

async function readUserFile(userId: string): Promise<UserSavingsFileV1> {
  try {
    const raw = await readFile(safeUserFile(userId), "utf8");
    const j = JSON.parse(raw) as UserSavingsFileV1 | SavingsLedgerEntry[];
    if (Array.isArray(j)) {
      return { version: 1, entries: j, milestonesFired: [] };
    }
    return {
      version: 1,
      entries: Array.isArray(j.entries) ? j.entries : [],
      milestonesFired: Array.isArray(j.milestonesFired) ? j.milestonesFired : [],
    };
  } catch {
    return { version: 1, entries: [], milestonesFired: [] };
  }
}

async function writeUserFile(userId: string, file: UserSavingsFileV1): Promise<void> {
  await mkdir(savingsDir(), { recursive: true });
  await writeFile(safeUserFile(userId), JSON.stringify(file, null, 2), "utf8");
}

export async function appendSavingsLedgerEntry(
  userId: string,
  entry: SavingsLedgerEntry
): Promise<void> {
  const file = await readUserFile(userId);
  file.entries.push(entry);
  await writeUserFile(userId, file);
  applyEntryToPlatform(entry);
}

/** Running total saved vs Western Union (ledger on disk). */
export function getTotalSaved(userId: string): number {
  return getLifetimeSavings(userId).totalSavedUsd;
}

export function getLifetimeSavings(userId: string): { totalSavedUsd: number; transferCount: number } {
  try {
    const raw = readFileSync(safeUserFile(userId), "utf8");
    const j = JSON.parse(raw) as UserSavingsFileV1 | SavingsLedgerEntry[];
    const entries = Array.isArray(j) ? j : j.entries ?? [];
    let total = 0;
    for (const e of entries) {
      total += Number(e.savedVsWU) || 0;
    }
    return { totalSavedUsd: round2(total), transferCount: entries.length };
  } catch {
    return { totalSavedUsd: 0, transferCount: 0 };
  }
}

export async function getLifetimeSavingsAsync(
  userId: string
): Promise<{ totalSavedUsd: number; transferCount: number }> {
  const file = await readUserFile(userId);
  let total = 0;
  for (const e of file.entries) total += e.savedVsWU;
  return { totalSavedUsd: round2(total), transferCount: file.entries.length };
}

export async function getPlatformSavings(): Promise<{
  totalSavedUsd: number;
  totalTransfers: number;
  totalVolumeUsdc: number;
}> {
  await initSavingsPlatformAggregates();
  return getPlatformSavingsSync();
}

const MILESTONES = [10, 50, 100] as const;

function milestoneHumanEquivalent(lang: Language): string {
  return t("savings.milestone_50_equiv", lang);
}

export function buildReferralLink(userId: string, botUsername: string): string {
  const bot = botUsername.replace(/^@/, "");
  const safeId = encodeURIComponent(userId);
  return `https://t.me/${bot}?start=ref_${safeId}`;
}

/**
 * After a new entry, return milestone messages for any thresholds crossed for the first time
 * (one string per threshold, in ascending order).
 */
export async function consumeSavingsMilestones(
  userId: string,
  botUsername: string | undefined
): Promise<string[]> {
  const file = await readUserFile(userId);
  let total = 0;
  for (const e of file.entries) total += e.savedVsWU;
  total = round2(total);

  const fired = new Set(file.milestonesFired ?? []);
  const lang = getUserLanguage(userId);
  const out: string[] = [];

  for (const threshold of MILESTONES) {
    const key = String(threshold);
    if (total < threshold || fired.has(key)) continue;
    fired.add(key);

    if (threshold === 10) {
      out.push(t("savings.milestone_10", lang, { amount: `$${threshold}` }));
    } else if (threshold === 50) {
      const link =
        botUsername && userId
          ? buildReferralLink(userId, botUsername)
          : t("savings.milestone_50_nolink", lang);
      out.push(
        t("savings.milestone_50", lang, {
          amount: `$${threshold}`,
          equiv: milestoneHumanEquivalent(lang),
          link,
        })
      );
    } else {
      out.push(t("savings.milestone_100", lang, { amount: `$${threshold}` }));
    }
  }

  if (out.length > 0) {
    file.milestonesFired = [...fired];
    await writeUserFile(userId, file);
  }

  return out;
}

const EM_DASH_LINE = "\u2014".repeat(20);

export function formatSavingsShareMessage(s: SavingsResult): string {
  const lines = [
    EM_DASH_LINE,
    `💸 <b>You just saved $${s.savingVsWU.toFixed(2)} vs Western Union</b>`,
    ``,
    `SendFlow fee:     $${s.sendflowFeeUsd.toFixed(4)}`,
    `Western Union:  ~$${s.westernUnionFeeUsd.toFixed(2)}`,
    `MoneyGram:      ~$${s.moneygramFeeUsd.toFixed(2)}`,
    ``,
    s.humanMessage,
    EM_DASH_LINE,
  ];
  return lines.join("\n");
}

export function formatLifetimeSavingsReply(
  totalSaved: number,
  count: number,
  lang: Language
): string {
  return t("savings.lifetime_reply", lang, {
    total: `$${totalSaved.toFixed(2)}`,
    count: String(count),
  });
}

export function __resetSavingsEngineForTests(): void {
  cachedSolUsd = 150;
  platformTotalSavedUsd = 0;
  platformTotalTransfers = 0;
  platformTotalVolumeUsdc = 0;
}
