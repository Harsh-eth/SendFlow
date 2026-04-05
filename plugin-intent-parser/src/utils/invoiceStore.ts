import { persistLoad, persistSave } from "./persistence";

export interface Invoice {
  invoiceId: string;
  creatorWallet: string;
  creatorEntityId: string;
  amount: number;
  label: string;
  createdAt: Date;
  expiresAt: Date;
  paid: boolean;
  paidTxHash?: string;
}

function reviveInvoice(raw: Invoice): Invoice {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as unknown as string),
    expiresAt: new Date(raw.expiresAt as unknown as string),
  };
}

function loadInvoiceStore(): Map<string, Invoice> {
  const raw = persistLoad<Record<string, Invoice>>("invoices.json", {});
  const m = new Map<string, Invoice>();
  for (const [id, inv] of Object.entries(raw)) {
    m.set(id, reviveInvoice(inv));
  }
  return m;
}

const invoiceStore = loadInvoiceStore();

function persistInvoices(): void {
  persistSave("invoices.json", Object.fromEntries(invoiceStore));
}

function generateShortId(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export function createInvoice(
  inv: Omit<Invoice, "invoiceId" | "paid" | "createdAt" | "expiresAt">
): Invoice {
  const invoice: Invoice = {
    ...inv,
    invoiceId: generateShortId(),
    paid: false,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
  invoiceStore.set(invoice.invoiceId, invoice);
  persistInvoices();
  return invoice;
}

export function getInvoice(invoiceId: string): Invoice | null {
  const inv = invoiceStore.get(invoiceId);
  if (!inv) return null;
  if (inv.expiresAt < new Date() && !inv.paid) return null;
  return inv;
}

export function markInvoicePaid(invoiceId: string, txHash: string): void {
  const inv = invoiceStore.get(invoiceId);
  if (inv) {
    inv.paid = true;
    inv.paidTxHash = txHash;
    persistInvoices();
  }
}

export function getLatestInvoiceForCreator(creatorEntityId: string): Invoice | null {
  let latest: Invoice | null = null;
  for (const inv of invoiceStore.values()) {
    if (inv.creatorEntityId !== creatorEntityId) continue;
    if (!latest || inv.createdAt > latest.createdAt) latest = inv;
  }
  return latest;
}
