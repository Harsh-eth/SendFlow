import type { RemittanceIntent } from "../types";
import { loggerCompat as logger } from "./structuredLogger";

export interface RecurringTransfer {
  scheduleId: string;
  userId: string;
  intent: RemittanceIntent;
  frequency: "daily" | "weekly" | "monthly";
  dayOfMonth?: number;
  dayOfWeek?: number;
  nextRunAt: Date;
  lastRunAt?: Date;
  lastTxHash?: string;
  active: boolean;
  createdAt: Date;
}

const MAX_SCHEDULES_PER_USER = 5;
const scheduleStore = new Map<string, RecurringTransfer[]>();
let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let onExecuteCallback: ((rt: RecurringTransfer) => Promise<string | null>) | null = null;
let onNotifyCallback: ((userId: string, text: string) => Promise<void>) | null = null;

let idCounter = 0;
function generateScheduleId(): string {
  return `sch_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
}

export function addSchedule(
  schedule: Omit<RecurringTransfer, "scheduleId" | "active" | "createdAt">
): { success: boolean; schedule?: RecurringTransfer; error?: string } {
  const userSchedules = scheduleStore.get(schedule.userId) ?? [];
  if (userSchedules.length >= MAX_SCHEDULES_PER_USER) {
    return { success: false, error: `Maximum ${MAX_SCHEDULES_PER_USER} schedules allowed.` };
  }
  const rt: RecurringTransfer = {
    ...schedule,
    scheduleId: generateScheduleId(),
    active: true,
    createdAt: new Date(),
  };
  userSchedules.push(rt);
  scheduleStore.set(schedule.userId, userSchedules);
  return { success: true, schedule: rt };
}

export function cancelSchedule(userId: string, scheduleId: string): boolean {
  const userSchedules = scheduleStore.get(userId);
  if (!userSchedules) return false;
  const schedule = userSchedules.find((s) => s.scheduleId === scheduleId);
  if (!schedule) return false;
  schedule.active = false;
  return true;
}

export function cancelScheduleByLabel(userId: string, label: string): boolean {
  const userSchedules = scheduleStore.get(userId);
  if (!userSchedules) return false;
  const lower = label.toLowerCase();
  const schedule = userSchedules.find(
    (s) => s.active && s.intent.receiverLabel.toLowerCase().includes(lower)
  );
  if (!schedule) return false;
  schedule.active = false;
  return true;
}

export function listSchedules(userId: string): RecurringTransfer[] {
  return (scheduleStore.get(userId) ?? []).filter((s) => s.active);
}

export function deactivateAllSchedulesForUser(userId: string): number {
  const userSchedules = scheduleStore.get(userId);
  if (!userSchedules) return 0;
  let n = 0;
  for (const s of userSchedules) {
    if (s.active) {
      s.active = false;
      n += 1;
    }
  }
  return n;
}

function computeNextRun(rt: RecurringTransfer): Date {
  const now = new Date();
  switch (rt.frequency) {
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly": {
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      return next;
    }
    case "monthly": {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      if (rt.dayOfMonth) next.setDate(rt.dayOfMonth);
      return next;
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  for (const [_userId, schedules] of scheduleStore) {
    for (const rt of schedules) {
      if (!rt.active) continue;
      if (rt.nextRunAt > now) continue;

      logger.info(`SCHEDULER: Executing recurring transfer ${rt.scheduleId} for ${rt.userId}`);

      let txHash: string | null = null;
      if (onExecuteCallback) {
        txHash = await onExecuteCallback(rt);
      }

      rt.lastRunAt = now;
      rt.nextRunAt = computeNextRun(rt);
      if (txHash) rt.lastTxHash = txHash;

      const nextDate = rt.nextRunAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      if (onNotifyCallback) {
        const msg = txHash
          ? [
              `🔄 Recurring transfer executed!`,
              `💸 ${rt.intent.amount} USDC → ${rt.intent.receiverLabel}`,
              `📅 Next transfer: ${nextDate}`,
              `🔗 https://solscan.io/tx/${txHash}`,
            ].join("\n")
          : [
              `⚠️ Recurring transfer failed for ${rt.intent.receiverLabel}`,
              `📅 Will retry: ${nextDate}`,
            ].join("\n");
        await onNotifyCallback(rt.userId, msg);
      }
    }
  }
}

export function startScheduler(
  onExecute: (rt: RecurringTransfer) => Promise<string | null>,
  onNotify: (userId: string, text: string) => Promise<void>
): void {
  if (schedulerInterval) return;
  onExecuteCallback = onExecute;
  onNotifyCallback = onNotify;
  schedulerInterval = setInterval(() => {
    tick().catch((e) => logger.error(`Scheduler tick error: ${e}`));
  }, 60_000);
  logger.info("Scheduler started (60s interval)");
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
