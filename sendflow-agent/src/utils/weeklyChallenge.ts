import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { getCustodialWallet } from "./custodialWallet";
import { getStreak } from "./streakSystem";

export interface Challenge {
  challengeId: string;
  title: string;
  description: string;
  goal: number;
  metric: "transfers" | "volume" | "referrals" | "streak_days";
  prizePool: number;
  startDate: string;
  endDate: string;
  participants: { userId: string; progress: number }[];
  winners: string[];
  status: "active" | "ended";
}

const WEEKLY_CHALLENGES: Omit<
  Challenge,
  "challengeId" | "startDate" | "endDate" | "participants" | "winners" | "status"
>[] = [
  { title: "Volume Sprint", description: "Send the most USDC this week", goal: 100, metric: "volume", prizePool: 5 },
  { title: "Referral Race", description: "Refer the most friends this week", goal: 5, metric: "referrals", prizePool: 3 },
  { title: "Transfer Champion", description: "Make the most transfers this week", goal: 20, metric: "transfers", prizePool: 2 },
  { title: "Streak Master", description: "Maintain longest streak this week", goal: 7, metric: "streak_days", prizePool: 4 },
];

let current: Challenge | null = null;
let weekIndex = 0;

function mondayStart(d: Date): Date {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  m.setUTCHours(9, 0, 0, 0);
  return m;
}

function nextSunday(d: Date): Date {
  const start = mondayStart(d);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

export function rotateChallengeIfNeeded(): Challenge | null {
  const now = new Date();
  const start = mondayStart(now);
  const end = nextSunday(now);
  if (current && current.status === "active" && now <= new Date(current.endDate)) {
    return current;
  }
  const template = WEEKLY_CHALLENGES[weekIndex % WEEKLY_CHALLENGES.length]!;
  weekIndex += 1;
  current = {
    challengeId: `ch_${start.toISOString().slice(0, 10)}`,
    ...template,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    participants: [],
    winners: [],
    status: "active",
  };
  return current;
}

export function getCurrentChallenge(): Challenge | null {
  return rotateChallengeIfNeeded();
}

export function getChallengeLeaderboard(challengeId: string): { userId: string; progress: number; rank: number }[] {
  const ch = current?.challengeId === challengeId ? current : null;
  if (!ch) return [];
  const sorted = [...ch.participants].sort((a, b) => b.progress - a.progress);
  return sorted.map((p, i) => ({ userId: p.userId, progress: p.progress, rank: i + 1 }));
}

export function updateChallengeProgress(userId: string, metric: string, value: number): void {
  const ch = rotateChallengeIfNeeded();
  if (!ch || ch.metric !== metric) return;
  let p = ch.participants.find((x) => x.userId === userId);
  if (!p) {
    p = { userId, progress: 0 };
    ch.participants.push(p);
  }
  p.progress = value;
}

export function bumpChallengeForUser(
  userId: string,
  opts: { volumeDelta?: number; transferDelta?: number; referralDelta?: number }
): void {
  const ch = rotateChallengeIfNeeded();
  if (!ch) return;
  let p = ch.participants.find((x) => x.userId === userId);
  if (!p) {
    p = { userId, progress: 0 };
    ch.participants.push(p);
  }
  if (ch.metric === "volume" && opts.volumeDelta) p.progress += opts.volumeDelta;
  if (ch.metric === "transfers" && opts.transferDelta) p.progress += opts.transferDelta;
  if (ch.metric === "referrals" && opts.referralDelta) p.progress += opts.referralDelta;
  if (ch.metric === "streak_days") p.progress = getStreak(userId).currentStreak;
}

export async function endChallengeAndPay(challenge: Challenge, escrow: Keypair, connection: Connection): Promise<void> {
  if (challenge.status !== "active") return;
  const board = getChallengeLeaderboard(challenge.challengeId);
  const top = board.slice(0, 3);
  const prizes = [3, 1.5, 0.5];
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  for (let i = 0; i < top.length; i++) {
    const uid = top[i]!.userId;
    const usdc = prizes[i];
    if (!usdc) continue;
    const w = await getCustodialWallet(uid);
    if (!w) continue;
    const recv = new PublicKey(w.publicKey);
    const raw = BigInt(Math.round(usdc * 1_000_000));
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
    challenge.winners.push(uid);
  }
  challenge.status = "ended";
}

export function topThreeForNotify(): { userId: string; rank: number; progress: number }[] {
  const ch = getCurrentChallenge();
  if (!ch) return [];
  return getChallengeLeaderboard(ch.challengeId)
    .slice(0, 3)
    .map((r) => ({ userId: r.userId, rank: r.rank, progress: r.progress }));
}
