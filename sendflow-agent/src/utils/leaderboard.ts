import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LB_PATH = join(__dirname, "..", "..", "data", "leaderboard.json");

export interface LeaderboardEntry {
  displayName: string;
  totalSent: number;
  transferCount: number;
  memberSince: string;
  badge: string;
}

interface Store {
  optIn: Record<string, boolean>;
  stats: Record<string, { totalSent: number; transferCount: number; memberSince: string; displayName: string }>;
}

async function loadStore(): Promise<Store> {
  try {
    const raw = await readFile(LB_PATH, "utf8");
    return JSON.parse(raw) as Store;
  } catch {
    return { optIn: {}, stats: {} };
  }
}

async function saveStore(s: Store): Promise<void> {
  await mkdir(dirname(LB_PATH), { recursive: true });
  await writeFile(LB_PATH, JSON.stringify(s, null, 2), "utf8");
}

function badgeFor(rank: number): string {
  if (rank === 0) return "🥇";
  if (rank === 1) return "🥈";
  if (rank === 2) return "🥉";
  if (rank < 10) return "💎";
  return "🚀";
}

export async function updateLeaderboard(userId: string, amount: number, displayName?: string): Promise<void> {
  const s = await loadStore();
  if (!s.optIn[userId]) return;
  const cur = s.stats[userId] ?? {
    totalSent: 0,
    transferCount: 0,
    memberSince: new Date().toISOString(),
    displayName: displayName ?? "Anonymous",
  };
  cur.totalSent += amount;
  cur.transferCount += 1;
  if (displayName) cur.displayName = displayName;
  s.stats[userId] = cur;
  await saveStore(s);
}

export async function joinLeaderboard(userId: string, displayName: string): Promise<void> {
  const s = await loadStore();
  s.optIn[userId] = true;
  if (!s.stats[userId]) {
    s.stats[userId] = {
      totalSent: 0,
      transferCount: 0,
      memberSince: new Date().toISOString(),
      displayName,
    };
  }
  await saveStore(s);
}

export async function getTopSenders(limit: number): Promise<LeaderboardEntry[]> {
  const s = await loadStore();
  const entries = Object.entries(s.stats)
    .filter(([uid]) => s.optIn[uid])
    .map(([_, v]) => v);
  entries.sort((a, b) => b.totalSent - a.totalSent);
  return entries.slice(0, limit).map((e, i) => ({
    displayName: e.displayName,
    totalSent: e.totalSent,
    transferCount: e.transferCount,
    memberSince: e.memberSince,
    badge: badgeFor(i),
  }));
}

export async function getUserRank(userId: string): Promise<number> {
  const s = await loadStore();
  if (!s.optIn[userId]) return -1;
  const sorted = Object.entries(s.stats)
    .filter(([uid]) => s.optIn[uid])
    .sort((a, b) => b[1].totalSent - a[1].totalSent);
  const idx = sorted.findIndex(([id]) => id === userId);
  return idx === -1 ? -1 : idx + 1;
}

export async function totalNetworkVolume(): Promise<number> {
  const s = await loadStore();
  return Object.entries(s.stats)
    .filter(([uid]) => s.optIn[uid])
    .reduce((sum, [, v]) => sum + v.totalSent, 0);
}
