import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
  logger,
} from "@elizaos/core";
import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";

function getStr(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return typeof v === "string" ? v : "";
}

async function telegramSend(token: string, chatId: string, text: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Telegram ${res.status}: ${errText}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Telegram send failed: ${msg}`);
  }
}

export const notifyPartiesAction: Action = {
  name: "NOTIFY_PARTIES",
  similes: ["NOTIFY_SENDFLOW", "SEND_NOTIFICATIONS"],
  description: "Sends SendFlow completion messages to sender and receiver on Telegram when possible.",
  validate: async (_runtime, _message, state?: State) => {
    const sf = state?.values?.sendflow as { payout?: { txHash?: string }; intent?: RemittanceIntent } | undefined;
    return Boolean(sf?.payout?.txHash && sf?.intent?.receiverLabel);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const token = getStr(runtime, "TELEGRAM_BOT_TOKEN");
    if (!token) {
      return { success: false, text: "❌ TELEGRAM_BOT_TOKEN not set." };
    }

    const sf = state?.values?.sendflow as {
      intent?: RemittanceIntent;
      payout?: { txHash: string; amountSent: number; explorerUrl?: string };
      receiverTelegramId?: string;
    };
    const intent = sf?.intent as RemittanceIntent;
    const payout = sf?.payout;
    if (!payout?.txHash) {
      return { success: false, text: "❌ Missing payout details for notification." };
    }

    const meta = message.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
    const chatId = meta?.telegram?.chat?.id;
    const senderChat = chatId != null ? String(chatId) : undefined;

    const senderName = getStr(runtime, "SENDFLOW_SENDER_DISPLAY_NAME") || "Sender";

    const txUrl = payout.explorerUrl ?? `https://solscan.io/tx/${payout.txHash}`;
    const senderLine = `✅ Sent! ${intent.receiverLabel} receives ${payout.amountSent} USDC | 🔗 ${txUrl}`;

    try {
      if (senderChat) {
        await telegramSend(token, senderChat, senderLine);
      } else {
        logger.info("sendflow: no sender Telegram chat id; skipping sender notify");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, text: `❌ Notify sender failed: ${msg}` };
    }

    try {
      const recvId = sf?.receiverTelegramId;
      if (recvId) {
        await telegramSend(
          token,
          recvId,
          `💸 ${payout.amountSent} USDC sent to your wallet from ${senderName}`
        );
      } else {
        logger.info("sendflow: no receiverTelegramId; skip receiver notify");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, text: `❌ Notify receiver failed: ${msg}` };
    }

    const notification = {
      senderNotified: Boolean(senderChat),
      receiverNotified: Boolean(sf?.receiverTelegramId),
      sentAt: new Date().toISOString(),
    };

    if (callback) {
      await callback({
        text: "Notifications sent.",
        actions: ["NOTIFY_PARTIES"],
        source: message.content.source,
      });
    }

    const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
    return {
      success: true,
      text: "Notifications sent",
      data: { notification },
      values: {
        sendflow: {
          ...prev,
          notification,
        },
      },
    };
  },
  examples: [],
};
