import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  clearPending,
  getPending,
  isExpired,
  isProcessing,
  setProcessing,
  clearProcessing,
  loggerCompat as logger,
} from "@sendflow/plugin-intent-parser";

function parseYesNo(text: string): "yes" | "no" | null {
  const t = text.trim().toLowerCase();
  if (t === "yes" || t === "y") return "yes";
  if (t === "no" || t === "n") return "no";
  return null;
}

export const confirmSendflowAction: Action = {
  name: "CONFIRM_SENDFLOW",
  similes: ["YES_SEND", "CONFIRM_TRANSFER", "CONFIRM_SEND", "APPROVE_TRANSFER", "ACCEPT_RATE"],
  description:
    "Confirms or cancels a pending SendFlow quote (reply YES within 60s after rate check).",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const roomId = message.roomId;
    const entityId = message.entityId;
    if (!roomId || !entityId) return false;
    if (isProcessing(entityId as string)) return false;
    const p = getPending(roomId, entityId);
    if (!p || isExpired(p)) {
      if (p) clearPending(roomId, entityId);
      return false;
    }
    if (p.initiatorEntityId !== entityId) return false;
    return parseYesNo(message.content.text ?? "") != null;
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state: State | undefined,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = message.roomId as string;
    const entityId = message.entityId as string;

    if (isProcessing(entityId)) {
      logger.info(`SECURITY: blocked duplicate YES from ${entityId}`);
      if (callback) {
        await callback({
          text: "⏳ <b>Transfer already in progress</b>, please wait.",
          actions: ["CONFIRM_SENDFLOW"],
          source: message.content.source,
        });
      }
      return { success: false, text: "⏳ <b>Transfer already in progress</b>, please wait." };
    }

    const p = getPending(roomId, entityId);
    if (!p || isExpired(p)) {
      clearPending(roomId, entityId);
      return { success: false, text: "❌ <b>No pending transfer</b> found or it expired." };
    }

    if (p.initiatorEntityId !== entityId) {
      logger.info(`SECURITY: rejected confirmation from non-initiator ${entityId}`);
      return { success: false, text: "" };
    }

    const yn = parseYesNo(message.content.text ?? "");

    clearPending(roomId, entityId);

    if (yn === "no") {
      if (callback) {
        await callback({
          text: "❌ <b>Transfer cancelled.</b> No funds moved.",
          actions: ["CONFIRM_SENDFLOW"],
          source: message.content.source,
        });
      }
      return { success: false, text: "❌ <b>Transfer cancelled.</b> No funds moved." };
    }

    setProcessing(entityId);
    logger.info(`SECURITY: processing lock acquired for ${entityId}`);

    const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
    if (callback) {
      await callback({
        text: "✅ <b>Confirmed!</b> Locking USDC...",
        actions: ["CONFIRM_SENDFLOW"],
        source: message.content.source,
      });
    }

    return {
      success: true,
      text: "Confirmed",
      values: {
        sendflow: {
          ...prev,
          intent: p.intent,
          rate: {
            sourceMint: p.rate.sourceMint,
            targetMint: p.rate.targetMint,
            jupiterRate: p.rate.jupiterRate,
            pythRate: p.rate.pythRate,
            bestRate: p.rate.bestRate,
            provider: p.rate.provider,
            recipientGets: p.rate.recipientGets,
            sendflowFee: p.rate.sendflowFee,
            fetchedAt: p.rate.fetchedAt,
          },
          flow: { confirmed: true, confirmedAt: new Date().toISOString() },
        },
      },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "YES" } },
      {
        name: "{{agent}}",
        content: {
          text: "✅ <b>Confirmed!</b> Locking USDC...",
          actions: ["CONFIRM_SENDFLOW"],
        },
      },
    ],
    [
      { name: "{{user}}", content: { text: "NO" } },
      {
        name: "{{agent}}",
        content: {
          text: "❌ <b>Transfer cancelled.</b> No funds moved.",
          actions: ["CONFIRM_SENDFLOW"],
        },
      },
    ],
  ],
};
