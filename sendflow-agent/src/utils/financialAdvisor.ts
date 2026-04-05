import { ModelType, type IAgentRuntime } from "@elizaos/core";
import {
  sharedGetAllTransfers,
  sharedGetAllTransferUserIds,
  listSchedules,
} from "@sendflow/plugin-intent-parser";
import { loadMemory } from "./userMemory";
import { getVaultPosition } from "./savingsVault";
import { getActiveLoan } from "./microLoan";
import { getMarketPulse } from "./marketPulse";
import { getHealthyConnection } from "./rpcManager";

export async function generateWeeklyReport(userId: string, runtime: IAgentRuntime): Promise<string> {
  const txs = sharedGetAllTransfers(userId);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekly = txs.filter((t) => {
    const ts = t.completedAt ? new Date(t.completedAt).getTime() : 0;
    return ts >= weekAgo;
  });
  const weeklyVolume = weekly.reduce((s, t) => s + (t.amount ?? 0), 0);
  const lastWeekCut = Date.now() - 14 * 86_400_000;
  const lastWeek = txs.filter((t) => {
    const ts = t.completedAt ? new Date(t.completedAt).getTime() : 0;
    return ts >= lastWeekCut && ts < weekAgo;
  });
  const lastWeekVolume = lastWeek.reduce((s, t) => s + (t.amount ?? 0), 0);
  const topRecipient = weekly.reduce(
    (acc, t) => {
      const k = t.receiverLabel ?? t.receiverWallet ?? "?";
      acc[k] = (acc[k] ?? 0) + (t.amount ?? 0);
      return acc;
    },
    {} as Record<string, number>
  );
  const topRecipientName = Object.entries(topRecipient).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const mem = await loadMemory(userId);
  const vault = getVaultPosition(userId);
  const vaultBalance = vault?.depositedAmount ?? 0;
  const apy = vault?.estimatedAPY ?? 0;
  const budgetUsed = mem.monthlySpent ?? 0;
  const budgetTotal = mem.monthlyBudget ?? 500;
  const loan = getActiveLoan(userId);
  const loanStatus = loan ? `${loan.status} — ${loan.approvedAmount} USDC` : "none";

  let solPriceTrend = "stable";
  try {
    const conn = await getHealthyConnection();
    const pulse = await getMarketPulse(conn);
    if (/up|↑|bull/i.test(pulse)) solPriceTrend = "up";
    else if (/down|↓|bear/i.test(pulse)) solPriceTrend = "down";
  } catch {
    solPriceTrend = "unknown";
  }

  const recurring = listSchedules(userId).length;

  const prompt = `You are SendFlow's AI financial advisor. Analyze this user's data and give a 3-sentence personalized financial insight in a friendly tone. Focus on spending patterns, savings opportunities, and one actionable tip.

User data:
- Transfers this week: ${weekly.length} (total: ${weeklyVolume.toFixed(2)} USDC)
- vs last week: ${lastWeekVolume.toFixed(2)} USDC
- Top recipient: ${topRecipientName}
- Savings vault: ${vaultBalance.toFixed(2)} USDC at ${apy.toFixed(1)}% APY
- Budget used: ${budgetUsed}/${budgetTotal} USDC
- Active loans: ${loanStatus}
- Recurring schedules: ${recurring}
- SOL price trend: ${solPriceTrend}

Give exactly 3 sentences. Be specific with numbers. End with one emoji.`;

  let advice = "Track your USDC flows weekly, keep an emergency buffer, and review your largest recipients — you've got this! 💜";
  try {
    const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
    const txt =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "text" in raw
          ? String((raw as { text: string }).text)
          : String(raw);
    if (txt.trim()) advice = txt.trim();
  } catch {
    /* fallback */
  }

  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return [
    `📈 <b>Weekly Report — ${dateStr}</b>`,
    ``,
    `💸 Sent: <b>${weeklyVolume.toFixed(2)} USDC</b> (${weekly.length} tx)`,
    `🏦 Vault: <b>${vaultBalance.toFixed(2)} USDC</b> @ ~${apy.toFixed(1)}% APY`,
    `📊 Budget: <b>${Math.min(100, (budgetUsed / Math.max(budgetTotal, 1)) * 100).toFixed(0)}%</b> used`,
    ``,
    `🤖 <b>AI Advice</b>`,
    advice,
  ].join("\n");
}

export function scheduleWeeklyReports(
  runtime: IAgentRuntime,
  sendHtml: (chatId: string, html: string) => Promise<unknown>
): NodeJS.Timeout {
  const hour = Number(process.env.WEEKLY_REPORT_UTC_HOUR ?? 9);
  const enabled = (process.env.WEEKLY_REPORT_ENABLED ?? "true") === "true";
  return setInterval(async () => {
    if (!enabled) return;
    const now = new Date();
    if (now.getUTCDay() !== 0 || now.getUTCHours() !== hour || now.getUTCMinutes() > 5) return;
    for (const uid of sharedGetAllTransferUserIds()) {
      if (sharedGetAllTransfers(uid).length < 3) continue;
      try {
        const report = await generateWeeklyReport(uid, runtime);
        await sendHtml(uid, report);
      } catch {
        /* non-fatal */
      }
    }
  }, 3_600_000);
}
