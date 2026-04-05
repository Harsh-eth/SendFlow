import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { getCustodialWallet } from "./custodialWallet";

export interface StreakReward {
  day: number;
  reward: string;
  claimed: boolean;
}

export interface UserStreak {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string;
  totalActiveDays: number;
  streakFreezeUsed: boolean;
  rewards: StreakReward[];
  weekFreezeWeekKey?: string;
}

const STREAK_REWARDS: Record<number, string> = {
  3: "🎯 0.05 USDC bonus",
  7: "⭐ 0.20 USDC bonus + Gold badge",
  14: "💎 0.50 USDC bonus + Diamond badge",
  30: "🏆 2.00 USDC bonus + Champion badge",
};

const REWARD_USDC: Record<number, number> = {
  3: 0.05,
  7: 0.2,
  14: 0.5,
  30: 2,
};

const streaks = new Map<string, UserStreak>();
const leaderboardStreak = new Map<string, number>();

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function prevDay(s: string): string {
  const d = new Date(s + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return dayStr(d);
}

export function recordActivity(userId: string): UserStreak {
  const today = dayStr(new Date());
  let st = streaks.get(userId);
  if (!st) {
    st = {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: "",
      totalActiveDays: 0,
      streakFreezeUsed: false,
      rewards: [],
    };
    streaks.set(userId, st);
  }

  if (st.lastActiveDate === today) {
    leaderboardStreak.set(userId, st.currentStreak);
    return st;
  }

  const y = prevDay(today);
  if (st.lastActiveDate === "" || st.lastActiveDate === y) {
    st.currentStreak += 1;
  } else if (st.lastActiveDate === prevDay(y)) {
    const wk = `W${new Date().getFullYear()}-${Math.ceil(new Date().getDate() / 7)}`;
    if (st.weekFreezeWeekKey !== wk && !st.streakFreezeUsed) {
      st.streakFreezeUsed = true;
      st.weekFreezeWeekKey = wk;
    } else {
      st.currentStreak = 1;
    }
  } else {
    st.currentStreak = 1;
  }

  st.lastActiveDate = today;
  st.totalActiveDays += 1;
  st.longestStreak = Math.max(st.longestStreak, st.currentStreak);
  leaderboardStreak.set(userId, st.currentStreak);

  for (const milestone of [3, 7, 14, 30] as const) {
    if (st.currentStreak === milestone && !st.rewards.some((r) => r.day === milestone)) {
      st.rewards.push({
        day: milestone,
        reward: STREAK_REWARDS[milestone] ?? "",
        claimed: false,
      });
    }
  }

  return st;
}

export function getStreak(userId: string): UserStreak {
  return (
    streaks.get(userId) ?? {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: "",
      totalActiveDays: 0,
      streakFreezeUsed: false,
      rewards: [],
    }
  );
}

export function checkStreakReward(userId: string): StreakReward | null {
  const st = streaks.get(userId);
  if (!st) return null;
  const unclaimed = st.rewards.find((r) => !r.claimed);
  return unclaimed ?? null;
}

export async function payStreakReward(userId: string, escrow: Keypair, connection: Connection): Promise<void> {
  const st = streaks.get(userId);
  if (!st) return;
  const r = st.rewards.find((x) => !x.claimed);
  if (!r) return;
  const usdc = REWARD_USDC[r.day];
  if (!usdc || usdc <= 0) {
    r.claimed = true;
    return;
  }
  const custodial = await getCustodialWallet(userId);
  if (!custodial) return;
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const recv = new PublicKey(custodial.publicKey);
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
  r.claimed = true;
}

export function getStreakLeaderboard(): { userId: string; streak: number; badge: string }[] {
  return [...leaderboardStreak.entries()]
    .map(([userId, streak]) => ({
      userId,
      streak,
      badge: streak >= 30 ? "Champion" : streak >= 14 ? "Diamond" : streak >= 7 ? "Gold" : streak >= 3 ? "Bronze" : "",
    }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 50);
}

export function averageStreak(): number {
  if (streaks.size === 0) return 0;
  let s = 0;
  for (const v of streaks.values()) s += v.currentStreak;
  return s / streaks.size;
}
