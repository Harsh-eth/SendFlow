import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Markup } from "telegraf";
import type { ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";
import { lockUsdcEscrowAction, releaseEscrow } from "@sendflow/plugin-usdc-handler";
import { routePayoutAction } from "@sendflow/plugin-payout-router";
import { shortWallet } from "@sendflow/plugin-intent-parser";
import { clearProcessing, setProcessing } from "@sendflow/plugin-intent-parser";
import { createCustodialWallet, getCustodialWallet } from "./custodialWallet";
import { auditLog, log } from "./structuredLogger";
import { markSeen, isNewUser, hasCompletedWelcomeOnboarding, markWelcomeOnboardingComplete } from "./userRegistry";
import { registerNewUser } from "./growthMetrics";
import { assignUserNumber } from "./achievements";
import { loadMemory } from "./userMemory";
import { startOnboarding } from "./onboardingFlow";
import { afterTransferKeyboard, type InlineKeyboard } from "./keyboards";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CLAIM_TTL_MS = 7 * 24 * 3600 * 1000;

export type PhoneClaimFileStatus = "pending" | "claimed" | "expired";

export interface PhoneClaimRecord {
  senderUserId: string;
  senderChatId?: string;
  amountUsdc: number;
  phoneNumber: string;
  claimCode: string;
  createdAt: string;
  expiresAt: string;
  status: PhoneClaimFileStatus;
  lockTxHash?: string;
  recipientUserId?: string;
  claimedAt?: string;
  payoutTxHash?: string;
}

function dataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

export function phoneClaimsDir(): string {
  return join(dataRoot(), "phone-claims");
}

function phoneClaimsArchiveDir(): string {
  return join(phoneClaimsDir(), "archive");
}

function claimPath(code: string): string {
  return join(phoneClaimsDir(), `${code.toLowerCase()}.json`);
}

function archivePath(code: string): string {
  return join(phoneClaimsArchiveDir(), `${code.toLowerCase()}.json`);
}

export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length <= 4) return "••••";
  return `••••${d.slice(-4)}`;
}

export function generateClaimCode(): string {
  return randomBytes(4).toString("hex");
}

export async function writePhoneClaimRecord(rec: PhoneClaimRecord): Promise<void> {
  await mkdir(phoneClaimsDir(), { recursive: true });
  await writeFile(claimPath(rec.claimCode), JSON.stringify(rec, null, 2), "utf8");
}

export async function loadPhoneClaim(code: string): Promise<PhoneClaimRecord | null> {
  const c = code.toLowerCase();
  try {
    const raw = await readFile(claimPath(c), "utf8");
    return JSON.parse(raw) as PhoneClaimRecord;
  } catch {
    return null;
  }
}

export async function savePhoneClaimRecord(rec: PhoneClaimRecord): Promise<void> {
  await writeFile(claimPath(rec.claimCode), JSON.stringify(rec, null, 2), "utf8");
}

export async function archivePhoneClaimRecord(rec: PhoneClaimRecord, reason: string): Promise<void> {
  await mkdir(phoneClaimsArchiveDir(), { recursive: true });
  const src = claimPath(rec.claimCode);
  const dest = archivePath(rec.claimCode);
  const withMeta = { ...rec, archivedAt: new Date().toISOString(), archiveReason: reason };
  try {
    await rename(src, dest);
    await writeFile(dest, JSON.stringify(withMeta, null, 2), "utf8");
  } catch (e) {
    await writeFile(dest, JSON.stringify(withMeta, null, 2), "utf8");
    try {
      await unlink(src);
    } catch {
      /* ok */
    }
  }
}

/** Max 3 claim deep-link opens per hour per Telegram user (enumeration guard). */
const claimStartAttempts = new Map<string, number[]>();

export function allowPhoneClaimStartAttempt(userId: string): boolean {
  const now = Date.now();
  const hour = 3600_000;
  const arr = (claimStartAttempts.get(userId) ?? []).filter((t) => now - t < hour);
  if (arr.length >= 3) return false;
  arr.push(now);
  claimStartAttempts.set(userId, arr);
  return true;
}

export function __resetPhoneClaimRateLimitForTests(): void {
  claimStartAttempts.clear();
}

function loadEscrowPubkey58(): string | null {
  const secret = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!secret) return null;
  try {
    const kp = Keypair.fromSecretKey(bs58.decode(secret.trim()));
    return kp.publicKey.toBase58();
  } catch {
    try {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
      return kp.publicKey.toBase58();
    } catch {
      return null;
    }
  }
}

export function buildPhoneClaimDeepLink(claimCode: string): string {
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim() || "SendFlowSol_bot";
  const u = bot.replace(/^@/, "");
  return `https://t.me/${u}?start=claim_${claimCode}`;
}

export async function sendPhoneClaimSms(amountUsdc: number, claimCode: string, toPhone: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !from) return false;
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || "SendFlowSol_bot";
  const link = `https://t.me/${bot}?start=claim_${claimCode}`;
  const body = [
    `You have ${amountUsdc} USDC waiting from a friend.`,
    `Claim it free in 60 seconds: ${link}`,
    `Expires in 7 days.`,
  ].join("\n");
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: toPhone, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.ok;
}

function claimPromptKeyboard(claimCode: string, amountUsdc: number): InlineKeyboard {
  const rows = Markup.inlineKeyboard([
    Markup.button.callback(`Claim ${amountUsdc} USDC →`, `sf_phone_claim_${claimCode}`),
  ]).reply_markup.inline_keyboard as InlineKeyboard;
  return rows;
}

export function phoneClaimPromptKeyboard(claimCode: string, amountUsdc: number): InlineKeyboard {
  return claimPromptKeyboard(claimCode, amountUsdc);
}

async function solDripToWallet(connection: Connection, destPk: PublicKey): Promise<void> {
  const demo = process.env.DEMO_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!demo) return;
  try {
    let kp: Keypair;
    try {
      kp = Keypair.fromSecretKey(bs58.decode(demo.trim()));
    } catch {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(demo)));
    }
    const lamports = Math.floor(0.003 * 1e9);
    const ix = SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: destPk, lamports });
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  } catch (e) {
    log.warn("phone_claim.sol_drip_skipped", { message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Recipient opened t.me/bot?start=claim_<8hex>. Rate-limit, load record, optional refund if expired pending, then prompt.
 */
export async function handlePhoneClaimDeepLinkStart(params: {
  userId: string;
  chatId: string;
  claimCode: string;
  connection: Connection;
  sendHtml: (chatId: string, html: string) => Promise<unknown>;
  sendKeyboard: (chatId: string, html: string, keyboard: InlineKeyboard) => Promise<unknown>;
}): Promise<ActionResult> {
  const { userId, chatId, claimCode, connection, sendHtml, sendKeyboard } = params;
  const code = claimCode.toLowerCase();

  if (!allowPhoneClaimStartAttempt(userId)) {
    await sendHtml(chatId, `Too many claim attempts. Try again in an hour.`);
    return { success: false, text: "phone_claim_rate_limited" };
  }

  let rec = await loadPhoneClaim(code);
  if (!rec) {
    await sendHtml(
      chatId,
      `This link has expired.\n\nThe sender has been refunded.`
    );
    return { success: false, text: "phone_claim_missing" };
  }

  const now = Date.now();
  if (rec.status === "pending" && now > new Date(rec.expiresAt).getTime()) {
    await processExpiredPhoneClaimRefund(rec, connection, async (cid, html) => {
      await sendHtml(cid, html);
    });
    rec = await loadPhoneClaim(code);
  }

  if (!rec || rec.status === "expired") {
    await sendHtml(
      chatId,
      `This link has expired.\n\nThe sender has been refunded.`
    );
    return { success: false, text: "phone_claim_expired" };
  }

  if (rec.status === "claimed") {
    await sendHtml(chatId, `These funds have already been claimed.`);
    return { success: false, text: "phone_claim_done" };
  }

  if (isNewUser(userId) && !hasCompletedWelcomeOnboarding(userId)) {
    markSeen(userId);
    registerNewUser(userId);
    assignUserNumber(userId);
    await loadMemory(userId);
    startOnboarding(userId);
    const w = await createCustodialWallet(userId);
    markWelcomeOnboardingComplete(userId);
    await sendHtml(
      chatId,
      [
        `<b>Welcome to SendFlow.</b>`,
        `Your wallet: <code>${shortWallet(w.publicKey)}</code>`,
        ``,
        `You can receive money on Telegram — no bank app required.`,
      ].join("\n")
    );
    setTimeout(() => {
      void solDripToWallet(connection, new PublicKey(w.publicKey));
    }, 800);
  }

  await sendKeyboard(
    chatId,
    [
      `You have <b>${rec.amountUsdc} USDC</b> waiting.`,
      ``,
      `Tap the button below to claim it to your SendFlow wallet.`,
    ].join("\n"),
    claimPromptKeyboard(code, rec.amountUsdc)
  );

  return { success: true, text: "phone_claim_prompt" };
}

async function resolveSenderRefundWallet(senderUserId: string): Promise<PublicKey | null> {
  const w = await getCustodialWallet(senderUserId);
  if (w) return new PublicKey(w.publicKey);
  const secret = process.env.SENDER_WALLET_PRIVATE_KEY?.trim();
  if (!secret) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(secret.trim())).publicKey;
  } catch {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret))).publicKey;
    } catch {
      return null;
    }
  }
}

export async function processExpiredPhoneClaimRefund(
  rec: PhoneClaimRecord,
  connection: Connection,
  notifySender: (senderChatId: string, html: string) => Promise<void>
): Promise<boolean> {
  if (rec.status !== "pending") return false;
  const escrowSecret = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!escrowSecret) {
    log.error("phone_claim.refund_no_escrow", { claimCode: rec.claimCode });
    return false;
  }
  let escrow: Keypair;
  try {
    escrow = Keypair.fromSecretKey(bs58.decode(escrowSecret.trim()));
  } catch {
    escrow = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(escrowSecret)));
  }
  const mint = new PublicKey(process.env.USDC_MINT ?? USDC_MAINNET);
  const receiver = await resolveSenderRefundWallet(rec.senderUserId);
  if (!receiver) {
    log.error("phone_claim.refund_no_sender_wallet", { claimCode: rec.claimCode, senderUserId: rec.senderUserId });
    return false;
  }
  try {
    const { signature } = await releaseEscrow({
      connection,
      escrowKeypair: escrow,
      receiverPubkey: receiver,
      mint,
      amountHuman: rec.amountUsdc,
    });
    rec.status = "expired";
    rec.payoutTxHash = signature;
    await archivePhoneClaimRecord(rec, "expired_refunded");
    auditLog({
      level: "info",
      action: "PHONE_CLAIM_EXPIRED_REFUND",
      result: "success",
      userId: rec.senderUserId,
      amountUsdc: rec.amountUsdc,
      txSig: signature,
    });
    const msg = `Your transfer to ${maskPhone(rec.phoneNumber)} expired unclaimed. <b>${rec.amountUsdc} USDC</b> refunded.`;
    if (rec.senderChatId) {
      await notifySender(rec.senderChatId, msg).catch(() => {});
    }
    return true;
  } catch (e) {
    log.error(
      "phone_claim.refund_failed",
      { claimCode: rec.claimCode },
      e instanceof Error ? e : new Error(String(e))
    );
    auditLog({
      level: "error",
      action: "PHONE_CLAIM_EXPIRED_REFUND",
      result: "error",
      userId: rec.senderUserId,
      category: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function sweepExpiredPhoneClaims(
  connection: Connection,
  notifySender: (senderChatId: string, html: string) => Promise<void>
): Promise<number> {
  let n = 0;
  const dir = phoneClaimsDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".json") || name.includes("/")) continue;
    const code = name.replace(/\.json$/i, "");
    const rec = await loadPhoneClaim(code);
    if (!rec || rec.status !== "pending") continue;
    if (now <= new Date(rec.expiresAt).getTime()) continue;
    const ok = await processExpiredPhoneClaimRefund(rec, connection, notifySender);
    if (ok) n += 1;
  }
  return n;
}

export async function executePhoneClaimSend(params: {
  runtime: IAgentRuntime;
  message: Memory;
  normalizedPhone: string;
  amount: number;
  state: State | undefined;
  opts: unknown;
  callback?: HandlerCallback;
  sendHtml: (chatId: string, html: string) => Promise<unknown>;
}): Promise<ActionResult> {
  const { runtime, message, normalizedPhone, amount, state, opts, callback, sendHtml } = params;
  const entityId = String(message.entityId ?? "");
  const meta = message.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
  const chatId = meta?.telegram?.chat?.id != null ? String(meta.telegram.chat.id) : undefined;

  const escrowPk = loadEscrowPubkey58();
  if (!escrowPk) {
    const t = `❌ Phone send unavailable: escrow wallet not configured.`;
    if (callback) await callback({ text: t, source: message.content.source });
    return { success: false, text: t };
  }

  let claimCode = generateClaimCode();
  for (let attempt = 0; attempt < 8; attempt++) {
    const clash = await loadPhoneClaim(claimCode);
    if (!clash) break;
    claimCode = generateClaimCode();
  }
  const now = Date.now();
  const rec: PhoneClaimRecord = {
    senderUserId: entityId,
    senderChatId: chatId,
    amountUsdc: amount,
    phoneNumber: normalizedPhone,
    claimCode,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CLAIM_TTL_MS).toISOString(),
    status: "pending",
  };

  await writePhoneClaimRecord(rec);

  const intent: RemittanceIntent = {
    amount,
    sourceMint: USDC_MAINNET,
    targetMint: USDC_MAINNET,
    targetRail: "SPL_TRANSFER",
    receiverLabel: maskPhone(normalizedPhone),
    receiverWallet: escrowPk,
    memo: `sf_claim:${claimCode}`,
    confidence: 1,
  };

  const chainState: State = {
    ...(state ?? {}),
    values: {
      ...((state as Record<string, unknown> | undefined)?.values ?? {}),
      sendflow: {
        intent,
        flow: { confirmed: true },
        speedMode: "normal",
      },
    },
  } as State;

  setProcessing(entityId);
  let lockResult: ActionResult | undefined;
  try {
    lockResult = await lockUsdcEscrowAction.handler(runtime, message, chainState, opts as never, callback);
  } finally {
    clearProcessing(entityId);
  }

  const lr = lockResult ?? { success: false, text: "lock failed" };
  if (!lr.success) {
    try {
      await unlink(claimPath(claimCode));
    } catch {
      /* ok */
    }
    return lr;
  }

  if ((lr.data as { queued?: boolean } | undefined)?.queued) {
    try {
      await unlink(claimPath(claimCode));
    } catch {
      /* ok */
    }
    return lr;
  }

  const usdc = (lr.values?.sendflow as { usdc?: { txHash?: string } } | undefined)?.usdc;
  const lockTxHash = usdc?.txHash;
  if (lockTxHash) {
    rec.lockTxHash = lockTxHash;
    await savePhoneClaimRecord(rec);
  }

  const twilioOk = await sendPhoneClaimSms(amount, claimCode, normalizedPhone);
  const link = buildPhoneClaimDeepLink(claimCode);
  const masked = maskPhone(normalizedPhone);

  if (twilioOk && chatId) {
    await sendHtml(
      chatId,
      [
        `SMS sent to <b>${masked}</b>. Funds held for <b>7 days</b>.`,
        `They'll receive a link to claim without needing crypto knowledge.`,
      ].join("\n")
    );
  } else if (chatId) {
    await sendHtml(
      chatId,
      [
        `Share this link with your recipient (no SMS configured):`,
        `<code>${link}</code>`,
        ``,
        `Funds are held in escrow for <b>7 days</b> (${masked}).`,
      ].join("\n")
    );
  }

  return {
    success: true,
    text: "phone_claim_sent",
    data: { claimCode, twilioOk, deepLink: link },
  };
}

export async function executePhoneClaimPayout(params: {
  runtime: IAgentRuntime;
  recipientUserId: string;
  recipientChatId: string;
  claimCode: string;
  sendHtml: (chatId: string, html: string) => Promise<unknown>;
  sendKeyboard?: (chatId: string, html: string, keyboard: InlineKeyboard) => Promise<unknown>;
  connection: Connection;
}): Promise<void> {
  const { runtime, recipientUserId, recipientChatId, claimCode, sendHtml, sendKeyboard, connection } = params;
  const code = claimCode.toLowerCase();
  const rec = await loadPhoneClaim(code);
  if (!rec || rec.status !== "pending") {
    await sendHtml(recipientChatId, `This claim is no longer available.`);
    return;
  }
  if (Date.now() > new Date(rec.expiresAt).getTime()) {
    await processExpiredPhoneClaimRefund(rec, connection, async (cid, html) => {
      await sendHtml(cid, html);
    });
    await sendHtml(recipientChatId, `This link has expired.\n\nThe sender has been refunded.`);
    return;
  }

  const wallet = await createCustodialWallet(recipientUserId);
  const mint = process.env.USDC_MINT ?? USDC_MAINNET;
  const intent: RemittanceIntent = {
    amount: rec.amountUsdc,
    sourceMint: mint,
    targetMint: mint,
    targetRail: "SPL_TRANSFER",
    receiverLabel: "You",
    receiverWallet: wallet.publicKey,
    confidence: 1,
  };
  const usdc = {
    amountLocked: rec.amountUsdc,
    txHash: rec.lockTxHash ?? "",
  };
  const chainState = {
    values: {
      sendflow: { intent, usdc },
    },
  } as unknown as State;

  const payoutMsg = {
    entityId: recipientUserId,
    roomId: `phone_claim_payout_${code}`,
    content: { text: "phone_claim_payout", source: "telegram" },
    metadata: { telegram: { chat: { id: Number(recipientChatId) } } },
  } as Memory;

  setProcessing(recipientUserId);
  try {
    const pr = await routePayoutAction.handler(runtime, payoutMsg, chainState, {}, async () => [] as never[]);
    if (pr?.success) {
      rec.status = "claimed";
      rec.recipientUserId = recipientUserId;
      rec.claimedAt = new Date().toISOString();
      const payout = (pr.values?.sendflow as { payout?: { txHash?: string } } | undefined)?.payout;
      rec.payoutTxHash = payout?.txHash;
      await savePhoneClaimRecord(rec);
      await archivePhoneClaimRecord(rec, "claimed");
      auditLog({
        level: "info",
        action: "PHONE_CLAIM_CLAIMED",
        result: "success",
        userId: recipientUserId,
        amountUsdc: rec.amountUsdc,
        txSig: payout?.txHash,
      });
      const receivedMsg = [
        `💸 <b>You received money!</b>`,
        `<b>${rec.amountUsdc} USDC</b>`,
        `It's in your SendFlow wallet now.`,
        ``,
        `<i>Cash out to bank, send again, or check balance from the menu below.</i>`,
      ].join("\n");
      if (sendKeyboard) {
        await sendKeyboard(recipientChatId, receivedMsg, afterTransferKeyboard);
      } else {
        await sendHtml(recipientChatId, receivedMsg);
      }
      if (rec.senderChatId) {
        await sendHtml(
          rec.senderChatId,
          `Your friend claimed your transfer (${maskPhone(rec.phoneNumber)}).`
        ).catch(() => {});
      }
    } else {
      await sendHtml(recipientChatId, pr?.text ?? `Claim failed. Try again or contact support.`);
    }
  } finally {
    clearProcessing(recipientUserId);
  }
}

export function __resetPhoneClaimDataDirForTests(root: string | null): void {
  if (root) {
    process.env.SENDFLOW_DATA_DIR = root;
  } else {
    delete process.env.SENDFLOW_DATA_DIR;
  }
}
