import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  shortWallet,
  solscanTxLink,
  type RemittanceIntent,
  loggerCompat as logger,
  calculateSavings,
  formatSavingsShareMessage,
  appendSavingsLedgerEntry,
  consumeSavingsMilestones,
  getUserLanguage,
  getLifetimeSavings,
} from "@sendflow/plugin-intent-parser";

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
  similes: ["NOTIFY_SENDFLOW", "SEND_NOTIFICATIONS", "ALERT_PARTIES", "NOTIFY_SENDER", "NOTIFY_RECEIVER"],
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

    const entityId = message.entityId != null ? String(message.entityId) : "";
    const feeLamportsRawEarly = getStr(runtime, "LAST_TRANSFER_FEE_LAMPORTS");
    const parsedFeeEarly = Number(feeLamportsRawEarly);
    const txFeeLamportsEarly =
      Number.isFinite(parsedFeeEarly) && parsedFeeEarly > 0 ? Math.floor(parsedFeeEarly) : 5000;
    const langEarly = entityId ? getUserLanguage(entityId) : "en";
    const savingsPreview = calculateSavings(payout.amountSent, txFeeLamportsEarly, {
      language: langEarly,
      recipientLabel: intent.receiverLabel,
      receiverWallet: intent.receiverWallet,
    });
    const priorSaved = entityId ? getLifetimeSavings(entityId).totalSavedUsd : 0;
    const totalWithThisTx = priorSaved + savingsPreview.savingVsWU;
    const savingsBlock = [
      ``,
      `<b>What you saved:</b>`,
      `Western Union: <b>$${savingsPreview.westernUnionFeeUsd.toFixed(2)}</b>`,
      `SendFlow: <b>$${savingsPreview.sendflowFeeUsd.toFixed(4)}</b>`,
      `<b>Saved on this transfer: $${savingsPreview.savingVsWU.toFixed(2)} 🎉</b>`,
      `Total saved with SendFlow: <b>$${totalWithThisTx.toFixed(2)}</b>`,
    ].join("\n");

    const senderLine = [
      `✅ <b>Transfer Complete!</b>`,
      `💸 Sent: <b>${payout.amountSent} USDC</b>`,
      `👤 To: <b>${intent.receiverLabel}</b> (<code>${shortWallet(intent.receiverWallet)}</code>)`,
      `🔗 ${solscanTxLink(payout.txHash)}`,
      `⚡ Powered by SendFlow on Nosana`,
      savingsBlock,
    ].join("\n");

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
        const receiverLine = [
          `✅ <b>Transfer Complete!</b>`,
          `💸 Received: <b>${payout.amountSent} USDC</b>`,
          `👤 From: <b>${senderName}</b>`,
          `🔗 ${solscanTxLink(payout.txHash)}`,
          `⚡ Powered by SendFlow on Nosana`,
          savingsBlock,
        ].join("\n");
        await telegramSend(token, recvId, receiverLine);
      } else {
        logger.info("sendflow: no receiverTelegramId; skip receiver notify");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, text: `❌ Notify receiver failed: ${msg}` };
    }

    const feeLamportsRaw = getStr(runtime, "LAST_TRANSFER_FEE_LAMPORTS");
    const parsedFee = Number(feeLamportsRaw);
    const txFeeLamports = Number.isFinite(parsedFee) && parsedFee > 0 ? Math.floor(parsedFee) : 5000;
    const botUsername = getStr(runtime, "TELEGRAM_BOT_USERNAME");
    const lang = entityId ? getUserLanguage(entityId) : "en";
    const savings = calculateSavings(payout.amountSent, txFeeLamports, {
      language: lang,
      recipientLabel: intent.receiverLabel,
      receiverWallet: intent.receiverWallet,
    });

    void appendSavingsLedgerEntry(entityId || "unknown", {
      ts: new Date().toISOString(),
      amountUsdc: payout.amountSent,
      savedVsWU: savings.savingVsWU,
      txSig: payout.txHash,
    })
      .then(() => {
        setTimeout(() => {
          void (async () => {
            try {
              if (senderChat) {
                await telegramSend(token, senderChat, formatSavingsShareMessage(savings));
              }
            } catch (err) {
              logger.warn(`sendflow savings share message failed: ${err}`);
            }
          })();
        }, 1500);
        setTimeout(() => {
          void (async () => {
            try {
              const milestones = await consumeSavingsMilestones(entityId || "unknown", botUsername || undefined);
              if (!senderChat) return;
              let delay = 0;
              for (const m of milestones) {
                const d = delay;
                setTimeout(() => {
                  void telegramSend(token, senderChat!, m).catch((err) =>
                    logger.warn(`sendflow savings milestone send failed: ${err}`)
                  );
                }, d);
                delay += 900;
              }
            } catch (err) {
              logger.warn(`sendflow savings milestone failed: ${err}`);
            }
          })();
        }, 3200);
      })
      .catch((err) => {
        logger.warn(`sendflow savings ledger append failed: ${err}`);
      });

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
