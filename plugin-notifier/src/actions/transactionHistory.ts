import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  type SharedTxRecord,
  sharedRecordTransaction,
  sharedGetTransactions,
  sharedGetLastTransfer,
  sharedGetLastTransferTo,
  sharedGetAllTransfers,
  shortWallet,
  solscanTxLink,
} from "@sendflow/plugin-intent-parser";

export type TxRecord = SharedTxRecord;

export function recordTransaction(entityId: string, record: TxRecord): void {
  sharedRecordTransaction(entityId, record);
}

export function getLastTransfer(entityId: string): TxRecord | null {
  return sharedGetLastTransfer(entityId);
}

export function getLastTransferTo(entityId: string, label: string): TxRecord | null {
  return sharedGetLastTransferTo(entityId, label);
}

export function getAllTransfers(entityId: string): TxRecord[] {
  return sharedGetAllTransfers(entityId);
}

export const transactionHistoryAction: Action = {
  name: "TRANSACTION_HISTORY",
  similes: ["HISTORY", "TX_HISTORY", "SHOW_HISTORY", "PAST_TRANSFERS", "MY_TRANSACTIONS"],
  description: "Shows the user's last 5 SendFlow transactions with Solscan links.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:history|transactions?|past\s*transfers?|my\s*tx|repeat\s*last|send\s*again|last\s*transfer)\b/.test(text);
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;
    const userText = (message.content.text ?? "").toLowerCase();

    const isRepeat = /\b(?:repeat\s*last|last\s*transfer)\b/.test(userText);
    const sendAgainMatch = userText.match(/\bsend\s*again\s*(?:to\s+)?(\S+)/);

    if (isRepeat) {
      const last = getLastTransfer(entityId);
      if (!last) {
        const text = "📋 <b>No previous transfer</b> to repeat.";
        if (callback) await callback({ text, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
        return { success: false, text };
      }
      const msg = `🔄 Repeating: <b>${last.amount} USDC</b> → <code>${shortWallet(last.receiverWallet)}</code> (<b>${last.receiverLabel}</b>)`;
      if (callback) await callback({ text: msg, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
      return {
        success: true,
        text: msg,
        values: {
          sendflow: {
            repeatIntent: {
              amount: last.amount,
              sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              targetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              targetRail: "SPL_TRANSFER",
              receiverLabel: last.receiverLabel,
              receiverWallet: last.receiverWallet,
              confidence: 1.0,
            },
          },
        },
      };
    }

    if (sendAgainMatch) {
      const target = sendAgainMatch[1];
      const last = getLastTransferTo(entityId, target);
      if (!last) {
        const text = `📋 No previous transfer to <b>"${target}"</b> found.`;
        if (callback) await callback({ text, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
        return { success: false, text };
      }
      const msg = `🔄 Sending again: <b>${last.amount} USDC</b> → <code>${shortWallet(last.receiverWallet)}</code> (<b>${last.receiverLabel}</b>)`;
      if (callback) await callback({ text: msg, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
      return {
        success: true,
        text: msg,
        values: {
          sendflow: {
            repeatIntent: {
              amount: last.amount,
              sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              targetMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              targetRail: "SPL_TRANSFER",
              receiverLabel: last.receiverLabel,
              receiverWallet: last.receiverWallet,
              confidence: 1.0,
            },
          },
        },
      };
    }

    const list = sharedGetTransactions(entityId);
    if (list.length === 0) {
      const text =
        "📋 <b>No transactions yet</b>\n\nYou haven't sent any transfers through SendFlow yet.\n\nTry: <code>Send 1 USDC to &lt;wallet&gt;</code>";
      if (callback) {
        await callback({ text, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
      }
      return { success: true, text };
    }

    const recent = list.slice(0, 5);
    const lines = recent.map((tx, i) => {
      const date = new Date(tx.completedAt).toLocaleDateString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      return `${i + 1}. 💸 <b>${tx.amount} USDC</b> → <code>${shortWallet(tx.receiverWallet)}</code> (<b>${tx.receiverLabel}</b>)\n   📅 ${date} | 🔗 ${solscanTxLink(tx.txHash)}`;
    });

    const text = [
      `📋 <b>Recent Transactions</b> (${Math.min(5, list.length)} of ${list.length})`,
      ``,
      ...lines,
      ``,
      `⚡ Powered by SendFlow on Nosana`,
    ].join("\n");

    if (callback) {
      await callback({ text, actions: ["TRANSACTION_HISTORY"], source: message.content.source });
    }
    return { success: true, text };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "history" } },
      { name: "{{agent}}", content: { text: "📋 Recent Transactions...", actions: ["TRANSACTION_HISTORY"] } },
    ],
  ],
};
