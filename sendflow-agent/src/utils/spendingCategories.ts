import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";
import { sharedGetAllTransfers, listContacts } from "@sendflow/plugin-intent-parser";

export type SpendingCategory = "family" | "business" | "freelance" | "split" | "savings" | "other";

export interface CategorySummary {
  family: number;
  business: number;
  freelance: number;
  split: number;
  savings: number;
  other: number;
  total: number;
}

export interface BudgetStatus {
  monthlyBudgetUsdc: number;
  spentThisMonthUsdc: number;
  remainingUsdc: number;
  overBudget: boolean;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function categorizeTransfer(
  intent: RemittanceIntent,
  entityId: string,
  senderWallet?: string
): SpendingCategory {
  const contacts = listContacts(entityId);
  const recv = norm(intent.receiverWallet);
  for (const w of Object.values(contacts)) {
    if (norm(w) === recv) return "family";
  }
  const memo = norm(intent.memo ?? "");
  const label = norm(intent.receiverLabel);
  if (/\binvoice\b|\bwork\b|\bservice\b|\bclient\b/.test(memo) || /\binvoice\b|\bwork\b|\bservice\b/.test(label)) {
    return "business";
  }
  if (/\bfreelance\b|\bcontractor\b/.test(memo) || /\bfreelance\b/.test(label)) return "freelance";
  if (/\bsplit\b|\bsplitwise\b/.test(memo) || /\bsplit\b/.test(label)) return "split";
  if (senderWallet && norm(senderWallet) === recv) return "savings";
  return "other";
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function summarizeMonth(userId: string, yearMonthUtc: string): CategorySummary {
  const transfers = sharedGetAllTransfers(userId);
  const empty: CategorySummary = {
    family: 0,
    business: 0,
    freelance: 0,
    split: 0,
    savings: 0,
    other: 0,
    total: 0,
  };
  for (const t of transfers) {
    if (monthKey(t.completedAt) !== yearMonthUtc) continue;
    const cat = (t.category as SpendingCategory | undefined) ?? "other";
    switch (cat) {
      case "family":
        empty.family += t.amount;
        break;
      case "business":
        empty.business += t.amount;
        break;
      case "freelance":
        empty.freelance += t.amount;
        break;
      case "split":
        empty.split += t.amount;
        break;
      case "savings":
        empty.savings += t.amount;
        break;
      default:
        empty.other += t.amount;
    }
    empty.total += t.amount;
  }
  return empty;
}

export function getBudgetStatus(userId: string, budgetMonthlyUsdc = 1000): BudgetStatus {
  const now = new Date();
  const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const s = summarizeMonth(userId, key);
  return {
    monthlyBudgetUsdc: budgetMonthlyUsdc,
    spentThisMonthUsdc: s.total,
    remainingUsdc: Math.max(0, budgetMonthlyUsdc - s.total),
    overBudget: s.total > budgetMonthlyUsdc,
  };
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0";
  return ((part / total) * 100).toFixed(0);
}

/** HTML block for Telegram; empty if no transfers this month. */
export function formatMonthlySpendingReport(userId: string): string | null {
  const now = new Date();
  const thisKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5));
  const prevKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  const cur = summarizeMonth(userId, thisKey);
  const old = summarizeMonth(userId, prevKey);
  if (cur.total <= 0) return null;

  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  let cmp = "";
  if (old.total > 0) {
    const delta = ((cur.total - old.total) / old.total) * 100;
    cmp = `\nCompared to prior month: ${delta >= 0 ? "↑" : "↓"}${Math.abs(delta).toFixed(0)}%`;
  }

  return [
    `<b>${monthName} — Your money report</b>`,
    ``,
    `Total sent: <b>${cur.total.toFixed(2)} USDC</b>`,
    ``,
    `By category:`,
    `Family support   <b>${cur.family.toFixed(2)}</b> USDC (${pct(cur.family, cur.total)}%)`,
    `Business         <b>${cur.business.toFixed(2)}</b> USDC (${pct(cur.business, cur.total)}%)`,
    `Freelance        <b>${cur.freelance.toFixed(2)}</b> USDC (${pct(cur.freelance, cur.total)}%)`,
    `Splits           <b>${cur.split.toFixed(2)}</b> USDC (${pct(cur.split, cur.total)}%)`,
    `Savings (self)   <b>${cur.savings.toFixed(2)}</b> USDC (${pct(cur.savings, cur.total)}%)`,
    `Other            <b>${cur.other.toFixed(2)}</b> USDC (${pct(cur.other, cur.total)}%)`,
    cmp,
    ``,
    `Reply <b>monthly report</b> anytime for this summary.`,
  ].join("\n");
}
