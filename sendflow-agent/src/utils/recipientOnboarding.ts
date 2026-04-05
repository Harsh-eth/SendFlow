import { randomBytes } from "node:crypto";

export interface PendingReceipt {
  receiptId: string;
  senderUserId: string;
  senderName: string;
  amount: number;
  message?: string;
  recipientIdentifier: string;
  claimDeadline: string;
  claimed: boolean;
  /** Recipient wallet pubkey at claim time (claim flow does not move chain funds automatically). */
  claimTxHash?: string;
  recipientTelegramUserId?: string;
}

const receipts = new Map<string, PendingReceipt>();
const idsByPhone = new Map<string, string[]>();

function normalizePhone(p: string): string {
  return p.replace(/[\s-]/g, "");
}

export async function sendClaimInviteSms(phone: string, r: PendingReceipt): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "SendFlowSol_bot";
  const body = `SendFlow: ${r.amount} USDC from ${r.senderName}. Claim: https://t.me/${bot}?start=claim_${r.receiptId} (7 days)`;
  if (!sid || !token || !from) return false;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const params = new URLSearchParams({ To: normalizePhone(phone), From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return res.ok;
}

export function createPendingReceipt(
  senderId: string,
  amount: number,
  recipientPhone: string,
  senderName: string,
  message?: string
): PendingReceipt {
  const receiptId = `r_${randomBytes(10).toString("hex")}`;
  const claimDeadline = new Date(Date.now() + 7 * 86400000).toISOString();
  const phone = normalizePhone(recipientPhone);
  const r: PendingReceipt = {
    receiptId,
    senderUserId: senderId,
    senderName,
    amount,
    message,
    recipientIdentifier: phone,
    claimDeadline,
    claimed: false,
  };
  receipts.set(receiptId, r);
  const list = idsByPhone.get(phone) ?? [];
  list.push(receiptId);
  idsByPhone.set(phone, list);
  void sendClaimInviteSms(phone, r).catch(() => {});
  return r;
}

export function claimReceipt(receiptId: string, walletAddress: string, recipientTelegramUserId: string): boolean {
  const id = receiptId.startsWith("r_") ? receiptId : receiptId.replace(/^claim_/, "r_");
  const r = receipts.get(id);
  if (!r || r.claimed) return false;
  if (Date.now() > new Date(r.claimDeadline).getTime()) return false;
  r.claimed = true;
  r.claimTxHash = walletAddress;
  r.recipientTelegramUserId = recipientTelegramUserId;
  return true;
}

export function getPendingReceipts(recipientIdentifier: string): PendingReceipt[] {
  const phone = normalizePhone(recipientIdentifier);
  const ids = idsByPhone.get(phone) ?? [];
  const out: PendingReceipt[] = [];
  for (const i of ids) {
    const x = receipts.get(i);
    if (x && !x.claimed) out.push(x);
  }
  return out;
}

export function getReceiptById(receiptId: string): PendingReceipt | undefined {
  const id = receiptId.startsWith("r_") ? receiptId : receiptId.replace(/^claim_/, "r_");
  return receipts.get(id);
}

export function expireOldReceipts(): PendingReceipt[] {
  const out: PendingReceipt[] = [];
  const now = Date.now();
  for (const [id, r] of receipts) {
    if (r.claimed) continue;
    if (new Date(r.claimDeadline).getTime() < now) {
      out.push(r);
      receipts.delete(id);
      const list = idsByPhone.get(r.recipientIdentifier) ?? [];
      idsByPhone.set(
        r.recipientIdentifier,
        list.filter((x) => x !== id)
      );
    }
  }
  return out;
}
