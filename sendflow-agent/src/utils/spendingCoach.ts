import type { IAgentRuntime } from "@elizaos/core";
import type { SharedTxRecord } from "@sendflow/plugin-intent-parser";
import { loadMemory } from "./userMemory";

const disabled = new Set<string>();

export function setInsightsDisabled(userId: string, v: boolean): void {
  if (v) disabled.add(userId);
  else disabled.delete(userId);
}

export function isInsightsDisabled(userId: string): boolean {
  return disabled.has(userId);
}

export async function generateInsight(
  userId: string,
  history: SharedTxRecord[],
  currentTransfer: SharedTxRecord,
  _runtime: IAgentRuntime
): Promise<string | null> {
  if (disabled.has(userId)) return null;
  if (history.length < 3) return null;

  const mem = await loadMemory(userId);
  const monthTotal = history.reduce((s, t) => s + (t.amount ?? 0), 0) + (currentTransfer.amount ?? 0);
  const top = new Map<string, number>();
  for (const t of history) {
    const k = t.receiverLabel ?? shortAddr(t.receiverWallet ?? "");
    top.set(k, (top.get(k) ?? 0) + (t.amount ?? 0));
  }
  const sorted = [...top.entries()].sort((a, b) => b[1] - a[1]);
  const topName = sorted[0]?.[0] ?? "contacts";

  const lines = [
    `💡 <b>SendFlow Insight</b>`,
    ``,
    `You've sent <b>${monthTotal.toFixed(2)} USDC</b> recently across your history.`,
    `Top destination: <b>${topName}</b>`,
  ];
  if (mem.monthlyBudget) {
    const left = mem.monthlyBudget - mem.monthlySpent;
    lines.push(`Budget: <b>${mem.monthlyBudget} USDC</b> — about <b>${left.toFixed(2)} USDC</b> remaining.`);
  }
  lines.push(``, `💡 Tip: say <code>Set my monthly budget to 500 USDC</code> to track spending.`);
  return lines.join("\n");
}

function shortAddr(a: string): string {
  if (a.length < 12) return a;
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}
