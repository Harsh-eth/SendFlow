import { randomBytes } from "node:crypto";
import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";

export type TradeType = "buy" | "sell";
export type TradeStatus =
  | "open"
  | "matched"
  | "escrow"
  | "completed"
  | "disputed"
  | "cancelled";

export type PaymentMethod = "upi" | "bank_transfer" | "gcash" | "mpesa" | "cash" | "paypal" | "wise";

export interface P2POffer {
  offerId: string;
  userId: string;
  displayName: string;
  type: TradeType;
  usdcAmount: number;
  minAmount: number;
  maxAmount: number;
  pricePerUsdc: number;
  localCurrency: string;
  paymentMethods: PaymentMethod[];
  country: string;
  city?: string;
  instructions: string;
  completedTrades: number;
  disputedTrades: number;
  avgResponseMinutes: number;
  createdAt: string;
  expiresAt: string;
  escrowTxHash?: string;
  /** Offer pulled from book while trade in flight */
  locked: boolean;
  /** USDC size when offer was first posted (for “was X” display) */
  initialUsdcAmount?: number;
}

export interface P2PTrade {
  tradeId: string;
  offerId: string;
  buyerUserId: string;
  sellerUserId: string;
  usdcAmount: number;
  localAmount: number;
  localCurrency: string;
  paymentMethod: PaymentMethod;
  status: TradeStatus;
  escrowTxHash?: string;
  paymentProofUrl?: string;
  /** Telegram file_id of buyer payment screenshot */
  paymentProofFileId?: string;
  releaseTxHash?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  completedAt?: string;
  disputeReason?: string;
  adminNotes?: string;
  /** Copy of seller fiat instructions if offer row is removed */
  sellerInstructionsSnapshot?: string;
  buyerTradeMessageId?: number;
  sellerNotifyMessageId?: number;
}

export interface P2PReputation {
  userId: string;
  completedTrades: number;
  disputedTrades: number;
  totalVolume: number;
  avgResponseMinutes: number;
  rating: number;
  verified: boolean;
  badges: string[];
}

const OFFERS_FILE = "p2p-offers.json";
const TRADES_FILE = "p2p-trades.json";
const REP_FILE = "p2p-reputation.json";

const offers = new Map<string, P2POffer>();
const trades = new Map<string, P2PTrade>();
const reputations = new Map<string, P2PReputation>();
const lastSeenMs = new Map<string, number>();

function loadMaps(): void {
  offers.clear();
  trades.clear();
  reputations.clear();
  const o = persistLoad<Record<string, P2POffer>>(OFFERS_FILE, {});
  for (const [k, v] of Object.entries(o)) offers.set(k, v);
  const t = persistLoad<Record<string, P2PTrade>>(TRADES_FILE, {});
  for (const [k, v] of Object.entries(t)) trades.set(k, v);
  const r = persistLoad<Record<string, P2PReputation>>(REP_FILE, {});
  for (const [k, v] of Object.entries(r)) reputations.set(k, v);
}

function persistOffers(): void {
  persistSave(OFFERS_FILE, Object.fromEntries(offers));
}
function persistTrades(): void {
  persistSave(TRADES_FILE, Object.fromEntries(trades));
}
function persistRep(): void {
  persistSave(REP_FILE, Object.fromEntries(reputations));
}

loadMaps();

function genId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

function offerExpiryHours(): number {
  const n = Number(process.env.P2P_OFFER_EXPIRY_HOURS ?? "24");
  return Number.isFinite(n) && n > 0 ? n : 24;
}

export function touchP2pActivity(userId: string): void {
  lastSeenMs.set(userId, Date.now());
}

export function isUserOnline(userId: string): boolean {
  return Date.now() - (lastSeenMs.get(userId) ?? 0) < 5 * 60_000;
}

export function getReputation(userId: string): P2PReputation {
  return (
    reputations.get(userId) ?? {
      userId,
      completedTrades: 0,
      disputedTrades: 0,
      totalVolume: 0,
      avgResponseMinutes: 30,
      rating: 5,
      verified: false,
      badges: [],
    }
  );
}

export function updateReputation(userId: string, completed: boolean, responseMinutes: number, volumeUsdc?: number): void {
  const r = getReputation(userId);
  if (completed) {
    r.completedTrades += 1;
    r.totalVolume += volumeUsdc ?? 1;
  } else {
    r.disputedTrades += 1;
  }
  const n = r.completedTrades + r.disputedTrades;
  r.avgResponseMinutes = n <= 1 ? responseMinutes : (r.avgResponseMinutes * (n - 1) + responseMinutes) / n;
  r.rating = Math.max(0, Math.min(5, 5 - r.disputedTrades * 0.5));
  if (r.completedTrades >= 50) r.badges = [...new Set([...r.badges, "high_volume"])];
  if (r.avgResponseMinutes < 15 && r.completedTrades >= 5) r.badges = [...new Set([...r.badges, "fast_responder"])];
  if (r.completedTrades >= 20 && r.disputedTrades === 0) r.badges = [...new Set([...r.badges, "trusted"])];
  reputations.set(userId, r);
  persistRep();
}

export function createOffer(
  userId: string,
  offer: Omit<P2POffer, "offerId" | "createdAt" | "expiresAt" | "locked"> & { escrowTxHash?: string }
): P2POffer {
  const now = Date.now();
  const o: P2POffer = {
    ...offer,
    offerId: genId("of"),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + offerExpiryHours() * 3600_000).toISOString(),
    locked: false,
    initialUsdcAmount: offer.usdcAmount,
  };
  offers.set(o.offerId, o);
  persistOffers();
  return o;
}

export function getOffer(offerId: string): P2POffer | undefined {
  return offers.get(offerId);
}

export function updateOffer(offerId: string, patch: Partial<P2POffer>): P2POffer | undefined {
  const o = offers.get(offerId);
  if (!o) return undefined;
  const next = { ...o, ...patch };
  offers.set(offerId, next);
  persistOffers();
  return next;
}

export function deleteOffer(offerId: string): void {
  offers.delete(offerId);
  persistOffers();
}

export function getOffers(filters: {
  type: TradeType;
  currency: string;
  country?: string;
  minAmount?: number;
  maxAmount?: number;
}): P2POffer[] {
  const now = Date.now();
  const cur = filters.currency.toUpperCase();
  return [...offers.values()].filter((o) => {
    if (o.type !== filters.type) return false;
    if (o.localCurrency.toUpperCase() !== cur) return false;
    if (o.locked) return false;
    if (new Date(o.expiresAt).getTime() < now) return false;
    if (filters.country && o.country !== filters.country) return false;
    if (filters.minAmount != null && o.usdcAmount < filters.minAmount) return false;
    if (filters.maxAmount != null && o.usdcAmount > filters.maxAmount) return false;
    return true;
  });
}

export function matchBestOffer(
  userId: string,
  type: TradeType,
  amount: number,
  currency: string
): P2POffer | null {
  // Buyer wants USDC → match sell listings
  const wantType: TradeType = type === "buy" ? "sell" : "buy";
  const list = getOffers({ type: wantType, currency }).filter((o) => o.userId !== userId);
  if (!list.length) return null;
  if (wantType === "sell") {
    const ok = list.filter((o) => o.usdcAmount >= amount);
    if (!ok.length) return null;
    ok.sort((a, b) => a.pricePerUsdc - b.pricePerUsdc);
    return ok[0] ?? null;
  }
  const okb = list.filter((o) => o.usdcAmount >= amount);
  if (!okb.length) return null;
  okb.sort((a, b) => b.pricePerUsdc - a.pricePerUsdc);
  return okb[0] ?? null;
}

export function createTrade(offerId: string, initiatorUserId: string, requestedAmount: number): P2PTrade | null {
  const offer = offers.get(offerId);
  if (!offer || offer.locked || new Date(offer.expiresAt).getTime() < Date.now()) return null;
  if (offer.userId === initiatorUserId) return null;
  const tradeAmount = Math.min(requestedAmount, offer.usdcAmount);
  if (tradeAmount + 1e-9 < offer.minAmount) return null;
  if (tradeAmount <= 0) return null;

  const sellerUserId = offer.type === "sell" ? offer.userId : initiatorUserId;
  const buyerUserId = offer.type === "sell" ? initiatorUserId : offer.userId;
  const now = new Date().toISOString();
  const trade: P2PTrade = {
    tradeId: genId("tr"),
    offerId,
    buyerUserId,
    sellerUserId,
    usdcAmount: tradeAmount,
    localAmount: Math.round(tradeAmount * offer.pricePerUsdc * 100) / 100,
    localCurrency: offer.localCurrency,
    paymentMethod: offer.paymentMethods[0] ?? "upi",
    status: "matched",
    escrowTxHash: offer.escrowTxHash,
    createdAt: now,
    updatedAt: now,
    sellerInstructionsSnapshot: offer.instructions,
  };
  trades.set(trade.tradeId, trade);
  offer.locked = true;
  offers.set(offerId, offer);
  persistTrades();
  persistOffers();
  return trade;
}

/** After USDC is released to buyer: shrink or delete offer, unlock if remainder stays listed. */
export function reduceOfferAfterCompletedTrade(trade: P2PTrade): { dustBelowMinUsdc: number } {
  const o = offers.get(trade.offerId);
  if (!o) return { dustBelowMinUsdc: 0 };
  const newAmt = Math.round((o.usdcAmount - trade.usdcAmount) * 1_000_000) / 1_000_000;
  if (newAmt <= 1e-6) {
    deleteOffer(trade.offerId);
    return { dustBelowMinUsdc: 0 };
  }
  if (newAmt + 1e-9 < o.minAmount) {
    deleteOffer(trade.offerId);
    return { dustBelowMinUsdc: newAmt };
  }
  o.usdcAmount = newAmt;
  o.locked = false;
  offers.set(trade.offerId, o);
  persistOffers();
  return { dustBelowMinUsdc: 0 };
}

export function bumpOffer(userId: string): boolean {
  const o = getOpenOfferForUser(userId);
  if (!o) return false;
  o.createdAt = new Date().toISOString();
  offers.set(o.offerId, o);
  persistOffers();
  return true;
}

export function getP2pHealthSnapshot(): {
  openOffers: number;
  openSellOffers: number;
  openBuyOffers: number;
  activeTrades: number;
  completedToday: number;
  volumeTodayUsdc: number;
  disputeCount: number;
} {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let openOffers = 0;
  let openSellOffers = 0;
  let openBuyOffers = 0;
  for (const o of offers.values()) {
    if (o.locked) continue;
    if (new Date(o.expiresAt).getTime() < now) continue;
    openOffers++;
    if (o.type === "sell") openSellOffers++;
    else openBuyOffers++;
  }
  const activeTrades = [...trades.values()].filter((t) => ["matched", "escrow"].includes(t.status)).length;
  let completedToday = 0;
  let volumeTodayUsdc = 0;
  for (const t of trades.values()) {
    if (t.status !== "completed" || !t.completedAt?.startsWith(today)) continue;
    completedToday++;
    volumeTodayUsdc += t.usdcAmount;
  }
  const disputeCount = [...trades.values()].filter((t) => t.status === "disputed").length;
  return { openOffers, openSellOffers, openBuyOffers, activeTrades, completedToday, volumeTodayUsdc, disputeCount };
}

export function listDisputedTrades(): P2PTrade[] {
  return [...trades.values()].filter((t) => t.status === "disputed");
}

export function listTradesForUser(userId: string): P2PTrade[] {
  return [...trades.values()].filter((t) => t.buyerUserId === userId || t.sellerUserId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listNonTerminalTrades(): P2PTrade[] {
  return [...trades.values()].filter((t) => !["completed", "cancelled"].includes(t.status));
}

export function updateTradeStatus(
  tradeId: string,
  status: TradeStatus,
  data?: Partial<P2PTrade>
): P2PTrade | undefined {
  const t = trades.get(tradeId);
  if (!t) return undefined;
  const next = { ...t, ...data, status, updatedAt: new Date().toISOString() };
  trades.set(tradeId, next);
  persistTrades();
  return next;
}

export function getTrade(tradeId: string): P2PTrade | undefined {
  return trades.get(tradeId);
}

export function getActiveTrade(userId: string): P2PTrade | null {
  for (const t of trades.values()) {
    if (t.buyerUserId !== userId && t.sellerUserId !== userId) continue;
    if (["completed", "cancelled"].includes(t.status)) continue;
    return t;
  }
  return null;
}

export function getOpenOfferForUser(userId: string): P2POffer | null {
  const now = Date.now();
  for (const o of offers.values()) {
    if (o.userId !== userId) continue;
    if (o.locked) continue;
    if (new Date(o.expiresAt).getTime() < now) continue;
    return o;
  }
  return null;
}

/** Latest non-expired offer for this user (including locked / in-trade). */
export function getNonExpiredOfferForUser(userId: string): P2POffer | null {
  const now = Date.now();
  let best: P2POffer | null = null;
  for (const o of offers.values()) {
    if (o.userId !== userId) continue;
    if (new Date(o.expiresAt).getTime() < now) continue;
    if (!best || new Date(o.createdAt).getTime() > new Date(best.createdAt).getTime()) best = o;
  }
  return best;
}

export function getLeaderboard(currency: string): P2POffer[] {
  const cur = currency.toUpperCase();
  const sellers = getOffers({ type: "sell", currency: cur });
  sellers.sort((a, b) => {
    const ra = getReputation(a.userId);
    const rb = getReputation(b.userId);
    return rb.completedTrades - ra.completedTrades;
  });
  return sellers.slice(0, 10);
}

export function cancelExpiredOffers(): void {
  const now = Date.now();
  for (const [id, o] of offers) {
    if (new Date(o.expiresAt).getTime() >= now) continue;
    if (o.locked) continue;
    offers.delete(id);
  }
  persistOffers();
}

export function cancelStaleTrades(): string[] {
  const timeoutMin = Number(process.env.P2P_TRADE_TIMEOUT_MINUTES ?? "30");
  const ms = (Number.isFinite(timeoutMin) ? timeoutMin : 30) * 60_000;
  const notified: string[] = [];
  const now = Date.now();
  for (const [id, t] of trades) {
    if (t.status !== "matched" || !t.paidAt) continue;
    const paid = new Date(t.paidAt).getTime();
    if (now - paid < ms) continue;
    updateTradeStatus(id, "disputed", { disputeReason: "Seller did not release within timeout", adminNotes: "auto_stale" });
    notified.push(id);
  }
  return notified;
}

export function releaseOfferLock(offerId: string): void {
  const o = offers.get(offerId);
  if (!o) return;
  o.locked = false;
  offers.set(offerId, o);
  persistOffers();
}

export function __resetP2pMarketForTests(): void {
  offers.clear();
  trades.clear();
  reputations.clear();
  lastSeenMs.clear();
}
