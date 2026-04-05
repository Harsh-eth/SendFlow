import QRCode from "qrcode";

const MAX_POS = 10_000;
const posSessions = new Map<string, POSSession>();
const posInvoices = new Map<string, POSInvoice>();
let invSeq = 0;

export interface POSSession {
  merchantUserId: string;
  businessName: string;
  merchantWallet: string;
  totalToday: number;
  txCountToday: number;
  active: boolean;
}

export interface POSInvoice {
  invoiceId: string;
  merchantId: string;
  amount: number;
  description: string;
  createdAt: number;
  expiresAt: number;
  paid: boolean;
  payerWallet?: string;
}

function trimInvoices(): void {
  while (posInvoices.size >= MAX_POS) {
    const first = posInvoices.keys().next().value as string | undefined;
    if (first) posInvoices.delete(first);
    else break;
  }
}

function trimSessions(): void {
  while (posSessions.size >= MAX_POS) {
    const first = posSessions.keys().next().value as string | undefined;
    if (first) posSessions.delete(first);
    else break;
  }
}

export function enablePOS(userId: string, businessName: string, wallet: string): POSSession {
  trimSessions();
  const s: POSSession = {
    merchantUserId: userId,
    businessName,
    merchantWallet: wallet,
    totalToday: 0,
    txCountToday: 0,
    active: true,
  };
  posSessions.set(userId, s);
  return s;
}

export function disablePOS(userId: string): void {
  const s = posSessions.get(userId);
  if (s) s.active = false;
}

export function createPOSInvoice(userId: string, amount: number, description: string): POSInvoice {
  invSeq += 1;
  trimInvoices();
  const now = Date.now();
  const expiryMs = Number(process.env.POS_INVOICE_EXPIRY_MS ?? 600_000);
  const inv: POSInvoice = {
    invoiceId: `pos_${now}_${invSeq}`,
    merchantId: userId,
    amount,
    description,
    createdAt: now,
    expiresAt: now + expiryMs,
    paid: false,
  };
  posInvoices.set(inv.invoiceId, inv);
  return inv;
}

export function markPOSPaid(invoiceId: string, payerWallet: string): void {
  const inv = posInvoices.get(invoiceId);
  if (!inv || inv.paid) return;
  inv.paid = true;
  inv.payerWallet = payerWallet;
  const sess = posSessions.get(inv.merchantId);
  if (sess) {
    sess.totalToday += inv.amount;
    sess.txCountToday += 1;
  }
}

export function getPOSSession(userId: string): POSSession | undefined {
  return posSessions.get(userId);
}

export function getDailySummary(userId: string): string {
  const s = posSessions.get(userId);
  if (!s || !s.active) return "⚠️ POS mode is off.";
  return [
    `📊 <b>${s.businessName}</b> — Today`,
    `💰 Total: <b>${s.totalToday.toFixed(2)} USDC</b>`,
    `📦 Orders: <b>${s.txCountToday}</b>`,
  ].join("\n");
}

export async function generatePOSQR(payload: string): Promise<Buffer> {
  return QRCode.toBuffer(payload, { type: "png", width: 256, margin: 2 });
}
