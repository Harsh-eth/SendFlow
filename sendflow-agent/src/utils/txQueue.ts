import type { HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import type { Connection } from "@solana/web3.js";
import {
  getDueRetries,
  scheduleRetry,
  removeRetry,
  type RemittanceIntent,
  type PendingRateSnapshot,
  type RpcRetryItem,
} from "@sendflow/plugin-intent-parser";
import { lockUsdcEscrowAction } from "@sendflow/plugin-usdc-handler";
import { routePayoutAction } from "@sendflow/plugin-payout-router";
import { notifyPartiesAction } from "@sendflow/plugin-notifier";
import { log } from "./structuredLogger";

export interface QueuedTransaction {
  queueId: string;
  userId: string;
  intent: RemittanceIntent;
  createdAt: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  status: "queued" | "retrying" | "completed" | "failed";
  lastError?: string;
}

const queue = new Map<string, QueuedTransaction>();
let idCounter = 0;

const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000];

export function enqueueTransaction(userId: string, intent: RemittanceIntent, errorHint?: string): string {
  idCounter += 1;
  const queueId = `q_${Date.now()}_${idCounter}`;
  const qt: QueuedTransaction = {
    queueId,
    userId,
    intent,
    createdAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 5,
    nextRetryAt: new Date(Date.now() + BACKOFF_MS[0]).toISOString(),
    status: "queued",
    lastError: errorHint,
  };
  queue.set(queueId, qt);
  log.info("txQueue.enqueued", { queueId, userId });
  return queueId;
}

export function getQueueStatus(userId: string): QueuedTransaction[] {
  return [...queue.values()].filter((q) => q.userId === userId);
}

export function getAllQueued(): QueuedTransaction[] {
  return [...queue.values()].filter((q) => q.status === "queued" || q.status === "retrying");
}

export function markCompleted(queueId: string): void {
  const q = queue.get(queueId);
  if (q) q.status = "completed";
}

export function markFailed(queueId: string): void {
  const q = queue.get(queueId);
  if (q) q.status = "failed";
}

export function scheduleNextAttempt(qt: QueuedTransaction): void {
  qt.attempts += 1;
  if (qt.attempts >= qt.maxAttempts) {
    qt.status = "failed";
    return;
  }
  const delay = BACKOFF_MS[Math.min(qt.attempts - 1, BACKOFF_MS.length - 1)] ?? 480_000;
  qt.nextRetryAt = new Date(Date.now() + delay).toISOString();
  qt.status = "retrying";
}

function coerceRate(intent: RemittanceIntent, rate?: PendingRateSnapshot): PendingRateSnapshot {
  const r = rate;
  return {
    sourceMint: r?.sourceMint ?? intent.sourceMint,
    targetMint: r?.targetMint ?? intent.targetMint,
    jupiterRate: r?.jupiterRate ?? 0,
    pythRate: r?.pythRate ?? 0,
    bestRate: r?.bestRate ?? 1,
    provider: r?.provider === "pyth" || r?.provider === "jupiter" ? r.provider : "jupiter",
    recipientGets: r?.recipientGets ?? intent.amount,
    sendflowFee: r?.sendflowFee ?? 0,
    fetchedAt: r?.fetchedAt ?? new Date().toISOString(),
  };
}

function buildRetryMemory(item: RpcRetryItem): Memory {
  const meta =
    item.telegramChatId != null ? { telegram: { chat: { id: Number(item.telegramChatId) } } } : undefined;
  return {
    id: `retry_${item.queueId}`,
    entityId: item.userId,
    roomId: item.roomId,
    content: { text: "YES", source: "rpc_retry" },
    metadata: meta,
  } as Memory;
}

/**
 * Replays LOCK → ROUTE → NOTIFY for items enqueued after retriable RPC errors from lock.
 */
export async function processRpcRetryQueue(
  runtime: IAgentRuntime,
  _connection: Connection,
  opts: unknown,
  onNotify?: (chatId: string, text: string) => Promise<void>
): Promise<void> {
  void _connection;
  const due = getDueRetries();
  if (due.length === 0) return;

  for (const item of due) {
    const intent = item.intent;
    const rate = coerceRate(intent, item.rate);
    const msg = buildRetryMemory(item);
    let chainSf: Record<string, unknown> = {
      intent,
      rate,
      flow: { confirmed: true, confirmedAt: new Date().toISOString() },
      speedMode: item.speedMode ?? "normal",
    };
    let chainState = { values: { sendflow: chainSf } } as unknown as State;

    const cb: HandlerCallback | undefined =
      onNotify && item.telegramChatId
        ? async (p) => {
            await onNotify(item.telegramChatId!, p.text ?? "");
            return [];
          }
        : undefined;

    try {
      const lr = await lockUsdcEscrowAction.handler(runtime, msg, chainState, opts as never, cb);
      const queued = (lr?.data as { queued?: boolean } | undefined)?.queued;
      if (queued) {
        scheduleRetry(item);
        continue;
      }
      if (!lr?.success) {
        scheduleRetry(item);
        continue;
      }

      chainSf = { ...chainSf, ...((lr.values?.sendflow ?? {}) as Record<string, unknown>) };
      chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } };

      const rr = await routePayoutAction.handler(runtime, msg, chainState, opts as never, cb);
      if (!rr?.success) {
        scheduleRetry(item);
        continue;
      }

      chainSf = { ...chainSf, ...((rr.values?.sendflow ?? {}) as Record<string, unknown>) };
      chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } };

      try {
        await notifyPartiesAction.handler(runtime, msg, chainState, opts as never, cb);
      } catch {
        /* non-fatal */
      }

      const txh = (chainSf.payout as { txHash?: string } | undefined)?.txHash;
      removeRetry(item.queueId);
      log.info("rpcRetry.completed", { queueId: item.queueId, txHash: txh });

      if (onNotify && item.telegramChatId && txh) {
        await onNotify(
          item.telegramChatId,
          `✅ <b>Queued transfer completed!</b>\n🔗 <a href="https://solscan.io/tx/${txh}">View on Solscan</a>`
        );
      }
    } catch (e) {
      log.warn("rpcRetry.retry_scheduled", { queueId: item.queueId, error: e instanceof Error ? e.message : String(e) });
      scheduleRetry(item);
    }
  }
}

export async function processQueue(): Promise<void> {
  log.info("txQueue.processQueue", { note: "legacy_noop_use_processRpcRetryQueue" });
}
