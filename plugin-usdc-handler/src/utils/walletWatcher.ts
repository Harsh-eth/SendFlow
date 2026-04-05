import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { loggerCompat as logger } from "@sendflow/plugin-intent-parser";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MAX_WATCHES_PER_USER = 3;

export interface WatchAlert {
  userId: string;
  walletAddress: string;
  label: string;
  condition: "any" | "above" | "below";
  threshold?: number;
  subscriptionId?: number;
}

const watchStore = new Map<string, WatchAlert[]>();
let notifyCallback: ((userId: string, text: string) => Promise<void>) | null = null;

export function setWatchNotifyCallback(cb: (userId: string, text: string) => Promise<void>): void {
  notifyCallback = cb;
}

export async function addWatch(
  alert: WatchAlert,
  connection: Connection
): Promise<{ success: boolean; error?: string }> {
  const userWatches = watchStore.get(alert.userId) ?? [];
  if (userWatches.length >= MAX_WATCHES_PER_USER) {
    return { success: false, error: `Maximum ${MAX_WATCHES_PER_USER} watches allowed. Remove one first.` };
  }

  const existing = userWatches.find(
    (w) => w.walletAddress === alert.walletAddress && w.condition === alert.condition
  );
  if (existing) {
    return { success: false, error: "You already have an alert on this wallet with the same condition." };
  }

  try {
    const walletPk = new PublicKey(alert.walletAddress);
    const ata = await getAssociatedTokenAddress(USDC_MINT, walletPk);

    const subId = connection.onAccountChange(ata, async (accountInfo) => {
      try {
        const rawAmount = accountInfo.data.readBigUInt64LE(64);
        const balance = Number(rawAmount) / 1e6;

        let shouldNotify = false;
        let message = "";

        if (alert.condition === "any") {
          shouldNotify = true;
          message = `🔔 Alert: ${alert.label}'s wallet had activity!\nUSDC balance: ${balance.toFixed(2)} USDC`;
        } else if (alert.condition === "below" && alert.threshold !== undefined && balance < alert.threshold) {
          shouldNotify = true;
          message = `🔔 Alert: ${alert.label}'s wallet dropped below ${alert.threshold} USDC!\nCurrent balance: ${balance.toFixed(2)} USDC`;
        } else if (alert.condition === "above" && alert.threshold !== undefined && balance > alert.threshold) {
          shouldNotify = true;
          message = `🔔 Alert: ${alert.label}'s wallet is above ${alert.threshold} USDC!\nCurrent balance: ${balance.toFixed(2)} USDC`;
        }

        if (shouldNotify && notifyCallback) {
          await notifyCallback(alert.userId, message);
        }
      } catch (err) {
        logger.warn(`WalletWatcher parse error: ${err}`);
      }
    });

    alert.subscriptionId = subId;
    userWatches.push(alert);
    watchStore.set(alert.userId, userWatches);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to set up watch: ${err}` };
  }
}

export function removeWatch(
  userId: string,
  label: string,
  connection: Connection
): boolean {
  const userWatches = watchStore.get(userId);
  if (!userWatches) return false;

  const idx = userWatches.findIndex(
    (w) => w.label.toLowerCase() === label.toLowerCase()
  );
  if (idx === -1) return false;

  const watch = userWatches[idx];
  if (watch.subscriptionId !== undefined) {
    connection.removeAccountChangeListener(watch.subscriptionId);
  }
  userWatches.splice(idx, 1);
  watchStore.set(userId, userWatches);
  return true;
}

export function listWatches(userId: string): WatchAlert[] {
  return watchStore.get(userId) ?? [];
}
