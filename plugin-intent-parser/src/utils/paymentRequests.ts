export interface PaymentRequest {
  requestId: string;
  requestorEntityId: string;
  requestorWallet: string;
  requestorName: string;
  targetWallet: string;
  amount: number;
  createdAt: Date;
  expiresAt: Date;
  status: "pending" | "paid" | "declined" | "expired";
}

const requestStore = new Map<string, PaymentRequest>();
const walletToEntity = new Map<string, string>();

let idCounter = 0;
function generateId(): string {
  return `req_${Date.now().toString(36)}_${(++idCounter).toString(36)}`;
}

export function registerWalletEntity(wallet: string, entityId: string): void {
  walletToEntity.set(wallet, entityId);
}

export function getEntityForWallet(wallet: string): string | null {
  return walletToEntity.get(wallet) ?? null;
}

export function createRequest(
  req: Omit<PaymentRequest, "requestId" | "status" | "createdAt" | "expiresAt">
): PaymentRequest {
  const pr: PaymentRequest = {
    ...req,
    requestId: generateId(),
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  requestStore.set(pr.requestId, pr);
  return pr;
}

export function getRequest(requestId: string): PaymentRequest | null {
  return requestStore.get(requestId) ?? null;
}

export function getPendingForTarget(targetWallet: string): PaymentRequest | null {
  for (const pr of requestStore.values()) {
    if (pr.targetWallet === targetWallet && pr.status === "pending" && pr.expiresAt > new Date()) {
      return pr;
    }
  }
  return null;
}

export function getPendingForEntity(entityId: string): PaymentRequest | null {
  for (const pr of requestStore.values()) {
    const targetEntity = walletToEntity.get(pr.targetWallet);
    if (targetEntity === entityId && pr.status === "pending" && pr.expiresAt > new Date()) {
      return pr;
    }
  }
  return null;
}

export function markPaid(requestId: string): void {
  const pr = requestStore.get(requestId);
  if (pr) pr.status = "paid";
}

export function markDeclined(requestId: string): void {
  const pr = requestStore.get(requestId);
  if (pr) pr.status = "declined";
}
