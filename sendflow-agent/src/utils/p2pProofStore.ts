import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";

const FILE = "p2p-proofs.json";

export interface PaymentProof {
  tradeId: string;
  buyerUserId: string;
  telegramFileId: string;
  uploadedAt: string;
  verified: boolean;
  buyerChatId?: string;
  proofMessageId?: number;
}

let cache: Record<string, PaymentProof> | null = null;

function load(): Record<string, PaymentProof> {
  if (cache) return cache;
  cache = persistLoad<Record<string, PaymentProof>>(FILE, {});
  return cache;
}

export function storeProof(
  tradeId: string,
  buyerUserId: string,
  fileId: string,
  extra?: { buyerChatId?: string; proofMessageId?: number }
): void {
  const m = { ...load() };
  m[tradeId] = {
    tradeId,
    buyerUserId,
    telegramFileId: fileId,
    uploadedAt: new Date().toISOString(),
    verified: false,
    buyerChatId: extra?.buyerChatId,
    proofMessageId: extra?.proofMessageId,
  };
  cache = m;
  persistSave(FILE, m);
}

export function getProof(tradeId: string): PaymentProof | null {
  return load()[tradeId] ?? null;
}

export function hasProof(tradeId: string): boolean {
  return Boolean(load()[tradeId]);
}

export function __resetP2pProofStoreForTests(): void {
  cache = {};
}
