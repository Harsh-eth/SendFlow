import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { clearPending, getPending, isExpired } from "@sendflow/plugin-intent-parser";

function parseYesNo(text: string): "yes" | "no" | null {
  const t = text.trim().toLowerCase();
  if (t === "yes" || t === "y") return "yes";
  if (t === "no" || t === "n") return "no";
  return null;
}

export const confirmSendflowAction: Action = {
  name: "CONFIRM_SENDFLOW",
  similes: ["YES_SEND", "CONFIRM_TRANSFER"],
  description:
    "Confirms or cancels a pending SendFlow quote (reply YES within 60s after rate check).",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const roomId = message.roomId;
    const entityId = message.entityId;
    if (!roomId || !entityId) return false;
    const p = getPending(roomId, entityId);
    if (!p || isExpired(p)) {
      if (p) clearPending(roomId, entityId);
      return false;
    }
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
    const p = getPending(roomId, entityId);
    if (!p || isExpired(p)) {
      clearPending(roomId, entityId);
      return {
        success: false,
        text: "❌ Transfer cancelled. No funds moved.",
      };
    }

    const yn = parseYesNo(message.content.text ?? "");
    clearPending(roomId, entityId);

    if (yn === "no") {
      if (callback) {
        await callback({
          text: "❌ Transfer cancelled. No funds moved.",
          actions: ["CONFIRM_SENDFLOW"],
          source: message.content.source,
        });
      }
      return {
        success: false,
        text: "❌ Transfer cancelled. No funds moved.",
      };
    }

    const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
    if (callback) {
      await callback({
        text: "✅ Confirmed. Locking USDC next.",
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
  examples: [],
};
