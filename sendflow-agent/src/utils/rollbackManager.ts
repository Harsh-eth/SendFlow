import { Connection, Keypair } from "@solana/web3.js";
import {
  findUserIdByWalletAddress,
  getCustodialWallet,
  executeRollbackRecipientTransfer,
} from "./custodialWallet";

export interface RollbackWindow {
  txHash: string;
  userId: string;
  amount: number;
  recipientWallet: string;
  senderWallet: string;
  expiresAt: number;
  cancelled: boolean;
}

const MAX_RB = 10_000;
const rollbackWindows = new Map<string, RollbackWindow>();

function trim(): void {
  while (rollbackWindows.size >= MAX_RB) {
    const first = rollbackWindows.keys().next().value as string | undefined;
    if (first) rollbackWindows.delete(first);
    else break;
  }
}

export function openRollbackWindow(
  userId: string,
  txHash: string,
  amount: number,
  recipientWallet: string,
  senderWallet: string
): RollbackWindow {
  trim();
  const w: RollbackWindow = {
    txHash,
    userId,
    amount,
    recipientWallet,
    senderWallet,
    expiresAt: Date.now() + 30_000,
    cancelled: false,
  };
  rollbackWindows.set(userId, w);
  return w;
}

export function isRollbackEligible(userId: string): boolean {
  const w = rollbackWindows.get(userId);
  return Boolean(w && !w.cancelled && Date.now() < w.expiresAt);
}

export function getRollbackWindow(userId: string): RollbackWindow | undefined {
  return rollbackWindows.get(userId);
}

export function expireRollback(userId: string): void {
  rollbackWindows.delete(userId);
}

export async function executeRollback(userId: string, _escrowKeypair: Keypair, connection: Connection): Promise<string> {
  const w = rollbackWindows.get(userId);
  if (!w || w.cancelled || Date.now() >= w.expiresAt) throw new Error("Rollback window closed");
  const recipientUserId = await findUserIdByWalletAddress(w.recipientWallet);
  if (!recipientUserId) {
    throw new Error(
      "Recipient is not a SendFlow custodial wallet. Open Solscan and contact them manually if needed."
    );
  }
  const senderWallet = await getCustodialWallet(userId);
  if (!senderWallet || senderWallet.publicKey !== w.senderWallet) {
    throw new Error("Sender wallet mismatch");
  }
  const sig = await executeRollbackRecipientTransfer(connection, recipientUserId, w.senderWallet, w.amount);
  w.cancelled = true;
  rollbackWindows.delete(userId);
  return sig;
}
