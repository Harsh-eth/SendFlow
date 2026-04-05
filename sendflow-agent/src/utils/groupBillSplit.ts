import { getUserIdForUsername } from "./groupHandler";

export interface BillSplitParticipant {
  userId: string;
  username: string;
  amount: number;
  paid: boolean;
  paidAt?: string;
}

export interface BillSplit {
  splitId: string;
  initiatorId: string;
  groupChatId: string;
  totalAmount: number;
  description: string;
  participants: BillSplitParticipant[];
  status: "collecting" | "complete" | "expired";
  createdAt: string;
  expiresAt: string;
}

const MAX_SPLITS = 5000;
const billSplits = new Map<string, BillSplit>();
const groupToActiveSplit = new Map<string, string>();
let splitSeq = 0;

function trim(): void {
  while (billSplits.size >= MAX_SPLITS) {
    const first = billSplits.keys().next().value as string | undefined;
    if (first) {
      const s = billSplits.get(first);
      if (s) groupToActiveSplit.delete(s.groupChatId);
      billSplits.delete(first);
    } else break;
  }
}

export function createBillSplit(
  initiatorId: string,
  groupChatId: string,
  total: number,
  description: string,
  participantUsernames: string[]
): BillSplit {
  trim();
  splitSeq += 1;
  const n = Math.max(1, participantUsernames.length);
  const each = Math.round((total / n) * 100) / 100;
  const participants: BillSplitParticipant[] = participantUsernames.map((u) => {
    const uid = getUserIdForUsername(u) ?? `pending_${u}`;
    return { userId: uid, username: u, amount: each, paid: false };
  });
  const now = new Date();
  const exp = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const split: BillSplit = {
    splitId: `split_${Date.now()}_${splitSeq}`,
    initiatorId,
    groupChatId,
    totalAmount: total,
    description,
    participants,
    status: "collecting",
    createdAt: now.toISOString(),
    expiresAt: exp.toISOString(),
  };
  billSplits.set(split.splitId, split);
  groupToActiveSplit.set(groupChatId, split.splitId);
  return split;
}

export function recordPayment(splitId: string, userId: string): boolean {
  const s = billSplits.get(splitId);
  if (!s || s.status !== "collecting") return false;
  const p = s.participants.find((x) => x.userId === userId || x.username === userId);
  if (!p || p.paid) return false;
  p.paid = true;
  p.paidAt = new Date().toISOString();
  const allPaid = s.participants.every((x) => x.paid);
  if (allPaid) s.status = "complete";
  return true;
}

export function getSplitStatus(splitId: string): BillSplit | null {
  return billSplits.get(splitId) ?? null;
}

export function getActiveSplitForGroup(groupChatId: string): BillSplit | null {
  const id = groupToActiveSplit.get(groupChatId);
  if (!id) return null;
  const s = billSplits.get(id);
  if (!s || s.status !== "collecting") return null;
  if (Date.now() > new Date(s.expiresAt).getTime()) {
    s.status = "expired";
    return null;
  }
  return s;
}

export function formatSplitMessage(s: BillSplit): string {
  const each = s.participants[0]?.amount ?? s.totalAmount / Math.max(1, s.participants.length);
  const lines = [
    `🧾 <b>Bill Split — ${escape(s.description)}</b>`,
    `Total: <b>${s.totalAmount} USDC</b> (${each} each)`,
    ``,
  ];
  let collected = 0;
  for (const p of s.participants) {
    const icon = p.paid ? "✅" : "⏳";
    lines.push(`${icon} ${escape(p.username)} — ${p.paid ? "paid" : "pending"}`);
    if (p.paid) collected += p.amount;
  }
  lines.push(``, `Collected: <b>${collected}/${s.totalAmount} USDC</b>`);
  return lines.join("\n");
}

function escape(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
