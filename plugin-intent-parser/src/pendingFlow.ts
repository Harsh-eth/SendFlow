import type { RemittanceIntent } from "./types";

/** Full rate snapshot while awaiting YES (mirrors sendflow.rate). */
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
};

const pending = new Map<string, PendingEntry>();

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

export function isExpired(entry: PendingEntry): boolean {
  return Date.now() > entry.expiresAt;
}
