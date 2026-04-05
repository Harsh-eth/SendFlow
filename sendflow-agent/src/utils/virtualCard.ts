import { getCustodialWallet } from "./custodialWallet";

export interface VirtualCard {
  userId: string;
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvvEncrypted: string;
  spendingLimit: number;
  linkedWallet: string;
  active: boolean;
}

const cards = new Map<string, VirtualCard>();

function maskPan(last4: string): string {
  return `4111 **** **** ${last4}`;
}

export async function issueVirtualCard(userId: string): Promise<VirtualCard> {
  const w = await getCustodialWallet(userId);
  const pk = w?.publicKey ?? "unknown";
  const last4 = pk.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(-4).padStart(4, "0");
  const card: VirtualCard = {
    userId,
    cardNumber: maskPan(last4),
    expiryMonth: 4,
    expiryYear: 2028,
    cvvEncrypted: "***",
    spendingLimit: 500,
    linkedWallet: pk,
    active: true,
  };
  cards.set(userId, card);
  return card;
}

export async function freezeCard(userId: string): Promise<void> {
  const c = cards.get(userId);
  if (c) c.active = false;
}

export async function setSpendingLimit(userId: string, limit: number): Promise<void> {
  let c = cards.get(userId);
  if (!c) c = await issueVirtualCard(userId);
  c.spendingLimit = limit;
  cards.set(userId, c);
}

export function getVirtualCard(userId: string): VirtualCard | null {
  return cards.get(userId) ?? null;
}

export function cardProviderMode(): "stub" | "rain" | "inmeta" {
  const p = process.env.VIRTUAL_CARD_PROVIDER?.toLowerCase();
  if (p === "rain" || p === "inmeta") return p;
  return "stub";
}
