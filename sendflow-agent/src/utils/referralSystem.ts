import { loggerCompat as logger } from "./structuredLogger";

export interface Referral {
  referrerId: string;
  referredUserId: string;
  joinedAt: string;
  rewardPaid: boolean;
  rewardAmount: number;
  level: 1 | 2;
}

export interface ReferralNode {
  userId: string;
  referredBy?: string;
  level1Referrals: string[];
  level2Referrals: string[];
  totalEarned: number;
  pendingRewards: number;
}

export const REFERRAL_REWARDS = {
  level1: 0.1,
  level2: 0.02,
  milestone_5: 0.5,
  milestone_10: 1.5,
  milestone_25: 5.0,
} as const;

const referrals = new Map<string, Referral[]>();
const userReferrer = new Map<string, string>();
const nodes = new Map<string, ReferralNode>();
const milestonePaid = new Map<string, Set<number>>();

function ensureNode(userId: string): ReferralNode {
  let n = nodes.get(userId);
  if (!n) {
    n = { userId, level1Referrals: [], level2Referrals: [], totalEarned: 0, pendingRewards: 0 };
    nodes.set(userId, n);
  }
  return n;
}

export function generateReferralLink(userId: string, botUsername: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `https://t.me/${botUsername}?start=ref_${safeId}`;
}

export function trackReferral(referrerId: string, newUserId: string): void {
  if (referrerId === newUserId) return;
  if (userReferrer.has(newUserId)) return;
  userReferrer.set(newUserId, referrerId);

  const refNode = ensureNode(referrerId);
  refNode.level1Referrals.push(newUserId);
  const parent = userReferrer.get(referrerId);
  if (parent) {
    ensureNode(parent).level2Referrals.push(newUserId);
  }

  const list = referrals.get(referrerId) ?? [];
  list.push({
    referrerId,
    referredUserId: newUserId,
    joinedAt: new Date().toISOString(),
    rewardPaid: false,
    rewardAmount: REFERRAL_REWARDS.level1,
    level: 1,
  });
  referrals.set(referrerId, list);
  logger.info(`REFERRAL: ${newUserId} referred by ${referrerId}`);
}

export function getReferralTree(userId: string): ReferralNode {
  return ensureNode(userId);
}

export function getReferralStats(userId: string): { count: number; earned: number } {
  const e = getReferralEarnings(userId);
  return { count: ensureNode(userId).level1Referrals.length, earned: e.total };
}

export function getReferralEarnings(userId: string): {
  level1: number;
  level2: number;
  milestones: number;
  total: number;
} {
  const list = referrals.get(userId) ?? [];
  const l1 = list.filter((r) => r.level === 1 && r.rewardPaid).length * REFERRAL_REWARDS.level1;
  let l2 = 0;
  for (const child of ensureNode(userId).level1Referrals) {
    const sub = referrals.get(child) ?? [];
    l2 += sub.filter((r) => r.level === 1 && r.rewardPaid).length * REFERRAL_REWARDS.level2;
  }
  const mset = milestonePaid.get(userId) ?? new Set();
  let milestones = 0;
  if (mset.has(5)) milestones += REFERRAL_REWARDS.milestone_5;
  if (mset.has(10)) milestones += REFERRAL_REWARDS.milestone_10;
  if (mset.has(25)) milestones += REFERRAL_REWARDS.milestone_25;
  const direct = ensureNode(userId).level1Referrals.length;
  const node = ensureNode(userId);
  node.totalEarned = l1 + l2 + milestones;
  return { level1: l1, level2: l2, milestones, total: l1 + l2 + milestones };
}

function applyMilestones(userId: string): void {
  const n = ensureNode(userId).level1Referrals.length;
  let set = milestonePaid.get(userId);
  if (!set) {
    set = new Set();
    milestonePaid.set(userId, set);
  }
  if (n >= 5 && !set.has(5)) set.add(5);
  if (n >= 10 && !set.has(10)) set.add(10);
  if (n >= 25 && !set.has(25)) set.add(25);
}

export function markReferralPaid(referrerId: string, referredUserId: string): void {
  const list = referrals.get(referrerId);
  if (!list) return;
  const ref = list.find((r) => r.referredUserId === referredUserId && !r.rewardPaid && r.level === 1);
  if (ref) {
    ref.rewardPaid = true;
    applyMilestones(referrerId);
  }

  const grandparent = userReferrer.get(referrerId);
  if (grandparent) {
    const list2 = referrals.get(grandparent) ?? [];
    let ref2 = list2.find((r) => r.referredUserId === referredUserId && r.level === 2);
    if (!ref2) {
      ref2 = {
        referrerId: grandparent,
        referredUserId,
        joinedAt: new Date().toISOString(),
        rewardPaid: false,
        rewardAmount: REFERRAL_REWARDS.level2,
        level: 2,
      };
      list2.push(ref2);
      referrals.set(grandparent, list2);
    }
    if (ref2 && !ref2.rewardPaid) ref2.rewardPaid = true;
  }
}

export function getReferrerOf(userId: string): string | undefined {
  return userReferrer.get(userId);
}

export function hasCompletedFirstTransfer(userId: string): boolean {
  const list = referrals.get(userReferrer.get(userId) ?? "");
  if (!list) return false;
  return list.some((r) => r.referredUserId === userId && r.rewardPaid);
}

export function referralConversionStats(): { joined: number; converted: number } {
  let joined = 0;
  let converted = 0;
  for (const list of referrals.values()) {
    for (const r of list) {
      if (r.level === 1) {
        joined += 1;
        if (r.rewardPaid) converted += 1;
      }
    }
  }
  return { joined, converted };
}
