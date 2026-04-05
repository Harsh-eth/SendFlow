import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { releaseEscrow } from "@sendflow/plugin-usdc-handler";
import type { InlineKeyboard } from "./keyboards";
import {
  p2pMainKeyboard,
  p2pRateKeyboard,
  p2pPaymentMethodKeyboard,
  p2pTradeActionKeyboard,
  p2pSellerActionKeyboard,
  p2pOfferKeyboard,
  p2pOfferActionsKeyboard,
  adminDisputeKeyboard,
  p2pProofPromptKeyboard,
} from "./keyboards";
import {
  touchP2pActivity,
  createOffer,
  getOffers,
  getOffer,
  createTrade,
  updateTradeStatus,
  getActiveTrade,
  getOpenOfferForUser,
  getNonExpiredOfferForUser,
  getTrade,
  deleteOffer,
  releaseOfferLock,
  updateReputation,
  getReputation,
  cancelExpiredOffers,
  cancelStaleTrades,
  reduceOfferAfterCompletedTrade,
  listDisputedTrades,
  listTradesForUser,
  bumpOffer,
  type PaymentMethod,
  type P2POffer,
  type P2PTrade,
} from "./p2pMarket";
import { canInitiateTrade, detectScamPattern, recordDailyVolume } from "./p2pSafety";
import { getMarketRate, getRateSummary, sortOffersForBuyer } from "./p2pRateOracle";
import { getUserLocale } from "./countryDetector";
import { getCustodialWallet, transferCustodialUsdcToEscrow } from "./custodialWallet";
import { storeProof, getProof, hasProof } from "./p2pProofStore";
import { formatReputationLine } from "./p2pBadges";
import { recordBuySearch, notifyPotentialBuyers } from "./p2pNotifier";
import { resolveTelegramChatId } from "./telegramChatRegistry";
import { startTradeTimer, stopTradeTimer } from "./p2pTradeTimer";
import { setP2pFrozen } from "./p2pSafety";
import { logSecurity } from "./structuredLogger";

export type P2PFlowCtx = {
  connection: Connection;
  sendTgHtml: (chatId: string, html: string) => Promise<unknown>;
  sendTgWithKeyboard: (chatId: string, html: string, kb: InlineKeyboard) => Promise<number | null | unknown>;
  adminTelegramId?: string;
  sendTgPhotoByFileId?: (chatId: string, fileId: string, caption: string) => Promise<unknown>;
  sendTgEditHtml?: (chatId: string, messageId: number, text: string) => Promise<unknown>;
  forwardTelegramMessage?: (toChatId: string, fromChatId: string, messageId: number) => Promise<unknown>;
};

type Wiz = {
  flow: "sell" | "buy";
  step: string;
  usdc?: number;
  rate?: number;
  currency?: string;
  pm?: PaymentMethod;
  instructions?: string;
  displayName?: string;
  browseAmount?: number;
  tradeOfferId?: string;
};

const wizards = new Map<string, Wiz>();
const awaitingProofTrade = new Map<string, string>();

export function peekAwaitingP2pProof(userId: string): string | undefined {
  return awaitingProofTrade.get(userId);
}

export function clearAwaitingP2pProof(userId: string): void {
  awaitingProofTrade.delete(userId);
}

function setAwaitingP2pProof(userId: string, tradeId: string): void {
  awaitingProofTrade.set(userId, tradeId);
}

function loadEscrowKp(): Keypair | null {
  const s = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
    } catch {
      return null;
    }
  }
}

function display(userId: string, fromMeta?: { username?: string; first_name?: string }): string {
  if (fromMeta?.username) return `@${fromMeta.username}`;
  if (fromMeta?.first_name) return fromMeta.first_name;
  return `trader_${userId.slice(-6)}`;
}

export function clearP2pWizard(userId: string): void {
  wizards.delete(userId);
}

async function escrowMint(): Promise<PublicKey> {
  return new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
}

function tradeTimeoutMin(): number {
  const n = Number(process.env.P2P_TRADE_TIMEOUT_MINUTES ?? "30");
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function buildBuyerTradeHtml(tr: P2PTrade, minutesLeft: number): string {
  const instr = getOffer(tr.offerId)?.instructions ?? tr.sellerInstructionsSnapshot ?? "—";
  return [
    `<b>Trade</b> <code>${tr.tradeId}</code> · ⏱ <b>${minutesLeft}</b> min left`,
    `You buy: <b>${tr.usdcAmount} USDC</b>`,
    `You pay: <b>${tr.localAmount} ${tr.localCurrency}</b> via <b>${tr.paymentMethod}</b>`,
    ``,
    `<b>Pay seller:</b>\n${instr}`,
    ``,
    `Send fiat, then tap <b>I have paid</b>.`,
  ].join("\n");
}

async function startTimerForTrade(tr: P2PTrade, ctx: P2PFlowCtx): Promise<void> {
  const buyerChat = resolveTelegramChatId(tr.buyerUserId);
  const sellerChat = resolveTelegramChatId(tr.sellerUserId);
  const buyerMsgId = tr.buyerTradeMessageId;
  startTradeTimer(tr.tradeId, {
    timeoutMinutes: tradeTimeoutMin(),
    onTick: async (left) => {
      if (buyerMsgId && ctx.sendTgEditHtml) {
        const t2 = getTrade(tr.tradeId);
        if (t2 && t2.status === "matched" && !t2.paidAt) {
          await ctx.sendTgEditHtml(buyerChat, buyerMsgId, buildBuyerTradeHtml(t2, left));
        }
      }
    },
    onExpired: async () => {
      const t2 = getTrade(tr.tradeId);
      if (t2 && t2.status === "matched" && !t2.paidAt) {
        releaseOfferLock(t2.offerId);
        updateTradeStatus(t2.tradeId, "cancelled", { adminNotes: "timer_expired" });
        await ctx.sendTgHtml(buyerChat, `⏱ Trade <code>${tr.tradeId}</code> timed out (no payment claim).`);
        await ctx.sendTgHtml(sellerChat, `⏱ Trade <code>${tr.tradeId}</code> timed out — offer unlocked.`);
      }
    },
  });
}

export async function tryP2PWizardText(
  userId: string,
  chatId: string,
  text: string,
  ctx: P2PFlowCtx,
  meta?: { telegram?: { from?: { username?: string; first_name?: string } } }
): Promise<boolean> {
  const w = wizards.get(userId);
  if (!w) return false;
  const t = text.trim();
  touchP2pActivity(userId);

  if (w.flow === "buy" && w.step === "trade_amt" && w.tradeOfferId) {
    const n = Number(t.replace(/,/g, ""));
    const offer = getOffer(w.tradeOfferId);
    if (!offer) {
      clearP2pWizard(userId);
      await ctx.sendTgHtml(chatId, `Offer no longer available.`);
      return true;
    }
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.sendTgHtml(chatId, `Enter USDC amount between <b>${offer.minAmount}</b> and <b>${offer.usdcAmount}</b>.`);
      return true;
    }
    const amt = Math.min(n, offer.usdcAmount);
    const chk = canInitiateTrade(userId, amt);
    if (!chk.allowed) {
      await ctx.sendTgHtml(chatId, `⚠️ ${chk.reason}`);
      return true;
    }
    if (amt + 1e-9 < offer.minAmount) {
      await ctx.sendTgHtml(chatId, `Minimum for this listing is <b>${offer.minAmount} USDC</b>.`);
      return true;
    }
    clearP2pWizard(userId);
    await openTradeFromOffer(userId, chatId, ctx, offer.offerId, amt, w.browseAmount);
    return true;
  }

  if (w.flow === "sell" && w.step === "amount") {
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.sendTgHtml(chatId, `Enter a valid USDC amount (e.g. <code>100</code>).`);
      return true;
    }
    const chk = canInitiateTrade(userId, n);
    if (!chk.allowed) {
      await ctx.sendTgHtml(chatId, `⚠️ ${chk.reason}`);
      return true;
    }
    w.usdc = n;
    w.step = "rate";
    w.currency = w.currency ?? getUserLocale(userId).currency;
    const m = await getMarketRate(w.currency);
    const warn = m.warning ? `\n\n${m.warning}` : "";
    await ctx.sendTgWithKeyboard(
      chatId,
      [
        `<b>Post a sell offer</b>`,
        `Amount: <b>${n} USDC</b>`,
        `Local: <b>${w.currency}</b>`,
        ``,
        `Pick your ${w.currency} per 1 USDC (market ~<b>${m.rate.toFixed(2)}</b>):`,
        warn,
      ].join("\n"),
      p2pRateKeyboard(m.rate, w.currency)
    );
    return true;
  }

  if (w.flow === "sell" && w.step === "rate_custom") {
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.sendTgHtml(chatId, `Enter a numeric rate per 1 USDC.`);
      return true;
    }
    w.rate = n;
    w.step = "pm";
    await ctx.sendTgWithKeyboard(chatId, `<b>Payment methods</b> you accept for fiat:`, p2pPaymentMethodKeyboard());
    return true;
  }

  if (w.flow === "sell" && w.step === "instr") {
    w.instructions = t.slice(0, 500);
    w.displayName = display(userId, meta?.telegram?.from);
    w.step = "confirm_lock";
    await ctx.sendTgHtml(
      chatId,
      [
        `🔒 <b>Lock ${w.usdc} USDC</b> in escrow to publish this offer?`,
        `Rate: <b>${w.currency} ${w.rate?.toFixed(2)}</b> / USDC`,
        `They pay you: <b>${((w.usdc ?? 0) * (w.rate ?? 0)).toFixed(2)} ${w.currency}</b>`,
        ``,
        `Reply <code>YES</code> to lock, or <code>CANCEL</code>.`,
      ].join("\n")
    );
    return true;
  }

  if (w.flow === "sell" && w.step === "confirm_lock") {
    const low = t.toLowerCase();
    if (low === "cancel") {
      clearP2pWizard(userId);
      await ctx.sendTgHtml(chatId, `Offer cancelled.`);
      return true;
    }
    if (low !== "yes" && low !== "y") {
      await ctx.sendTgHtml(chatId, `Reply <code>YES</code> to lock USDC, or <code>CANCEL</code>.`);
      return true;
    }
    const usdc = w.usdc ?? 0;
    const rate = w.rate ?? 0;
    const cur = w.currency ?? "USD";
    const pm = w.pm ?? "upi";
    const instr = w.instructions ?? "";
    const rep = getReputation(userId);
    const floor = Number(process.env.P2P_MIN_TRADE_USDC ?? "1");
    const minPer = Number.isFinite(floor) && floor > 0 ? floor : 1;
    const minAmount = Math.min(usdc, minPer);
    try {
      const sig = await transferCustodialUsdcToEscrow(userId, ctx.connection, usdc);
      const offer = createOffer(userId, {
        userId,
        displayName: w.displayName ?? userId,
        type: "sell",
        usdcAmount: usdc,
        minAmount,
        maxAmount: usdc,
        pricePerUsdc: rate,
        localCurrency: cur,
        paymentMethods: [pm],
        country: getUserLocale(userId).country,
        instructions: instr,
        completedTrades: rep.completedTrades,
        disputedTrades: rep.disputedTrades,
        avgResponseMinutes: rep.avgResponseMinutes,
        escrowTxHash: sig,
      });
      clearP2pWizard(userId);
      await ctx.sendTgHtml(
        chatId,
        [
          `✅ <b>Offer posted</b>`,
          `Selling: <b>${usdc} USDC</b> (min trade <b>${minAmount} USDC</b>)`,
          `Rate: <b>${cur} ${rate.toFixed(2)}</b>/USDC`,
          `You receive: <b>${(usdc * rate).toFixed(2)} ${cur}</b>`,
          `Payment: <b>${pm}</b> — ${instr}`,
          `Escrow lock: <code>${sig.slice(0, 12)}…</code>`,
        ].join("\n")
      );
      void notifyPotentialBuyers(offer, { sendTgWithKeyboard: ctx.sendTgWithKeyboard }).catch(() => {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.sendTgHtml(chatId, `❌ Could not lock USDC: ${msg}\n💡 Fund your SendFlow wallet first.`);
    }
    return true;
  }

  if (w.flow === "buy" && w.step === "amount") {
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.sendTgHtml(chatId, `Enter how much USDC to buy.`);
      return true;
    }
    const chk = canInitiateTrade(userId, n);
    if (!chk.allowed) {
      await ctx.sendTgHtml(chatId, `⚠️ ${chk.reason}`);
      return true;
    }
    w.browseAmount = n;
    w.currency = w.currency ?? getUserLocale(userId).currency;
    recordBuySearch(userId, w.currency, n);
    w.step = "browse";
    await showBuyOffers(userId, chatId, ctx, n, w.currency);
    return true;
  }

  return false;
}

async function showBuyOffers(userId: string, chatId: string, ctx: P2PFlowCtx, amount: number, currency: string): Promise<void> {
  const all = sortOffersForBuyer(getOffers({ type: "sell", currency })).filter((o) => o.usdcAmount >= amount - 0.000_001);
  if (!all.length) {
    await ctx.sendTgHtml(
      chatId,
      `No sell offers for at least <b>${amount} USDC</b> in <b>${currency}</b>.\nTry <code>show offers</code> or post as a seller.`
    );
    clearP2pWizard(userId);
    return;
  }
  await ctx.sendTgHtml(chatId, `<b>Best offers</b> for ≥${amount} USDC (${currency}):`);
  for (let i = 0; i < Math.min(5, all.length); i++) {
    const o = all[i]!;
    const rep = getReputation(o.userId);
    const initial = o.initialUsdcAmount ?? o.usdcAmount;
    const remLine =
      initial > o.usdcAmount + 1e-6 ? ` · <b>${o.usdcAmount} USDC</b> left (was ${initial})` : ` · <b>${o.usdcAmount} USDC</b>`;
    await ctx.sendTgWithKeyboard(
      chatId,
      `${i + 1}. ${o.displayName} | ${formatReputationLine(rep)}${remLine}\nRate: ${currency} ${o.pricePerUsdc.toFixed(2)}/USDC`,
      p2pOfferActionsKeyboard(o)
    );
  }
  clearP2pWizard(userId);
}

async function openTradeFromOffer(
  buyerEntityId: string,
  buyerChatId: string,
  ctx: P2PFlowCtx,
  offerId: string,
  requestedUsdc: number,
  browseCap?: number
): Promise<void> {
  const offer = getOffer(offerId);
  if (!offer) {
    await ctx.sendTgHtml(buyerChatId, `Offer gone or expired.`);
    return;
  }
  let want = Math.min(requestedUsdc, offer.usdcAmount);
  if (browseCap != null) want = Math.min(want, browseCap, offer.usdcAmount);
  const chk = canInitiateTrade(buyerEntityId, want);
  if (!chk.allowed) {
    await ctx.sendTgHtml(buyerChatId, `⚠️ ${chk.reason}`);
    return;
  }
  const tr = createTrade(offerId, buyerEntityId, want);
  if (!tr) {
    await ctx.sendTgHtml(buyerChatId, `Could not start trade.`);
    return;
  }
  const instr = offer.instructions;
  const html = buildBuyerTradeHtml({ ...tr, sellerInstructionsSnapshot: instr }, tradeTimeoutMin());
  const midRaw = await ctx.sendTgWithKeyboard(buyerChatId, html, p2pTradeActionKeyboard(tr.tradeId));
  const mid = typeof midRaw === "number" ? midRaw : undefined;
  if (mid != null) {
    updateTradeStatus(tr.tradeId, "matched", { buyerTradeMessageId: mid });
  }
  await startTimerForTrade({ ...tr, buyerTradeMessageId: mid }, ctx);
  const sellerChat = resolveTelegramChatId(offer.userId);
  await ctx.sendTgHtml(sellerChat, `🔔 Trade started for <b>${tr.usdcAmount} USDC</b> of your listing (<code>${tr.tradeId}</code>).`);
}

export async function tryP2PNaturalLanguage(
  userId: string,
  chatId: string,
  lower: string,
  userText: string,
  ctx: P2PFlowCtx,
  meta?: { telegram?: { from?: { username?: string; first_name?: string } } }
): Promise<boolean> {
  touchP2pActivity(userId);

  if (/\bbump\s+my\s+offer\b|\brefresh\s+my\s+listing\b/i.test(lower)) {
    const ok = bumpOffer(userId);
    await ctx.sendTgHtml(chatId, ok ? `✅ Listing bumped to the top.` : `No open offer to bump.`);
    return true;
  }

  const sellM = userText.match(/\bsell\s+(\d+(?:\.\d+)?)\s*usdc\b/i);
  if (sellM) {
    wizards.set(userId, { flow: "sell", step: "amount", currency: getUserLocale(userId).currency });
    return tryP2PWizardText(userId, chatId, sellM[1]!, ctx, meta);
  }
  if (/\bi\s+want\s+to\s+sell\b|\bsell\s+usdc\b|\bsell\s+my\s+usdc\b/i.test(lower)) {
    wizards.set(userId, { flow: "sell", step: "amount", currency: getUserLocale(userId).currency });
    await ctx.sendTgHtml(chatId, `How many <b>USDC</b> do you want to sell?`);
    return true;
  }

  const buyM = userText.match(/\bbuy\s+(\d+(?:\.\d+)?)\s*usdc\b/i);
  if (buyM) {
    wizards.set(userId, { flow: "buy", step: "amount", currency: getUserLocale(userId).currency });
    return tryP2PWizardText(userId, chatId, buyM[1]!, ctx, meta);
  }
  if (/\bi\s+want\s+to\s+buy\b|\bbuy\s+usdc\b|\bget\s+usdc\b/i.test(lower)) {
    wizards.set(userId, { flow: "buy", step: "amount", currency: getUserLocale(userId).currency });
    await ctx.sendTgHtml(chatId, `How many <b>USDC</b> do you want to buy?`);
    return true;
  }

  if (/\bshow\s+offers\b|\bview\s+offers\b|\bp2p\s+market\b|\bmarketplace\b/i.test(lower)) {
    const cur = getUserLocale(userId).currency;
    const sells = sortOffersForBuyer(getOffers({ type: "sell", currency: cur })).slice(0, 8);
    if (!sells.length) {
      await ctx.sendTgHtml(chatId, `No open sell offers in <b>${cur}</b>. Be the first: <code>I want to sell USDC</code>`);
      return true;
    }
    for (const o of sells.slice(0, 5)) {
      const rep = getReputation(o.userId);
      await ctx.sendTgWithKeyboard(
        chatId,
        `⭐ ${formatReputationLine(rep)} · <b>${o.displayName}</b> · <b>${o.usdcAmount} USDC</b> @ ${cur} ${o.pricePerUsdc.toFixed(2)}`,
        p2pOfferActionsKeyboard(o)
      );
    }
    return true;
  }

  if (/\bbuy\s+rate\b|\bsell\s+rate\b|\bcurrent\s+rate\b|\bp2p\s+rate\b/i.test(lower)) {
    const html = await getRateSummary(getUserLocale(userId).currency);
    await ctx.sendTgHtml(chatId, html);
    return true;
  }

  if (/\bmy\s+offer\b|\bmy\s+listing\b/i.test(lower)) {
    const o = getNonExpiredOfferForUser(userId);
    await ctx.sendTgHtml(
      chatId,
      o
        ? [`<b>Your offer</b>`, `${o.usdcAmount} USDC @ ${o.localCurrency} ${o.pricePerUsdc}`, `Offer ID: <code>${o.offerId}</code>`].join("\n")
        : `You have no open offer.`
    );
    return true;
  }

  if (/\bmy\s+trade\b|\bactive\s+trade\b/i.test(lower)) {
    const tr = getActiveTrade(userId);
    await ctx.sendTgHtml(
      chatId,
      tr
        ? [`<b>Active trade</b> <code>${tr.tradeId}</code>`, `Status: <b>${tr.status}</b>`, `${tr.usdcAmount} USDC / ${tr.localAmount} ${tr.localCurrency}`].join("\n")
        : `No active trade.`
    );
    return true;
  }

  if (/\bcancel\s+offer\b/i.test(lower)) {
    const o = getOpenOfferForUser(userId);
    if (!o) {
      await ctx.sendTgHtml(chatId, `No open offer.`);
      return true;
    }
    await refundOfferAndDelete(o, ctx);
    await ctx.sendTgHtml(chatId, `Offer cancelled; USDC returned from escrow when possible.`);
    return true;
  }

  if (/\bcancel\s+trade\b/i.test(lower)) {
    const tr = getActiveTrade(userId);
    if (!tr || tr.status !== "matched") {
      await ctx.sendTgHtml(chatId, `Nothing to cancel.`);
      return true;
    }
    if (!tr.paidAt) {
      stopTradeTimer(tr.tradeId);
      releaseOfferLock(tr.offerId);
      updateTradeStatus(tr.tradeId, "cancelled");
      await ctx.sendTgHtml(chatId, `Trade cancelled. Offer is open again.`);
    } else {
      await ctx.sendTgHtml(chatId, `Payment already marked — use <code>dispute</code> if needed.`);
    }
    return true;
  }

  {
    const tr = getActiveTrade(userId);
    if (tr && tr.buyerUserId === userId && tr.status === "matched" && !tr.paidAt) {
      if (/\bi\s*'?ve\s+paid\b|\bpayment\s+sent\b|\bfiat\s+sent\b/i.test(lower)) {
        await promptPaymentProof(tr, userId, chatId, ctx);
        return true;
      }
    }
  }

  if (/\brelease\b|\bconfirm\s+payment\b|\breceived\b/i.test(lower)) {
    const tr = getActiveTrade(userId);
    if (tr && tr.sellerUserId === userId && tr.paidAt) {
      await releaseTradeToBuyer(tr, ctx);
      return true;
    }
  }

  if (/\bdispute\b/i.test(lower)) {
    const tr = getActiveTrade(userId);
    if (tr) {
      updateTradeStatus(tr.tradeId, "disputed", { disputeReason: "User dispute" });
      if (ctx.adminTelegramId) {
        await ctx.sendTgHtml(
          ctx.adminTelegramId,
          `🚨 <b>P2P dispute</b> <code>${tr.tradeId}</code>\nBuyer ${tr.buyerUserId} · Seller ${tr.sellerUserId}`,
        );
        const proofHint = hasProof(tr.tradeId) ? `\nProof on file for <code>${tr.tradeId}</code>` : "";
        await ctx.sendTgWithKeyboard(ctx.adminTelegramId, `Resolve:${proofHint}`, adminDisputeKeyboard(tr.tradeId));
      }
      await ctx.sendTgHtml(chatId, `Dispute recorded. An admin will review.`);
    }
    return true;
  }

  if (/\bmy\s+reputation\b|\bmy\s+rating\b|\bmy\s+p2p\s+stats\b/i.test(lower)) {
    const r = getReputation(userId);
    await ctx.sendTgHtml(
      chatId,
      [`<b>Your P2P reputation</b>`, formatReputationLine(r), `Disputes: <b>${r.disputedTrades}</b>`, `Volume: <b>${r.totalVolume.toFixed(1)} USDC</b>`].join("\n")
    );
    return true;
  }

  if (/\btrusted\s+traders\b|\btop\s+traders\b/i.test(lower)) {
    const cur = getUserLocale(userId).currency;
    const sells = sortOffersForBuyer(getOffers({ type: "sell", currency: cur })).slice(0, 5);
    if (!sells.length) {
      await ctx.sendTgHtml(chatId, `No sellers in ${cur} right now.`);
      return true;
    }
    let msg = `<b>Top sellers (${cur})</b>\n`;
    for (const o of sells) {
      msg += `\n${o.displayName} — ${formatReputationLine(getReputation(o.userId))}`;
    }
    await ctx.sendTgHtml(chatId, msg);
    return true;
  }

  return false;
}

async function refundOfferAndDelete(o: P2POffer, ctx: P2PFlowCtx): Promise<void> {
  const kp = loadEscrowKp();
  if (!kp || !o.escrowTxHash) {
    deleteOffer(o.offerId);
    return;
  }
  const seller = await getCustodialWallet(o.userId);
  if (!seller) {
    deleteOffer(o.offerId);
    return;
  }
  try {
    await releaseEscrow({
      connection: ctx.connection,
      escrowKeypair: kp,
      receiverPubkey: new PublicKey(seller.publicKey),
      mint: await escrowMint(),
      amountHuman: o.usdcAmount,
    });
  } catch {
    /* best effort */
  }
  deleteOffer(o.offerId);
}

async function promptPaymentProof(tr: P2PTrade, buyerEntityId: string, buyerChatId: string, ctx: P2PFlowCtx): Promise<void> {
  setAwaitingP2pProof(buyerEntityId, tr.tradeId);
  await ctx.sendTgWithKeyboard(
    buyerChatId,
    [
      `<b>Payment proof</b>`,
      `Upload a screenshot of your fiat payment (recommended for disputes).`,
      ``,
      `Or tap <b>Skip</b> if you trust the seller.`,
    ].join("\n"),
    p2pProofPromptKeyboard(tr.tradeId)
  );
}

async function markBuyerPaid(tr: P2PTrade, ctx: P2PFlowCtx): Promise<void> {
  clearAwaitingP2pProof(tr.buyerUserId);
  updateTradeStatus(tr.tradeId, "matched", { paidAt: new Date().toISOString() });
  const offer = getOffer(tr.offerId);
  const instr = offer?.instructions ?? tr.sellerInstructionsSnapshot ?? "—";
  const pm = tr.paymentMethod;
  const buyerChat = resolveTelegramChatId(tr.buyerUserId);
  const sellerChat = resolveTelegramChatId(tr.sellerUserId);
  await ctx.sendTgWithKeyboard(buyerChat, `✅ Marked as paid. Wait for seller to release USDC.`, p2pTradeActionKeyboard(tr.tradeId));
  await ctx.sendTgWithKeyboard(
    sellerChat,
    [
      `💸 <b>Payment claim</b>`,
      `Buyer says they paid <b>${tr.localAmount} ${tr.localCurrency}</b> via <b>${pm}</b>.`,
      `Your instructions: ${instr}`,
      hasProof(tr.tradeId) ? `\n📎 <b>Payment proof received.</b>` : ``,
      ``,
      `Verify in your app, then release.`,
    ].join("\n"),
    p2pSellerActionKeyboard(tr.tradeId)
  );
  if (detectScamPattern(tr.buyerUserId, tr)) {
    if (ctx.adminTelegramId) {
      await ctx.sendTgHtml(ctx.adminTelegramId, `⚠️ P2P trade <code>${tr.tradeId}</code> flagged as higher risk (new users / fast pay).`);
    }
  }
}

export async function handleP2pPhotoProof(
  userId: string,
  buyerChatId: string,
  fileId: string,
  messageId: number | undefined,
  ctx: P2PFlowCtx
): Promise<boolean> {
  const tradeId = peekAwaitingP2pProof(userId);
  if (!tradeId) return false;
  const tr = getTrade(tradeId);
  if (!tr || tr.buyerUserId !== userId || tr.status !== "matched" || tr.paidAt) {
    clearAwaitingP2pProof(userId);
    return false;
  }
  storeProof(tradeId, userId, fileId, { buyerChatId, proofMessageId: messageId });
  updateTradeStatus(tradeId, "matched", { paymentProofFileId: fileId });
  const sellerChat = resolveTelegramChatId(tr.sellerUserId);
  if (ctx.sendTgPhotoByFileId) {
    await ctx.sendTgPhotoByFileId(sellerChat, fileId, `📎 Buyer payment proof for trade <code>${tradeId}</code>`);
  } else {
    await ctx.sendTgHtml(sellerChat, `📎 Buyer uploaded payment proof for <code>${tradeId}</code> (configure sendTgPhotoByFileId to forward images).`);
  }
  await markBuyerPaid(tr, ctx);
  return true;
}

async function releaseTradeToBuyer(tr: P2PTrade, ctx: P2PFlowCtx): Promise<void> {
  const kp = loadEscrowKp();
  const buyer = await getCustodialWallet(tr.buyerUserId);
  const sellerChat = resolveTelegramChatId(tr.sellerUserId);
  const buyerChat = resolveTelegramChatId(tr.buyerUserId);
  if (!kp || !buyer?.publicKey) {
    await ctx.sendTgHtml(sellerChat, `❌ Escrow or buyer wallet not available.`);
    return;
  }
  let dest: PublicKey;
  try {
    dest = new PublicKey(buyer.publicKey);
  } catch {
    await ctx.sendTgHtml(sellerChat, `❌ Invalid buyer wallet — release blocked.`);
    return;
  }
  if (!tr.paidAt) {
    await ctx.sendTgHtml(sellerChat, `Wait until the buyer marks paid before releasing.`);
    return;
  }
  const tradeAgeMs = Date.now() - new Date(tr.createdAt).getTime();
  const MIN_TRADE_AGE_MS = 60_000;
  if (tradeAgeMs < MIN_TRADE_AGE_MS && !tr.paymentProofFileId) {
    logSecurity("p2p.suspicious_release", tr.sellerUserId, "medium", {
      tradeId: tr.tradeId,
      tradeAgeMs,
      hasProof: false,
    });
    if (ctx.adminTelegramId) {
      await ctx.sendTgHtml(
        ctx.adminTelegramId,
        `⚠️ Fast release on trade <code>${tr.tradeId}</code> — ${Math.round(tradeAgeMs / 1000)}s after start, no proof`
      );
    }
  }
  try {
    const { signature } = await releaseEscrow({
      connection: ctx.connection,
      escrowKeypair: kp,
      receiverPubkey: dest,
      mint: await escrowMint(),
      amountHuman: tr.usdcAmount,
    });
    updateTradeStatus(tr.tradeId, "completed", { releaseTxHash: signature, completedAt: new Date().toISOString() });
    const { dustBelowMinUsdc } = reduceOfferAfterCompletedTrade(tr);
    if (dustBelowMinUsdc > 1e-6) {
      const seller = await getCustodialWallet(tr.sellerUserId);
      if (seller) {
        try {
          await releaseEscrow({
            connection: ctx.connection,
            escrowKeypair: kp,
            receiverPubkey: new PublicKey(seller.publicKey),
            mint: await escrowMint(),
            amountHuman: dustBelowMinUsdc,
          });
        } catch {
          /* best effort dust */
        }
      }
    }
    recordDailyVolume(tr.buyerUserId, tr.usdcAmount);
    recordDailyVolume(tr.sellerUserId, tr.usdcAmount);
    updateReputation(tr.sellerUserId, true, 10, tr.usdcAmount);
    updateReputation(tr.buyerUserId, true, 10, tr.usdcAmount);
    stopTradeTimer(tr.tradeId);
    await ctx.sendTgHtml(
      buyerChat,
      `✅ <b>Trade complete!</b> ${tr.usdcAmount} USDC is in your wallet.\n<code>${signature.slice(0, 16)}…</code>`
    );
    await ctx.sendTgHtml(sellerChat, `✅ <b>Trade complete.</b> You should see fiat in your account.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.sendTgHtml(sellerChat, `❌ Release failed: ${msg}`);
  }
}

export async function tryP2PAdminResolveCommand(userText: string, chatId: string, ctx: P2PFlowCtx, isAdmin: boolean): Promise<boolean> {
  if (!isAdmin || !ctx.adminTelegramId) return false;
  const m = userText.trim().match(/^\/admin\s+resolve\s+(\S+)\s+(buyer|seller)\s*$/i);
  if (!m) return false;
  const tradeId = m[1]!;
  const side = m[2]!.toLowerCase() as "buyer" | "seller";
  const tr = getTrade(tradeId);
  if (!tr) {
    await ctx.sendTgHtml(chatId, `Trade <code>${tradeId}</code> not found.`);
    return true;
  }
  if (side === "buyer") {
    if (hasProof(tradeId)) {
      const p = getProof(tradeId);
      if (p?.buyerChatId && p.proofMessageId != null && ctx.forwardTelegramMessage && ctx.adminTelegramId) {
        await ctx.forwardTelegramMessage(ctx.adminTelegramId, p.buyerChatId, p.proofMessageId);
      } else if (p && ctx.sendTgPhotoByFileId && ctx.adminTelegramId) {
        await ctx.sendTgPhotoByFileId(ctx.adminTelegramId, p.telegramFileId, `Proof for trade <code>${tradeId}</code>`);
      }
    }
    await releaseTradeToBuyer(tr, ctx);
    await ctx.sendTgHtml(chatId, `Resolved <code>${tradeId}</code> → release to buyer.`);
    return true;
  }
  const kp = loadEscrowKp();
  const seller = await getCustodialWallet(tr.sellerUserId);
  if (!kp || !seller) {
    await ctx.sendTgHtml(chatId, `Escrow or seller wallet not available.`);
    return true;
  }
  try {
    const { signature } = await releaseEscrow({
      connection: ctx.connection,
      escrowKeypair: kp,
      receiverPubkey: new PublicKey(seller.publicKey),
      mint: await escrowMint(),
      amountHuman: tr.usdcAmount,
    });
    updateTradeStatus(tradeId, "cancelled", { adminNotes: "returned_to_seller", releaseTxHash: signature });
    deleteOffer(tr.offerId);
    stopTradeTimer(tradeId);
    await ctx.sendTgHtml(chatId, `Resolved <code>${tradeId}</code> → USDC returned to seller.\n<code>${signature.slice(0, 16)}…</code>`);
    await ctx.sendTgHtml(resolveTelegramChatId(tr.sellerUserId), `Admin returned <b>${tr.usdcAmount} USDC</b> to your SendFlow wallet.`);
    if (tr.buyerUserId !== tr.sellerUserId) {
      await ctx.sendTgHtml(resolveTelegramChatId(tr.buyerUserId), `Trade <code>${tradeId}</code> closed by admin — USDC returned to seller.`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ctx.sendTgHtml(chatId, `❌ ${msg}`);
  }
  return true;
}

export async function tryP2PAdminExtendedCommands(userText: string, chatId: string, ctx: P2PFlowCtx, isAdmin: boolean): Promise<boolean> {
  if (!isAdmin || !ctx.adminTelegramId) return false;
  const t = userText.trim();
  if (t === "/admin p2p stats" || /^\/admin\s+p2p\s+stats$/i.test(t)) {
    const { getP2pHealthSnapshot } = await import("./p2pMarket");
    const s = getP2pHealthSnapshot();
    await ctx.sendTgHtml(
      chatId,
      [
        `<b>P2P stats</b>`,
        `Sell offers: ${s.openSellOffers} · Buy ads: ${s.openBuyOffers}`,
        `Active trades: ${s.activeTrades}`,
        `Completed today: ${s.completedToday} (${s.volumeTodayUsdc.toFixed(2)} USDC)`,
        `Disputes: ${s.disputeCount}`,
      ].join("\n")
    );
    return true;
  }
  if (t.startsWith("/admin p2p disputes") || /^\/admin\s+p2p\s+disputes$/i.test(t)) {
    const list = listDisputedTrades();
    if (!list.length) {
      await ctx.sendTgHtml(chatId, `No disputed trades.`);
      return true;
    }
    for (const tr of list.slice(0, 15)) {
      await ctx.sendTgWithKeyboard(chatId, `Dispute <code>${tr.tradeId}</code> · ${tr.usdcAmount} USDC`, adminDisputeKeyboard(tr.tradeId));
    }
    return true;
  }
  const freezeM = t.match(/^\/admin\s+p2p\s+freeze\s+(\S+)$/i);
  if (freezeM) {
    const uid = freezeM[1]!;
    setP2pFrozen(uid, true);
    await ctx.sendTgHtml(chatId, `P2P frozen for <code>${uid}</code>.`);
    return true;
  }
  const tradesM = t.match(/^\/admin\s+p2p\s+trades\s+(\S+)$/i);
  if (tradesM) {
    const uid = tradesM[1]!;
    const list = listTradesForUser(uid).slice(0, 12);
    await ctx.sendTgHtml(
      chatId,
      list.length
        ? [`<b>Trades for</b> <code>${uid}</code>`, ...list.map((x) => `• <code>${x.tradeId}</code> ${x.status} ${x.usdcAmount} USDC`)].join("\n")
        : `No trades for <code>${uid}</code>.`
    );
    return true;
  }
  return false;
}

export async function handleP2PCallback(
  cbData: string,
  userId: string,
  chatId: string,
  ctx: P2PFlowCtx,
  telegramUserId?: string
): Promise<boolean> {
  touchP2pActivity(userId);

  if (cbData === "p2p_menu") {
    await ctx.sendTgWithKeyboard(chatId, `<b>P2P USDC</b> — zero platform fees.`, p2pMainKeyboard());
    return true;
  }
  if (cbData === "p2p_buy") {
    wizards.set(userId, { flow: "buy", step: "amount", currency: getUserLocale(userId).currency });
    await ctx.sendTgHtml(chatId, `How many <b>USDC</b> do you want to buy?`);
    return true;
  }
  if (cbData === "p2p_sell") {
    wizards.set(userId, { flow: "sell", step: "amount", currency: getUserLocale(userId).currency });
    await ctx.sendTgHtml(chatId, `How many <b>USDC</b> do you want to sell?`);
    return true;
  }
  if (cbData === "p2p_browse") {
    const cur = getUserLocale(userId).currency;
    const sells = sortOffersForBuyer(getOffers({ type: "sell", currency: cur })).slice(0, 5);
    if (!sells.length) {
      await ctx.sendTgHtml(chatId, `No offers in ${cur}.`);
      return true;
    }
    for (const o of sells) {
      await ctx.sendTgWithKeyboard(
        chatId,
        `${o.displayName} · ${o.usdcAmount} USDC @ ${cur} ${o.pricePerUsdc}`,
        p2pOfferActionsKeyboard(o)
      );
    }
    return true;
  }
  if (cbData === "p2p_my_trades") {
    const tr = getActiveTrade(userId);
    await ctx.sendTgHtml(chatId, tr ? `Active: <code>${tr.tradeId}</code> (${tr.status})` : `No active trade.`);
    return true;
  }
  if (cbData === "p2p_rates") {
    await ctx.sendTgHtml(chatId, await getRateSummary(getUserLocale(userId).currency));
    return true;
  }
  if (cbData === "p2p_reputation") {
    const r = getReputation(userId);
    await ctx.sendTgHtml(chatId, formatReputationLine(r));
    return true;
  }

  if (cbData.startsWith("p2p_rate_")) {
    const w = wizards.get(userId);
    if (!w || w.flow !== "sell" || w.step !== "rate") return true;
    const rest = cbData.slice("p2p_rate_".length);
    if (rest === "custom") {
      w.step = "rate_custom";
      await ctx.sendTgHtml(chatId, `Type your <b>${w.currency}</b> per 1 USDC:`);
      return true;
    }
    const r = Number(rest) / 10_000;
    if (!Number.isFinite(r) || r <= 0) return true;
    w.rate = r;
    w.step = "pm";
    await ctx.sendTgWithKeyboard(chatId, `Payment methods you accept:`, p2pPaymentMethodKeyboard());
    return true;
  }

  if (cbData.startsWith("p2p_pm_")) {
    const w = wizards.get(userId);
    if (!w || w.flow !== "sell" || w.step !== "pm") return true;
    const key = cbData.slice("p2p_pm_".length);
    const map: Record<string, PaymentMethod> = {
      upi: "upi",
      bank_transfer: "bank_transfer",
      bank: "bank_transfer",
      gcash: "gcash",
      mpesa: "mpesa",
      paypal: "paypal",
      wise: "wise",
      cash: "cash",
    };
    w.pm = map[key] ?? "upi";
    w.step = "instr";
    await ctx.sendTgHtml(chatId, `Enter payment instructions (UPI ID, bank details, etc.):`);
    return true;
  }

  if (cbData.startsWith("trade_custom_")) {
    const offerId = cbData.slice("trade_custom_".length);
    const offer = getOffer(offerId);
    if (!offer) {
      await ctx.sendTgHtml(chatId, `Offer gone.`);
      return true;
    }
    wizards.set(userId, {
      flow: "buy",
      step: "trade_amt",
      tradeOfferId: offerId,
      currency: offer.localCurrency,
      browseAmount: wizards.get(userId)?.browseAmount,
    });
    await ctx.sendTgHtml(
      chatId,
      `How much USDC do you want from this listing? (min <b>${offer.minAmount}</b>, max <b>${offer.usdcAmount}</b>)`
    );
    return true;
  }

  if (cbData.startsWith("trade_start_")) {
    const offerId = cbData.slice("trade_start_".length);
    const offer = getOffer(offerId);
    if (!offer) {
      await ctx.sendTgHtml(chatId, `Offer gone or expired.`);
      return true;
    }
    const w = wizards.get(userId);
    const browseCap = w?.browseAmount;
    const req = browseCap != null ? Math.min(browseCap, offer.usdcAmount) : offer.usdcAmount;
    const chk = canInitiateTrade(userId, req);
    if (!chk.allowed) {
      await ctx.sendTgHtml(chatId, `⚠️ ${chk.reason}`);
      return true;
    }
    await openTradeFromOffer(userId, chatId, ctx, offerId, req, browseCap);
    return true;
  }

  if (cbData.startsWith("trade_paid_")) {
    const id = cbData.slice("trade_paid_".length);
    const tr = getTrade(id);
    if (tr && tr.buyerUserId === userId) await promptPaymentProof(tr, userId, chatId, ctx);
    return true;
  }

  if (cbData.startsWith("p2p_proof_skip_")) {
    const id = cbData.slice("p2p_proof_skip_".length);
    const tr = getTrade(id);
    if (tr && tr.buyerUserId === userId) await markBuyerPaid(tr, ctx);
    return true;
  }

  if (cbData.startsWith("trade_release_")) {
    const id = cbData.slice("trade_release_".length);
    const tr = getTrade(id);
    if (tr && tr.sellerUserId === userId) await releaseTradeToBuyer(tr, ctx);
    return true;
  }

  if (cbData.startsWith("trade_dispute_")) {
    const id = cbData.slice("trade_dispute_".length);
    const tr = getTrade(id);
    if (tr) {
      updateTradeStatus(id, "disputed", { disputeReason: "Seller dispute" });
      if (ctx.adminTelegramId) {
        await ctx.sendTgHtml(ctx.adminTelegramId, `🚨 P2P dispute <code>${id}</code>`);
        await ctx.sendTgWithKeyboard(ctx.adminTelegramId, `Resolve:`, adminDisputeKeyboard(id));
      }
      await ctx.sendTgHtml(chatId, `Dispute opened.`);
    }
    return true;
  }

  if (cbData.startsWith("trade_cancel_")) {
    const id = cbData.slice("trade_cancel_".length);
    const tr = getTrade(id);
    if (tr && !tr.paidAt) {
      stopTradeTimer(tr.tradeId);
      releaseOfferLock(tr.offerId);
      updateTradeStatus(id, "cancelled");
      await ctx.sendTgHtml(chatId, `Trade cancelled.`);
    }
    return true;
  }

  if (cbData.startsWith("admin_release_buyer_")) {
    if (!telegramUserId || telegramUserId !== ctx.adminTelegramId) return true;
    const id = cbData.slice("admin_release_buyer_".length);
    const tr = getTrade(id);
    if (tr) await releaseTradeToBuyer(tr, ctx);
    return true;
  }
  if (cbData.startsWith("admin_release_seller_")) {
    if (!telegramUserId || telegramUserId !== ctx.adminTelegramId) return true;
    const id = cbData.slice("admin_release_seller_".length);
    const tr = getTrade(id);
    const kp = loadEscrowKp();
    const seller = tr ? await getCustodialWallet(tr.sellerUserId) : null;
    if (tr && kp && seller) {
      try {
        await releaseEscrow({
          connection: ctx.connection,
          escrowKeypair: kp,
          receiverPubkey: new PublicKey(seller.publicKey),
          mint: await escrowMint(),
          amountHuman: tr.usdcAmount,
        });
        updateTradeStatus(id, "cancelled", { adminNotes: "returned_to_seller" });
        deleteOffer(tr.offerId);
        stopTradeTimer(tr.tradeId);
        await ctx.sendTgHtml(chatId, `USDC returned to seller.`);
      } catch (e) {
        await ctx.sendTgHtml(chatId, `Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return true;
  }

  return false;
}

export function registerP2PIntervals(
  _connection: Connection,
  sendTgHtml: (chatId: string, html: string) => Promise<unknown>,
  adminId?: string
): void {
  void _connection;
  setInterval(() => {
    cancelExpiredOffers();
  }, 600_000);
  setInterval(() => {
    const ids = cancelStaleTrades();
    for (const id of ids) {
      if (adminId) {
        void sendTgHtml(adminId, `⏱ P2P trade <code>${id}</code> auto-disputed (seller timeout after buyer marked paid).`);
      }
    }
  }, 1_800_000);
}
