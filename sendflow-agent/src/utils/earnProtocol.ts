import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { stakeKeyboard, stakeStatusKeyboard, type InlineKeyboard } from "./keyboards";

export const REWARD_RATES: Record<7 | 30 | 90, number> = {
  7: 0.05,
  30: 0.1,
  90: 0.18,
};

const MAX_STAKES = 10_000;
const stakes = new Map<string, StakePosition>();

export interface StakePosition {
  userId: string;
  stakedAmount: number;
  stakedAt: string;
  lockPeriodDays: 7 | 30 | 90;
  rewardRate: number;
  earnedSoFar: number;
  maturesAt: string;
  status: "active" | "matured" | "withdrawn";
}

function trim(): void {
  while (stakes.size >= MAX_STAKES) {
    const first = stakes.keys().next().value as string | undefined;
    if (first) stakes.delete(first);
    else break;
  }
}

export function getStakeKeyboard(): InlineKeyboard {
  return stakeKeyboard();
}

export function getStakeStatusKeyboard(): InlineKeyboard {
  return stakeStatusKeyboard();
}

export function stakeUsdc(userId: string, amount: number, lockDays: 7 | 30 | 90): StakePosition {
  trim();
  const rate = REWARD_RATES[lockDays];
  const stakedAt = new Date();
  const matures = new Date(stakedAt.getTime() + lockDays * 86_400_000);
  const pos: StakePosition = {
    userId,
    stakedAmount: amount,
    stakedAt: stakedAt.toISOString(),
    lockPeriodDays: lockDays,
    rewardRate: rate,
    earnedSoFar: 0,
    maturesAt: matures.toISOString(),
    status: "active",
  };
  stakes.set(userId, pos);
  return pos;
}

export function getStakePosition(userId: string): StakePosition | null {
  return stakes.get(userId) ?? null;
}

export function calculateEarned(stake: StakePosition): number {
  const start = new Date(stake.stakedAt).getTime();
  const end = Math.min(Date.now(), new Date(stake.maturesAt).getTime());
  const elapsedYears = (end - start) / (365.25 * 86_400_000);
  return stake.stakedAmount * stake.rewardRate * Math.max(0, elapsedYears);
}

export function isMatured(stake: StakePosition): boolean {
  return Date.now() >= new Date(stake.maturesAt).getTime();
}

export async function withdrawStake(userId: string, escrow: Keypair, connection: Connection): Promise<string> {
  const stake = stakes.get(userId);
  if (!stake || stake.status !== "active") throw new Error("No active stake");
  if (!isMatured(stake)) throw new Error("Stake still locked");
  const custodial = await import("./custodialWallet").then((m) => m.getCustodialWallet(userId));
  if (!custodial) throw new Error("No custodial wallet");
  const earned = calculateEarned(stake);
  const total = stake.stakedAmount + earned;
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const recv = new PublicKey(custodial.publicKey);
  const raw = BigInt(Math.round(total * 1_000_000));
  const escrowAta = await getAssociatedTokenAddress(mint, escrow.publicKey);
  const recvAta = await getOrCreateAssociatedTokenAccount(connection, escrow, mint, recv);
  const ix = createTransferInstruction(escrowAta, recvAta.address, escrow.publicKey, raw);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = escrow.publicKey;
  tx.sign(escrow);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  stake.status = "withdrawn";
  stakes.delete(userId);
  return sig;
}
