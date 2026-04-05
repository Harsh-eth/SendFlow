import { randomBytes } from "node:crypto";
import type { HandlerCallback, IAgentRuntime, Memory, State } from "@elizaos/core";
import type { Connection, Keypair } from "@solana/web3.js";
import type { PendingRateSnapshot, RemittanceIntent } from "@sendflow/plugin-intent-parser";
import { lockUsdcEscrowAction } from "@sendflow/plugin-usdc-handler";
import { routePayoutAction } from "@sendflow/plugin-payout-router";
import { notifyPartiesAction } from "@sendflow/plugin-notifier";

export interface ApprovalRequest {
  requestId: string;
  initiatorUserId: string;
  approverWallet: string;
  approverTelegramId?: string;
  amount: number;
  recipient: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface PendingExecution {
  requestId: string;
  userId: string;
  roomId: string;
  intent: RemittanceIntent;
  rate: PendingRateSnapshot;
  usdcLockAmount: number;
  /** Set when approver confirms */
  approvedAt?: string;
  initiatorChatId?: string;
  approverTelegramId?: string;
  speedMode?: string;
}

const MAX_REQUESTS = 200;
const MAX_PENDING_EXEC = 200;

const requests = new Map<string, ApprovalRequest>();
const approverByUser = new Map<string, string>();
export const pendingExecutions = new Map<string, PendingExecution>();

export function setApproverTelegramId(userId: string, approverTgId: string): void {
  if (approverByUser.size >= 5000 && !approverByUser.has(userId)) {
    const first = approverByUser.keys().next().value as string | undefined;
    if (first) approverByUser.delete(first);
  }
  approverByUser.set(userId, approverTgId);
}

export function getApproverTelegramId(userId: string): string | undefined {
  return approverByUser.get(userId);
}

function trimRequests(): void {
  while (requests.size > MAX_REQUESTS) {
    const first = requests.keys().next().value as string | undefined;
    if (first) requests.delete(first);
    else break;
  }
}

export function requestApproval(
  init: Omit<ApprovalRequest, "requestId" | "status" | "expiresAt"> & { expiresInMs?: number }
): ApprovalRequest {
  trimRequests();
  const requestId = `ms_${randomBytes(8).toString("hex")}`;
  const req: ApprovalRequest = {
    ...init,
    requestId,
    status: "pending",
    expiresAt: new Date(Date.now() + (init.expiresInMs ?? 600_000)).toISOString(),
  };
  requests.set(requestId, req);
  return req;
}

export function getApproval(requestId: string): ApprovalRequest | undefined {
  return requests.get(requestId);
}

export function storePendingExecution(requestId: string, execution: PendingExecution): void {
  if (pendingExecutions.size >= MAX_PENDING_EXEC && !pendingExecutions.has(requestId)) {
    const first = pendingExecutions.keys().next().value as string | undefined;
    if (first) pendingExecutions.delete(first);
  }
  pendingExecutions.set(requestId, execution);
}

export function getPendingExecution(requestId: string): PendingExecution | undefined {
  return pendingExecutions.get(requestId);
}

export function removePendingExecution(requestId: string): void {
  pendingExecutions.delete(requestId);
}

export function approveTransfer(requestId: string, approverId: string): boolean {
  const r = requests.get(requestId);
  if (!r || r.status !== "pending") return false;
  if (r.approverTelegramId && r.approverTelegramId !== approverId) return false;
  if (new Date() > new Date(r.expiresAt)) {
    r.status = "expired";
    return false;
  }
  r.status = "approved";
  return true;
}

export function rejectTransfer(requestId: string, approverId: string): boolean {
  const r = requests.get(requestId);
  if (!r || r.status !== "pending") return false;
  if (r.approverTelegramId && r.approverTelegramId !== approverId) return false;
  r.status = "rejected";
  return true;
}

export function expireStale(): void {
  const now = Date.now();
  for (const r of requests.values()) {
    if (r.status === "pending" && new Date(r.expiresAt).getTime() < now) r.status = "expired";
  }
}

export function getExpiredPendingExecutionIds(): string[] {
  expireStale();
  const out: string[] = [];
  for (const [id, ex] of pendingExecutions) {
    const r = requests.get(id);
    if (r?.status === "expired" && ex) out.push(id);
  }
  return out;
}

export function removeApprovalRequest(requestId: string): void {
  requests.delete(requestId);
}

function buildMultisigMemory(exec: PendingExecution): Memory {
  const chatId = exec.initiatorChatId ? Number(exec.initiatorChatId) : undefined;
  return {
    id: `multisig_${exec.requestId}_${Date.now()}`,
    entityId: exec.userId,
    roomId: exec.roomId,
    content: { text: "YES", source: "multisig" },
    metadata: chatId != null && !Number.isNaN(chatId) ? { telegram: { chat: { id: chatId } } } : undefined,
  } as Memory;
}

export function coerceRateSnapshot(obj: unknown, intent: RemittanceIntent): PendingRateSnapshot {
  const o = (obj ?? {}) as Partial<PendingRateSnapshot>;
  return {
    sourceMint: o.sourceMint ?? intent.sourceMint,
    targetMint: o.targetMint ?? intent.targetMint,
    jupiterRate: o.jupiterRate ?? 0,
    pythRate: o.pythRate ?? 0,
    bestRate: o.bestRate ?? 1,
    provider: o.provider === "pyth" || o.provider === "jupiter" ? o.provider : "jupiter",
    recipientGets: o.recipientGets ?? intent.amount,
    sendflowFee: o.sendflowFee ?? 0,
    fetchedAt: o.fetchedAt ?? new Date().toISOString(),
  };
}

function rateToState(rate: PendingRateSnapshot) {
  return {
    sourceMint: rate.sourceMint,
    targetMint: rate.targetMint,
    jupiterRate: rate.jupiterRate,
    pythRate: rate.pythRate,
    bestRate: rate.bestRate,
    provider: rate.provider,
    recipientGets: rate.recipientGets,
    sendflowFee: rate.sendflowFee,
    fetchedAt: rate.fetchedAt,
  };
}

/**
 * Runs LOCK_USDC_ESCROW → ROUTE_PAYOUT → NOTIFY_PARTIES after approver approval.
 * connection / escrowKeypair reserved for future fee sponsorship or direct signing; actions use runtime env.
 */
export async function executeAfterApproval(
  requestId: string,
  runtime: IAgentRuntime,
  _connection: Connection,
  _escrowKeypair: Keypair | null,
  opts: unknown,
  callback?: HandlerCallback
): Promise<{ ok: boolean; payoutTxHash?: string; error?: string }> {
  void _connection;
  void _escrowKeypair;
  const exec = pendingExecutions.get(requestId);
  if (!exec) {
    return { ok: false, error: "No pending execution for this request." };
  }

  const msg = buildMultisigMemory(exec);
  let chainSf: Record<string, unknown> = {
    intent: exec.intent,
    rate: rateToState(exec.rate),
    flow: { confirmed: true, confirmedAt: new Date().toISOString() },
    speedMode: exec.speedMode ?? "normal",
  };
  let chainState = {
    values: { sendflow: chainSf },
  } as unknown as State;

  try {
    const lr = await lockUsdcEscrowAction.handler(runtime, msg, chainState, opts as never, callback);
    const lockResult = lr ?? { success: false as const, text: "Lock failed" };
    if (!lockResult.success) {
      return { ok: false, error: lockResult.text ?? "Lock failed" };
    }
    chainSf = {
      ...chainSf,
      ...((lockResult.values?.sendflow ?? {}) as Record<string, unknown>),
    };
    chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } };

    const rr = await routePayoutAction.handler(runtime, msg, chainState, opts as never, callback);
    const routeResult = rr ?? { success: false as const, text: "Route failed" };
    if (!routeResult.success) {
      return { ok: false, error: routeResult.text ?? "Route failed" };
    }
    chainSf = {
      ...chainSf,
      ...((routeResult.values?.sendflow ?? {}) as Record<string, unknown>),
    };
    chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } };

    const payout = chainSf.payout as { txHash?: string } | undefined;
    try {
      await notifyPartiesAction.handler(runtime, msg, chainState, opts as never, callback);
    } catch {
      /* non-fatal */
    }

    requests.delete(requestId);
    removePendingExecution(requestId);
    return { ok: true, payoutTxHash: payout?.txHash };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
}
