/** Central counters for /metrics, /admin metrics, and growth loops. */

import { getOnboardingStats } from "./onboardingFlow";
import { referralConversionStats } from "./referralSystem";
import { averageStreak } from "./streakSystem";

export interface SendFlowMetrics {
  totalUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  referralConversionRate: number;
  onboardingCompletionRate: number;
  firstTransferRate: number;
  avgTimeToFirstTransfer: number;
  dau: number;
  wau: number;
  mau: number;
  dauMauRatio: number;
  avgSessionsPerUser: number;
  streakAverage: number;
  totalVolumeToday: number;
  totalVolumeThisWeek: number;
  totalVolumeAllTime: number;
  avgTransferSize: number;
  feesCollectedToday: number;
  feesCollectedAllTime: number;
  featureAdoption: Record<string, number>;
  topFeatures: string[];
}

const userJoinDates = new Map<string, string>();
const userJoinMs = new Map<string, number>();
let firstTransferWithin24hCount = 0;
const activeToday = new Set<string>();
const activeWeek = new Set<string>();
const activeMonth = new Set<string>();
const transferCountByUser = new Map<string, number>();
const sessionStarts = new Map<string, number[]>();
let totalVolumeToday = 0;
let totalVolumeWeek = 0;
let totalVolumeAll = 0;
let transferCount = 0;
const featureAdoption: Record<string, number> = {};
let feesToday = 0;
let feesAll = 0;

/** Estimated USD saved vs Western Union fee model (see costComparison). */
const savingsVsWuByUser = new Map<string, number>();

export function recordSavingsVsWu(userId: string, savedUsd: number): void {
  savingsVsWuByUser.set(userId, (savingsVsWuByUser.get(userId) ?? 0) + savedUsd);
}

export function getTotalSavedVsWu(userId: string): number {
  return Math.round((savingsVsWuByUser.get(userId) ?? 0) * 100) / 100;
}

const dayKey = (): string => new Date().toISOString().slice(0, 10);
const weekKey = (): string => {
  const d = new Date();
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
};

export function registerNewUser(userId: string): void {
  if (!userJoinDates.has(userId)) {
    const now = Date.now();
    userJoinDates.set(userId, new Date().toISOString());
    userJoinMs.set(userId, now);
  }
}

/** Days since first seen registration (0 if unknown). */
export function getAccountAgeDays(userId: string): number {
  const j = userJoinMs.get(userId);
  if (j == null) return 0;
  return Math.floor((Date.now() - j) / 86_400_000);
}

const firstTransferDone = new Set<string>();
const firstTransferMinutes = new Map<string, number>();

export function noteFirstTransfer(userId: string): void {
  if (firstTransferDone.has(userId)) return;
  firstTransferDone.add(userId);
  const j = userJoinMs.get(userId);
  if (j != null) {
    firstTransferMinutes.set(userId, (Date.now() - j) / 60000);
    if (Date.now() - j < 86400000) firstTransferWithin24hCount += 1;
  }
}

export function getAvgTimeToFirstTransfer(): number {
  if (firstTransferMinutes.size === 0) return 0;
  let s = 0;
  for (const v of firstTransferMinutes.values()) s += v;
  return Math.round((s / firstTransferMinutes.size) * 10) / 10;
}

export function buildSendFlowMetrics(totalUsersCount: number): SendFlowMetrics {
  const onb = getOnboardingStats();
  const ref = referralConversionStats();
  const snap = getSendFlowMetricsSnapshot({
    totalUsersCount,
    onboardingStarted: onb.started,
    onboardingCompleted: onb.completed,
    firstTransferWithin24h: firstTransferWithin24hCount,
    referralsJoined: ref.joined,
    referralsConverted: ref.converted,
    avgStreak: averageStreak(),
  });
  return { ...snap, avgTimeToFirstTransfer: getAvgTimeToFirstTransfer() };
}

export function recordDailyActive(userId: string): void {
  activeToday.add(`${dayKey()}:${userId}`);
  activeWeek.add(`${weekKey()}:${userId}`);
  activeMonth.add(`${new Date().toISOString().slice(0, 7)}:${userId}`);
  const arr = sessionStarts.get(userId) ?? [];
  arr.push(Date.now());
  if (arr.length > 500) arr.shift();
  sessionStarts.set(userId, arr);
}

export function recordTransferVolume(userId: string, amountUsd: number, feeUsd = 0): void {
  transferCount += 1;
  totalVolumeAll += amountUsd;
  totalVolumeToday += amountUsd;
  totalVolumeWeek += amountUsd;
  feesToday += feeUsd;
  feesAll += feeUsd;
  transferCountByUser.set(userId, (transferCountByUser.get(userId) ?? 0) + 1);
}

export function incrementFeatureUsage(feature: string): void {
  featureAdoption[feature] = (featureAdoption[feature] ?? 0) + 1;
}

function topFeaturesList(n: number): string[] {
  return Object.entries(featureAdoption)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function getSendFlowMetricsSnapshot(opts: {
  totalUsersCount: number;
  onboardingStarted: number;
  onboardingCompleted: number;
  firstTransferWithin24h: number;
  referralsJoined: number;
  referralsConverted: number;
  avgStreak: number;
}): SendFlowMetrics {
  const d = dayKey();
  const w = weekKey();
  const m = new Date().toISOString().slice(0, 7);
  let dau = 0;
  let wau = 0;
  let mau = 0;
  const dp = `${d}:`;
  const wp = `${w}:`;
  const mp = `${m}:`;
  for (const k of activeToday) if (k.startsWith(dp)) dau++;
  for (const k of activeWeek) if (k.startsWith(wp)) wau++;
  for (const k of activeMonth) if (k.startsWith(mp)) mau++;

  const refRate = opts.referralsJoined > 0 ? opts.referralsConverted / opts.referralsJoined : 0;
  const onbRate = opts.onboardingStarted > 0 ? opts.onboardingCompleted / opts.onboardingStarted : 0;
  const firstRate = opts.totalUsersCount > 0 ? opts.firstTransferWithin24h / opts.totalUsersCount : 0;

  const sessions = [...sessionStarts.values()].flat();
  const avgSess = opts.totalUsersCount > 0 ? sessions.length / opts.totalUsersCount : 0;

  const avgSize = transferCount > 0 ? totalVolumeAll / transferCount : 0;

  return {
    totalUsers: opts.totalUsersCount,
    newUsersToday: 0,
    newUsersThisWeek: 0,
    referralConversionRate: Math.round(refRate * 1000) / 1000,
    onboardingCompletionRate: Math.round(onbRate * 1000) / 1000,
    firstTransferRate: Math.round(firstRate * 1000) / 1000,
    avgTimeToFirstTransfer: 0,
    dau,
    wau,
    mau,
    dauMauRatio: mau > 0 ? Math.round((dau / mau) * 1000) / 1000 : 0,
    avgSessionsPerUser: Math.round(avgSess * 100) / 100,
    streakAverage: Math.round(opts.avgStreak * 100) / 100,
    totalVolumeToday: Math.round(totalVolumeToday * 100) / 100,
    totalVolumeThisWeek: Math.round(totalVolumeWeek * 100) / 100,
    totalVolumeAllTime: Math.round(totalVolumeAll * 100) / 100,
    avgTransferSize: Math.round(avgSize * 100) / 100,
    feesCollectedToday: Math.round(feesToday * 10000) / 10000,
    feesCollectedAllTime: Math.round(feesAll * 10000) / 10000,
    featureAdoption: { ...featureAdoption },
    topFeatures: topFeaturesList(12),
  };
}

export function resetDailyVolumeIfNeeded(): void {
  /* Called at midnight tick — simplified: noop; today accumulates until restart */
}
