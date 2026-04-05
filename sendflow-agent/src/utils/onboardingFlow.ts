import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";
import type { ActionResult, Memory } from "@elizaos/core";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createCustodialWallet, getCustodialWallet } from "./custodialWallet";
import { shortWallet } from "@sendflow/plugin-intent-parser";
import { log } from "./structuredLogger";
import {
  detectOnboardingLocale,
  onboardingWelcomeBody,
  onboardingPromptQuestion,
  type OnboardingLocale,
} from "./i18n";
import { trackReferral } from "./referralSystem";
import {
  markWelcomeOnboardingComplete,
  hasCompletedWelcomeOnboarding,
} from "./userRegistry";
import { recordOnboardingPath, recordOnboardingFirstAction } from "./metricsState";

export type OnboardingStep = "welcome" | "wallet_shown" | "first_fund" | "first_send" | "complete";

export interface OnboardingState {
  userId: string;
  step: OnboardingStep;
  startedAt: string;
  completedAt?: string;
  referredBy?: string;
}

const onboardingStates = new Map<string, OnboardingState>();
let startedCount = 0;
let completedCount = 0;
const dropoffByStep: Record<string, number> = {};

export type InlineKeyboard = InlineKeyboardButton[][];

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboard {
  return m.reply_markup.inline_keyboard as InlineKeyboard;
}

export function startOnboarding(userId: string, referredBy?: string): void {
  if (onboardingStates.has(userId)) return;
  startedCount += 1;
  onboardingStates.set(userId, {
    userId,
    step: "welcome",
    startedAt: new Date().toISOString(),
    referredBy,
  });
}

export function getOnboardingState(userId: string): OnboardingState | undefined {
  return onboardingStates.get(userId);
}

export function setOnboardingStep(userId: string, step: OnboardingStep): void {
  const s = onboardingStates.get(userId);
  if (!s) return;
  const prev = s.step;
  s.step = step;
  if (step !== "complete" && prev !== step) {
    dropoffByStep[prev] = (dropoffByStep[prev] ?? 0) + 1;
  }
}

export function advanceOnboarding(userId: string): OnboardingStep {
  const s = onboardingStates.get(userId);
  if (!s) {
    startOnboarding(userId);
    return "welcome";
  }
  const order: OnboardingStep[] = ["welcome", "wallet_shown", "first_fund", "first_send", "complete"];
  const i = order.indexOf(s.step);
  const next = order[Math.min(i + 1, order.length - 1)]!;
  s.step = next;
  if (next === "complete" && !s.completedAt) {
    s.completedAt = new Date().toISOString();
    completedCount += 1;
  }
  return s.step;
}

export function completeOnboarding(userId: string): void {
  const s = onboardingStates.get(userId);
  if (!s) return;
  s.step = "complete";
  s.completedAt = new Date().toISOString();
  completedCount += 1;
}

export function isOnboardingComplete(userId: string): boolean {
  const s = onboardingStates.get(userId);
  if (!s) return true;
  return s.step === "complete";
}

export function getOnboardingStats(): { started: number; completed: number; dropoffStep: string } {
  const worst = Object.entries(dropoffByStep).sort((a, b) => b[1] - a[1])[0];
  return {
    started: startedCount,
    completed: completedCount,
    dropoffStep: worst?.[0] ?? "none",
  };
}

/** Step 1 — legacy hook (callbacks still reference these). */
export function onboardingHookKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("💸 Send your first USDC", "onboard_send"), Markup.button.callback("Fund my wallet", "onboard_fund")],
      [Markup.button.callback("See how it works", "onboard_how")],
    ])
  );
}

export function onboardingDemoKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("💸 Send 1 USDC demo", "onboard_demo"), Markup.button.callback("Fund wallet first", "onboard_fund_first")],
    ])
  );
}

export function onboardingCompleteKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("Share my referral link", "onboard_share"), Markup.button.callback("Explore features", "onboard_explore")],
    ])
  );
}

/** Primary 2×2 CTA after welcome (new flow). */
export function onboardingMainKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Send money", "sf_onboard_send"),
        Markup.button.callback("Request payment", "sf_onboard_request"),
      ],
      [
        Markup.button.callback("Add funds (card)", "sf_onboard_addfunds"),
        Markup.button.callback("See my wallet", "sf_onboard_wallet"),
      ],
    ])
  );
}

const reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleOnboardingReminder(
  userId: string,
  chatId: string,
  send: (html: string) => Promise<void> | void
): void {
  const existing = reminderTimers.get(userId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    reminderTimers.delete(userId);
    void send(`Still here? Your wallet has been waiting.\nType anything to continue.`);
  }, 3_600_000);
  reminderTimers.set(userId, t);
}

export function cancelOnboardingReminder(userId: string): void {
  const t = reminderTimers.get(userId);
  if (t) clearTimeout(t);
  reminderTimers.delete(userId);
}

function dataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

async function persistReferralJson(userId: string, referredBy: string): Promise<void> {
  const dir = join(dataRoot(), "referrals");
  await mkdir(dir, { recursive: true });
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  await writeFile(
    join(dir, `${safe}.json`),
    JSON.stringify({ referredBy, joinedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

function extractReferrerFromStart(text: string): string | undefined {
  const m = text.match(/^\/start\s+ref_([A-Za-z0-9_-]+)/i);
  return m?.[1];
}

export function hasTransferIntentKeywords(text: string): boolean {
  return /\b(send|pay|transfer|request|invoice)\b/i.test(text.trim());
}

function loadKp(secret: string): Keypair | null {
  try {
    const t = secret.trim();
    if (t.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    }
    return Keypair.fromSecretKey(bs58.decode(t));
  } catch {
    return null;
  }
}

async function transferSolLamports(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: number
): Promise<void> {
  const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports });
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from.publicKey;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}

async function transferUsdcReward(
  connection: Connection,
  sponsor: Keypair,
  destOwner: PublicKey,
  amountUsdc: number
): Promise<void> {
  const mintStr = process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const mint = new PublicKey(mintStr);
  const raw = BigInt(Math.round(amountUsdc * 1_000_000));
  const srcAta = await getAssociatedTokenAddress(mint, sponsor.publicKey);
  const destAta = await getOrCreateAssociatedTokenAccount(connection, sponsor, mint, destOwner);
  const ix = createTransferInstruction(srcAta, destAta.address, sponsor.publicKey, raw);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = sponsor.publicKey;
  tx.sign(sponsor);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}

function scheduleReferrerCredit(referrerId: string, connection: Connection): void {
  void (async () => {
    try {
      const secret = process.env.DEMO_ESCROW_WALLET_PRIVATE_KEY?.trim();
      if (!secret) return;
      const amt = Number(process.env.REFERRAL_REWARD_USDC ?? 0.1);
      if (!Number.isFinite(amt) || amt <= 0) return;
      const sponsor = loadKp(secret);
      if (!sponsor) return;
      const w = await getCustodialWallet(referrerId);
      if (!w) return;
      await transferUsdcReward(connection, sponsor, new PublicKey(w.publicKey), amt);
      log.info("onboarding.referral_credit_ok", { referrerId, amountUsdc: amt });
    } catch (e) {
      log.warn("onboarding.referral_credit_failed", {
        referrerId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })();
}

function telegramLangFromMeta(meta: Memory["metadata"]): string | undefined {
  const m = meta as { telegram?: { from?: { language_code?: string } } } | undefined;
  return m?.telegram?.from?.language_code;
}

/**
 * First-message welcome: wallet + optional SOL + CTA keyboard, or fast-path into normal parsing.
 * Caller must only invoke when !hasCompletedWelcomeOnboarding(userId).
 */
export async function runWelcomeOnboarding(params: {
  userId: string;
  chatId: string;
  originalText: string;
  metadata?: Memory["metadata"];
  sendHtml: (chatId: string, html: string) => Promise<unknown>;
  sendKeyboard: (chatId: string, html: string, keyboard: InlineKeyboard) => Promise<unknown>;
  connection: Connection;
  reprocess: () => Promise<ActionResult | undefined>;
}): Promise<ActionResult | undefined> {
  const { userId, chatId, originalText, metadata, sendHtml, sendKeyboard, connection, reprocess } = params;

  if (hasCompletedWelcomeOnboarding(userId)) {
    return undefined;
  }

  const referrer = extractReferrerFromStart(originalText.trim());
  if (referrer) {
    try {
      await persistReferralJson(userId, referrer);
      trackReferral(referrer, userId);
      scheduleReferrerCredit(referrer, connection);
    } catch (e) {
      log.warn("onboarding.referral_persist_failed", { message: String(e) });
    }
  }

  if (hasTransferIntentKeywords(originalText)) {
    recordOnboardingPath("intent_first");
    startOnboarding(userId, referrer);
    markWelcomeOnboardingComplete(userId);
    setOnboardingStep(userId, "wallet_shown");
    return reprocess();
  }

  recordOnboardingPath(referrer ? "referral" : "direct");
  startOnboarding(userId, referrer);

  const tgLang = telegramLangFromMeta(metadata);
  const locale: OnboardingLocale = detectOnboardingLocale(originalText, tgLang);

  const wallet = await createCustodialWallet(userId);
  const sw = shortWallet(wallet.publicKey);

  const invitedLine = referrer
    ? /^\d+$/.test(referrer)
      ? `You were invited by a friend.`
      : `You were invited by <b>@${referrer}</b>.`
    : undefined;

  const welcomeHtml = onboardingWelcomeBody(locale, sw, invitedLine);
  await sendHtml(chatId, welcomeHtml);
  setOnboardingStep(userId, "wallet_shown");
  /** Mark early so a fast follow-up message never runs welcome twice (keyboard still follows). */
  markWelcomeOnboardingComplete(userId);

  const destPk = new PublicKey(wallet.publicKey);
  setTimeout(() => {
    void (async () => {
      try {
        const demo = process.env.DEMO_ESCROW_WALLET_PRIVATE_KEY?.trim();
        if (!demo) return;
        const kp = loadKp(demo);
        if (!kp) return;
        const lamports = Math.floor(0.003 * 1e9);
        await transferSolLamports(connection, kp, destPk, lamports);
      } catch (e) {
        log.warn("onboarding.sol_sponsor_skipped", { message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, 800);

  setTimeout(() => {
    void (async () => {
      try {
        const q = onboardingPromptQuestion(locale);
        await sendKeyboard(chatId, q, onboardingMainKeyboard());
      } catch (e) {
        log.error("onboarding.keyboard_failed", { userId }, e instanceof Error ? e : new Error(String(e)));
      }
    })();
  }, 800 + 400);

  return { success: true, text: "welcome_onboarding" };
}

/** @internal tests */
export function __resetOnboardingFlowForTests(): void {
  onboardingStates.clear();
  startedCount = 0;
  completedCount = 0;
  for (const k of Object.keys(dropoffByStep)) delete dropoffByStep[k];
  for (const [, t] of reminderTimers) clearTimeout(t);
  reminderTimers.clear();
}
