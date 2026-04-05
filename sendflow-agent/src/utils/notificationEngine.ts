import type { IAgentRuntime } from "@elizaos/core";
import { getStreak } from "./streakSystem";
import { getStakePosition, isMatured } from "./earnProtocol";
import { getActiveLoan } from "./microLoan";
import { getUsdcBalanceHuman } from "./walletBalance";
import { log } from "./structuredLogger";

export interface NotificationRule {
  id: string;
  trigger: "inactive_1d" | "inactive_3d" | "inactive_7d" | "low_balance" | "stake_maturing" | "loan_due_3d" | "streak_at_risk";
  message: (userId: string) => Promise<string>;
  maxPerMonth: number;
}

const lastActive = new Map<string, number>();
const ruleSentCounts = new Map<string, number>();

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function ruleCountKey(userId: string, ruleId: string): string {
  return `${userId}:${monthKey()}:${ruleId}`;
}

function canSend(userId: string, ruleId: string, max: number): boolean {
  const k = ruleCountKey(userId, ruleId);
  const cur = ruleSentCounts.get(k) ?? 0;
  return cur < max;
}

function recordSend(userId: string, ruleId: string): void {
  const k = ruleCountKey(userId, ruleId);
  ruleSentCounts.set(k, (ruleSentCounts.get(k) ?? 0) + 1);
}

export function touchLastActive(userId: string): void {
  lastActive.set(userId, Date.now());
}

export const NOTIFICATION_RULES: NotificationRule[] = [
  {
    id: "inactive_1d",
    trigger: "inactive_1d",
    message: async (userId) => {
      const bal = await getUsdcBalanceHuman(userId);
      return `Your SendFlow wallet has <b>${bal.toFixed(2)} USDC</b> ready to send. Type anything to continue.`;
    },
    maxPerMonth: 4,
  },
  {
    id: "streak_at_risk",
    trigger: "streak_at_risk",
    message: async (userId) => {
      const streak = getStreak(userId);
      return `Your <b>${streak.currentStreak}-day</b> streak ends in a few hours. Send any message to keep it alive!`;
    },
    maxPerMonth: 30,
  },
  {
    id: "stake_maturing",
    trigger: "stake_maturing",
    message: async (userId) => {
      const s = getStakePosition(userId);
      if (!s || isMatured(s)) return "";
      const t = new Date(s.maturesAt);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (t.toDateString() !== tomorrow.toDateString()) return "";
      return `Your staked USDC matures tomorrow! Type <code>withdraw stake</code> to claim your earnings.`;
    },
    maxPerMonth: 2,
  },
  {
    id: "loan_due_3d",
    trigger: "loan_due_3d",
    message: async (userId) => {
      const loan = getActiveLoan(userId);
      if (!loan || loan.status !== "disbursed") return "";
      const due = new Date(loan.dueDate).getTime();
      const days = (due - Date.now()) / 86400000;
      if (days > 3 || days < 0) return "";
      return `Your SendFlow loan is due in <b>3 days</b>. Type <code>repay my loan</code> to avoid fees.`;
    },
    maxPerMonth: 2,
  },
];

export function scheduleSmartNotifications(
  sendToUser: (userId: string, html: string) => Promise<void>,
  allUserIds: () => string[]
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void (async () => {
      const now = Date.now();
      const users = allUserIds();
      for (const userId of users) {
        const last = lastActive.get(userId) ?? 0;
        const inactiveMs = now - last;
        for (const rule of NOTIFICATION_RULES) {
          if (!canSend(userId, rule.id, rule.maxPerMonth)) continue;
          if (rule.id === "inactive_1d" && (inactiveMs < 86400000 || inactiveMs > 7 * 86400000)) continue;
          if (rule.id === "streak_at_risk") {
            const h = new Date().getUTCHours();
            if (h < 18 || h > 22) continue;
            const st = getStreak(userId);
            if (st.currentStreak < 2) continue;
          }
          try {
            const msg = await rule.message(userId);
            if (!msg.trim()) continue;
            await sendToUser(userId, msg);
            recordSend(userId, rule.id);
          } catch (e) {
            log.error("notification.rule_failed", { userId, rule: rule.id }, e instanceof Error ? e : new Error(String(e)));
          }
        }
      }
    })();
  }, 6 * 3600 * 1000);
}
