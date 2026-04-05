import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { sharedGetAllTransfers } from "@sendflow/plugin-intent-parser";
import { getReferralTree } from "./referralSystem";
import { getStakePosition } from "./earnProtocol";
import { getStreak } from "./streakSystem";
import { getCustodialWallet } from "./custodialWallet";

export interface UserStats {
  totalTransfers: number;
  totalVolume: number;
  referralCount: number;
  hasLongStake: boolean;
  userNumber: number;
  longestStreak: number;
  daoVotes: number;
  posPayments: number;
  defiFeaturesUsed: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  condition: (stats: UserStats) => boolean;
  reward?: number;
}

const daoVoteCount = new Map<string, number>();
const posPaymentCount = new Map<string, number>();
const defiCount = new Map<string, number>();
const unlocked = new Map<string, Set<string>>();
let userNumberSeq = 0;
const userNumbers = new Map<string, number>();

export function assignUserNumber(userId: string): number {
  if (userNumbers.has(userId)) return userNumbers.get(userId)!;
  userNumberSeq += 1;
  userNumbers.set(userId, userNumberSeq);
  return userNumberSeq;
}

export function getUserNumber(userId: string): number {
  return userNumbers.get(userId) ?? 999_999;
}

export function recordDaoVote(userId: string): void {
  daoVoteCount.set(userId, (daoVoteCount.get(userId) ?? 0) + 1);
}

export function recordPosPayment(userId: string, n = 1): void {
  posPaymentCount.set(userId, (posPaymentCount.get(userId) ?? 0) + n);
}

export function recordDefiFeature(userId: string): void {
  defiCount.set(userId, (defiCount.get(userId) ?? 0) + 1);
}

function buildStats(userId: string): UserStats {
  const txs = sharedGetAllTransfers(userId);
  const totalVolume = txs.reduce((s, t) => s + (t.amount ?? 0), 0);
  const tree = getReferralTree(userId);
  const stake = getStakePosition(userId);
  const hasLongStake = Boolean(stake && stake.lockPeriodDays >= 30);
  return {
    totalTransfers: txs.length,
    totalVolume,
    referralCount: tree.level1Referrals.length,
    hasLongStake,
    userNumber: getUserNumber(userId),
    longestStreak: getStreak(userId).longestStreak,
    daoVotes: daoVoteCount.get(userId) ?? 0,
    posPayments: posPaymentCount.get(userId) ?? 0,
    defiFeaturesUsed: defiCount.get(userId) ?? 0,
  };
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_send", name: "First Transfer", description: "Sent your first USDC", icon: "💸", condition: (s) => s.totalTransfers >= 1 },
  {
    id: "power_sender",
    name: "Power Sender",
    description: "Sent 10+ transfers",
    icon: "⚡",
    condition: (s) => s.totalTransfers >= 10,
    reward: 0.1,
  },
  { id: "whale", name: "Whale", description: "Sent 1000+ USDC total", icon: "🐋", condition: (s) => s.totalVolume >= 1000, reward: 0.5 },
  { id: "saver", name: "Saver", description: "Staked USDC for 30+ days", icon: "🏦", condition: (s) => s.hasLongStake === true, reward: 0.1 },
  { id: "connector", name: "Connector", description: "Referred 5+ friends", icon: "👥", condition: (s) => s.referralCount >= 5, reward: 0.5 },
  { id: "early_bird", name: "OG", description: "One of first 100 users", icon: "🦅", condition: (s) => s.userNumber <= 100, reward: 1.0 },
  { id: "streaker", name: "30-Day Streaker", description: "Used SendFlow 30 days in a row", icon: "🔥", condition: (s) => s.longestStreak >= 30, reward: 2.0 },
  { id: "dao_voter", name: "Governance Hero", description: "Voted on 3+ DAO proposals", icon: "🗳️", condition: (s) => s.daoVotes >= 3 },
  { id: "merchant", name: "Merchant", description: "Received 10+ POS payments", icon: "🏪", condition: (s) => s.posPayments >= 10, reward: 0.2 },
  { id: "defi_degen", name: "DeFi Degen", description: "Used 5+ DeFi features", icon: "🎰", condition: (s) => s.defiFeaturesUsed >= 5, reward: 0.3 },
];

export function checkAchievements(userId: string): Achievement[] {
  const stats = buildStats(userId);
  return ACHIEVEMENTS.filter((a) => a.condition(stats));
}

export function getUnlockedAchievements(userId: string): Achievement[] {
  const ids = unlocked.get(userId);
  if (!ids?.size) return [];
  return ACHIEVEMENTS.filter((a) => ids.has(a.id));
}

export function getNewlyUnlocked(userId: string): Achievement[] {
  const stats = buildStats(userId);
  const earned = ACHIEVEMENTS.filter((a) => a.condition(stats));
  let set = unlocked.get(userId);
  if (!set) {
    set = new Set();
    unlocked.set(userId, set);
  }
  const fresh: Achievement[] = [];
  for (const a of earned) {
    if (!set.has(a.id)) {
      set.add(a.id);
      fresh.push(a);
    }
  }
  return fresh;
}

export async function grantAchievement(
  userId: string,
  achievement: Achievement,
  escrow: Keypair,
  connection: Connection
): Promise<void> {
  if (!achievement.reward || achievement.reward <= 0) return;
  const custodial = await getCustodialWallet(userId);
  if (!custodial) return;
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const recv = new PublicKey(custodial.publicKey);
  const raw = BigInt(Math.round(achievement.reward * 1_000_000));
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
}

export function generateAchievementCard(achievement: Achievement): string {
  return [
    `🎉 <b>Achievement Unlocked!</b>`,
    `${achievement.icon} <b>${achievement.name}</b>`,
    achievement.description,
    achievement.reward ? `Reward: <b>${achievement.reward} USDC</b> sent to your wallet!` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

export function twitterShareUrl(achievement: Achievement, botUsername: string): string {
  const text = encodeURIComponent(
    `Just unlocked "${achievement.name}" on @SendFlowSol! Sent USDC on Solana with zero bank fees. Try it: t.me/${botUsername} #Solana #SendFlow`
  );
  return `https://twitter.com/intent/tweet?text=${text}`;
}
