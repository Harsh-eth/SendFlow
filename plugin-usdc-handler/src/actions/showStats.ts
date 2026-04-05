import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { sharedGetAllTransfers, shortWallet } from "@sendflow/plugin-intent-parser";

export const showStatsAction: Action = {
  name: "SHOW_STATS",
  similes: ["MY_STATS", "SPENDING_STATS", "ANALYTICS", "MONTHLY_STATS"],
  description: "Show spending statistics and analytics for the user.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:stats|analytics|how\s+much\s+(?:have\s+i\s+)?sent|spending|my\s+stats)\b/.test(text);
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;
    const all = sharedGetAllTransfers(entityId);

    if (all.length === 0) {
      const msg = "📊 <b>No transfer data yet</b>\n\nComplete a transfer to see your stats!";
      if (callback) await callback({ text: msg, actions: ["SHOW_STATS"], source: message.content.source });
      return { success: true, text: msg };
    }

    const now = new Date();
    const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonth = all.filter((t) => new Date(t.completedAt) >= monthStart);

    const totalSent = thisMonth.reduce((s, t) => s + t.amount, 0);
    const transferCount = thisMonth.length;
    const avgTransfer = transferCount > 0 ? totalSent / transferCount : 0;
    const feeRate = 0.005;
    const totalFees = totalSent * feeRate;
    const westernUnionRate = 0.05;
    const saved = totalSent * westernUnionRate - totalFees;

    const recipientCounts = new Map<string, number>();
    for (const t of thisMonth) {
      const key = t.receiverLabel || shortWallet(t.receiverWallet);
      recipientCounts.set(key, (recipientCounts.get(key) ?? 0) + 1);
    }
    let mostFrequent = "N/A";
    let maxCount = 0;
    for (const [name, count] of recipientCounts) {
      if (count > maxCount) {
        mostFrequent = name;
        maxCount = count;
      }
    }

    const msg = [
      `📊 <b>Your SendFlow Stats</b> (${monthName})`,
      ``,
      `  Total sent: <b>${totalSent.toFixed(2)} USDC</b>`,
      `  Transfers: <b>${transferCount}</b>`,
      `  Most sent to: <b>${mostFrequent}</b> (<b>${maxCount}</b> time${maxCount === 1 ? "" : "s"})`,
      `  Avg transfer: <b>${avgTransfer.toFixed(2)} USDC</b>`,
      `  Fees paid: <b>${totalFees.toFixed(2)} USDC</b>`,
      `  💰 Saved vs Western Union (~5%): <b>~$${Math.max(0, saved).toFixed(2)}</b>`,
      ``,
      `  All-time transfers: <b>${all.length}</b>`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["SHOW_STATS"], source: message.content.source });
    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Show my stats" } },
      { name: "{{agent}}", content: { text: "📊 Your SendFlow Stats...", actions: ["SHOW_STATS"] } },
    ],
  ],
};
