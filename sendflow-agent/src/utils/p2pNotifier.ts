import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";
import type { P2POffer } from "./p2pMarket";
import { p2pOfferActionsKeyboard } from "./keyboards";
import { resolveTelegramChatId } from "./telegramChatRegistry";

const FILE = "p2p-buy-searches.json";

export type BuySearchRec = { currency: string; amount: number; lastSearchAt: string };

let cache: Record<string, BuySearchRec> | null = null;

function load(): Record<string, BuySearchRec> {
  if (cache) return cache;
  cache = persistLoad<Record<string, BuySearchRec>>(FILE, {});
  return cache;
}

export function recordBuySearch(userId: string, currency: string, amount: number): void {
  const m = { ...load() };
  m[userId] = {
    currency: currency.toUpperCase(),
    amount,
    lastSearchAt: new Date().toISOString(),
  };
  cache = m;
  persistSave(FILE, m);
}

export type NotifyOfferCtx = {
  sendTgWithKeyboard: (chatId: string, html: string, kb: import("./keyboards").InlineKeyboard) => Promise<unknown>;
};

/** Notify users who searched for this currency within the last hour (best-effort). */
export async function notifyPotentialBuyers(offer: P2POffer, ctx: NotifyOfferCtx): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const [entityId, search] of Object.entries(load())) {
    if (entityId === offer.userId) continue;
    if (search.currency !== offer.localCurrency.toUpperCase()) continue;
    if (search.amount > offer.usdcAmount + 1e-9) continue;
    const age = now - new Date(search.lastSearchAt).getTime();
    if (age > 3_600_000) continue;
    const chat = resolveTelegramChatId(entityId);
    await ctx.sendTgWithKeyboard(
      chat,
      [
        `🔔 <b>New offer matching your search</b>`,
        `${offer.displayName} — <b>${offer.usdcAmount} USDC</b> @ ${offer.localCurrency} ${offer.pricePerUsdc.toFixed(2)}`,
        `Via: ${offer.paymentMethods.join(", ")}`,
      ].join("\n"),
      p2pOfferActionsKeyboard(offer)
    );
    n++;
  }
  return n;
}
