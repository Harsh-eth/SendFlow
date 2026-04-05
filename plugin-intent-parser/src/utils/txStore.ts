import { persistLoad, persistSave } from "./persistence";

export interface TxRecord {
  amount: number;
  receiverWallet: string;
  receiverLabel: string;
  txHash: string;
  explorerUrl: string;
  completedAt: string;
  /** Spending category (Feature 44) */
  category?: string;
  memo?: string;
}

function loadTxStore(): Map<string, TxRecord[]> {
  const raw = persistLoad<Record<string, TxRecord[]>>("tx-history.json", {});
  return new Map(Object.entries(raw));
}

const txStore = loadTxStore();

function persistTxHistory(): void {
  persistSave("tx-history.json", Object.fromEntries(txStore));
}

export function recordTransaction(entityId: string, record: TxRecord): void {
  const list = txStore.get(entityId) ?? [];
  list.unshift(record);
  if (list.length > 50) list.length = 50;
  txStore.set(entityId, list);
  persistTxHistory();
}

export function getTransactions(entityId: string): TxRecord[] {
  return txStore.get(entityId) ?? [];
}

export function getLastTransfer(entityId: string): TxRecord | null {
  const list = txStore.get(entityId);
  return list?.[0] ?? null;
}

export function getLastTransferTo(entityId: string, label: string): TxRecord | null {
  const list = txStore.get(entityId);
  if (!list) return null;
  const lower = label.toLowerCase();
  return list.find((t) =>
    t.receiverLabel.toLowerCase() === lower ||
    t.receiverWallet.toLowerCase() === lower
  ) ?? null;
}

export function getAllTransfers(entityId: string): TxRecord[] {
  return txStore.get(entityId) ?? [];
}

/** User IDs that have at least one stored transfer (for digests / weekly reports). */
export function getAllTransferUserIds(): string[] {
  return [...txStore.keys()];
}
