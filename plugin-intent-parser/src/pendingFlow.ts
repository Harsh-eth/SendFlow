import type { RemittanceIntent } from "./types";

export type PendingRateSnapshot = {
  sourceMint: string;
  targetMint: string;
  jupiterRate: number;
  pythRate: number;
  bestRate: number;
  provider: "jupiter" | "pyth";
  recipientGets: number;
  sendflowFee: number;
  fetchedAt: string;
};

export type PendingEntry = {
  intent: RemittanceIntent;
  rate: PendingRateSnapshot;
  expiresAt: number;
  initiatorEntityId: string;
};

const pending = new Map<string, PendingEntry>();

/** Users with an active transaction being executed — prevents double-YES. */
const processingFlow = new Set<string>();

/** Per-user rate limiting: entityId → last request timestamp. */
const lastRequestTime = new Map<string, number>();

export function pendingKey(roomId: string, entityId: string): string {
  return `${roomId}:${entityId}`;
}

export function setPending(roomId: string, entityId: string, entry: PendingEntry): void {
  pending.set(pendingKey(roomId, entityId), entry);
}

export function getPending(roomId: string, entityId: string): PendingEntry | undefined {
  return pending.get(pendingKey(roomId, entityId));
}

export function clearPending(roomId: string, entityId: string): void {
  pending.delete(pendingKey(roomId, entityId));
}

/** Clear every pending flow for this user (all rooms). */
export function clearAllPendingForEntity(entityId: string): void {
  const suffix = `:${entityId}`;
  for (const k of [...pending.keys()]) {
    if (k.endsWith(suffix)) pending.delete(k);
  }
}

export function isExpired(entry: PendingEntry): boolean {
  return Date.now() > entry.expiresAt;
}

export function isProcessing(entityId: string): boolean {
  return processingFlow.has(entityId);
}

export function setProcessing(entityId: string): void {
  processingFlow.add(entityId);
}

export function clearProcessing(entityId: string): void {
  processingFlow.delete(entityId);
}

export function getLastRequestTime(entityId: string): number {
  return lastRequestTime.get(entityId) ?? 0;
}

export function setLastRequestTime(entityId: string): void {
  lastRequestTime.set(entityId, Date.now());
}
