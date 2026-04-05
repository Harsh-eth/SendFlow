import type { RemittanceIntent } from "../types";
import type { PendingRateSnapshot } from "../pendingFlow";

const MAX_QUEUE = 500;

export interface RpcRetryItem {
  queueId: string;
  userId: string;
  roomId: string;
  intent: RemittanceIntent;
  speedMode?: string;
  /** Present when retrying a full confirm→lock chain (needed for ROUTE after lock). */
  rate?: PendingRateSnapshot;
  createdAt: string;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
  /** Telegram chat to notify on success/failure (string id). */
  telegramChatId?: string;
}

const queue = new Map<string, RpcRetryItem>();
let counter = 0;

export function enqueueRpcRetry(
  userId: string,
  roomId: string,
  intent: RemittanceIntent,
  speedMode: string | undefined,
  errorHint: string,
  rate?: PendingRateSnapshot,
  telegramChatId?: string
): string {
  if (queue.size >= MAX_QUEUE) {
    const first = queue.keys().next().value as string | undefined;
    if (first) queue.delete(first);
  }
  counter += 1;
  const queueId = `rpc_${Date.now()}_${counter}`;
  const item: RpcRetryItem = {
    queueId,
    userId,
    roomId,
    intent,
    speedMode,
    rate,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextRetryAt: Date.now() + 30_000,
    lastError: errorHint,
    telegramChatId,
  };
  queue.set(queueId, item);
  return queueId;
}

export function getDueRetries(): RpcRetryItem[] {
  const now = Date.now();
  const out: RpcRetryItem[] = [];
  for (const item of queue.values()) {
    if (item.nextRetryAt <= now && item.attempts < 5) out.push(item);
  }
  return out;
}

export function scheduleRetry(item: RpcRetryItem): void {
  item.attempts += 1;
  const backoff = [30_000, 60_000, 120_000, 240_000, 480_000][Math.min(item.attempts - 1, 4)] ?? 480_000;
  item.nextRetryAt = Date.now() + backoff;
  if (item.attempts >= 5) {
    queue.delete(item.queueId);
  }
}

export function removeRetry(queueId: string): void {
  queue.delete(queueId);
}

export function getRpcQueueSize(): number {
  return queue.size;
}
