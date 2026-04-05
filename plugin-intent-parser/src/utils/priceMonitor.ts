import type { RemittanceIntent } from "../types";
import { loggerCompat as logger } from "./structuredLogger";

export interface ConditionalTransfer {
  userId: string;
  intent: RemittanceIntent;
  condition: {
    asset: string;
    operator: "above" | "below";
    threshold: number;
  };
  createdAt: Date;
  expiresAt: Date;
}

const conditionalStore = new Map<string, ConditionalTransfer>();

const PYTH_PRICE_IDS: Record<string, string> = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  USDC: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let onExecuteCallback: ((ct: ConditionalTransfer) => Promise<void>) | null = null;
let onNotifyCallback: ((userId: string, text: string) => Promise<void>) | null = null;

export function addConditionalTransfer(ct: ConditionalTransfer): void {
  conditionalStore.set(ct.userId, ct);
}

export function cancelConditionalTransfer(userId: string): boolean {
  return conditionalStore.delete(userId);
}

export function getConditionalTransfer(userId: string): ConditionalTransfer | null {
  return conditionalStore.get(userId) ?? null;
}

async function fetchPrice(asset: string): Promise<number | null> {
  const priceId = PYTH_PRICE_IDS[asset.toUpperCase()];
  if (!priceId) return null;

  try {
    const url = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${priceId}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      parsed?: Array<{
        price?: { price?: string; expo?: number };
      }>;
    };
    const parsed = data?.parsed?.[0];
    if (!parsed?.price?.price) return null;
    const price = Number(parsed.price.price);
    const expo = Number(parsed.price.expo ?? 0);
    return price * Math.pow(10, expo);
  } catch (err) {
    logger.warn(`Pyth price fetch failed for ${asset}: ${err}`);
    return null;
  }
}

function checkCondition(
  ct: ConditionalTransfer,
  currentPrice: number
): boolean {
  if (ct.condition.operator === "above") return currentPrice >= ct.condition.threshold;
  if (ct.condition.operator === "below") return currentPrice <= ct.condition.threshold;
  return false;
}

async function tick(): Promise<void> {
  const now = new Date();
  for (const [userId, ct] of conditionalStore) {
    if (now > ct.expiresAt) {
      conditionalStore.delete(userId);
      if (onNotifyCallback) {
        await onNotifyCallback(userId, `⏰ Your conditional transfer expired. ${ct.condition.asset} never reached $${ct.condition.threshold}.`);
      }
      continue;
    }
    const price = await fetchPrice(ct.condition.asset);
    if (price === null) continue;
    if (checkCondition(ct, price)) {
      conditionalStore.delete(userId);
      logger.info(`CONDITIONAL: Condition met for ${userId} — ${ct.condition.asset} = $${price}`);
      if (onNotifyCallback) {
        await onNotifyCallback(userId, `🎯 Condition met! ${ct.condition.asset} is $${price.toFixed(2)}. Executing your transfer now...`);
      }
      if (onExecuteCallback) {
        await onExecuteCallback(ct);
      }
    }
  }
}

export function startPriceMonitor(
  onExecute: (ct: ConditionalTransfer) => Promise<void>,
  onNotify: (userId: string, text: string) => Promise<void>
): void {
  if (monitorInterval) return;
  onExecuteCallback = onExecute;
  onNotifyCallback = onNotify;
  monitorInterval = setInterval(() => {
    tick().catch((e) => logger.error(`PriceMonitor tick error: ${e}`));
  }, 30_000);
  logger.info("PriceMonitor started (30s interval)");
}

export function stopPriceMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
