import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { loggerCompat as logger } from "../utils/structuredLogger";
import { extractSolanaAddress, isValidReceiverWallet } from "../utils/solanaAddress";
import { resolveSolDomain, extractSolDomain } from "../utils/resolveDomain";
import { getContact } from "../utils/contactBook";
import {
  addConditionalTransfer,
  cancelConditionalTransfer,
  getConditionalTransfer,
  type ConditionalTransfer,
} from "../utils/priceMonitor";
import { shortWallet } from "../utils/format";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function extractAmount(text: string): number | undefined {
  const m = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\b/i);
  return m ? Number(m[1]) : undefined;
}

function extractCondition(text: string): {
  asset: string;
  operator: "above" | "below";
  threshold: number;
} | null {
  const m = text.match(
    /\b(?:when|if|only\s+when)\s+(\w+)\s+(?:price\s+)?(?:is\s+)?(?:hits?\s+)?(?:reaches?\s+)?(above|below|over|under|>\s*|<\s*)?\s*\$?\s*([0-9]+(?:\.[0-9]+)?)/i
  );
  if (!m) return null;
  const asset = m[1].toUpperCase();
  const rawOp = (m[2] ?? "above").toLowerCase().trim();
  const operator: "above" | "below" =
    rawOp === "below" || rawOp === "under" || rawOp.startsWith("<")
      ? "below"
      : "above";
  const threshold = Number(m[3]);
  if (!Number.isFinite(threshold)) return null;
  return { asset, operator, threshold };
}

function extractReceiver(text: string): string | undefined {
  const toMatch = text.match(/\bto\s+(\S+)/i);
  return toMatch?.[1];
}

export const parseConditionalIntentAction: Action = {
  name: "CONDITIONAL_TRANSFER",
  similes: ["SEND_WHEN", "PRICE_ALERT_SEND", "TIMED_TRANSFER", "CONDITIONAL_SEND"],
  description: "Set up a conditional transfer that executes when a price condition is met.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    if (/\bcancel\s+(?:conditional|scheduled|timed)\b/.test(text)) return true;
    return /\b(?:when\s+\w+\s+(?:price\s+)?(?:is\s+)?(?:hits?|reaches?|above|below|over|under)|only\s+when)\b/.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;
    const text = message.content.text ?? "";
    const lower = text.toLowerCase();

    if (/\bcancel\s+(?:conditional|scheduled|timed)\b/.test(lower)) {
      const cancelled = cancelConditionalTransfer(entityId);
      const msg = cancelled
        ? "✅ <b>Conditional transfer cancelled.</b>"
        : "⚠️ <b>No active conditional transfer</b> to cancel.";
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: true, text: msg };
    }

    const amount = extractAmount(text);
    if (!amount) {
      const msg =
        "⚠️ <b>Please include a USDC amount.</b> Example: \"Send 100 USDC to Mom when SOL hits $150\"";
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const condition = extractCondition(text);
    if (!condition) {
      const msg =
        "⚠️ <b>Couldn't parse price condition.</b> Example: \"...when SOL is above $150\"";
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const rawReceiver = extractReceiver(text);
    if (!rawReceiver) {
      const msg =
        "⚠️ <b>Please specify a recipient.</b> Example: \"Send 100 USDC to Mom when SOL hits $150\"";
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    let receiverWallet = rawReceiver;
    let receiverLabel = rawReceiver;

    const contactWallet = getContact(entityId, rawReceiver);
    if (contactWallet) {
      receiverWallet = contactWallet;
      receiverLabel = rawReceiver;
    } else if (rawReceiver.endsWith(".sol")) {
      const rpcUrl = (() => {
        const v = runtime.getSetting("SOLANA_RPC_URL");
        return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
      })();
      try {
        receiverWallet = await resolveSolDomain(rawReceiver, rpcUrl);
        receiverLabel = rawReceiver;
      } catch {
        const msg = `⚠️ <b>Could not resolve</b> ${rawReceiver}. Please check the domain.`;
        if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
        return { success: false, text: msg };
      }
    } else {
      const addr = extractSolanaAddress(rawReceiver);
      if (addr) receiverWallet = addr;
    }

    if (!isValidReceiverWallet(receiverWallet)) {
      const msg = `⚠️ <b>Invalid recipient:</b> "${rawReceiver}". Use a wallet address, .sol domain, or saved contact name.`;
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const existing = getConditionalTransfer(entityId);
    if (existing) {
      const msg =
        "⚠️ <b>You already have an active conditional transfer.</b> Cancel it first with: \"Cancel conditional transfer\"";
      if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const ct: ConditionalTransfer = {
      userId: entityId,
      intent: {
        amount,
        sourceMint: USDC_MAINNET,
        targetMint: USDC_MAINNET,
        targetRail: "SPL_TRANSFER",
        receiverLabel,
        receiverWallet,
        confidence: 1.0,
      },
      condition,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    addConditionalTransfer(ct);

    const msg = [
      `⏳ <b>Conditional transfer set!</b>`,
      ``,
      `💸 <b>${amount} USDC</b> → ${receiverLabel} (<code>${shortWallet(receiverWallet)}</code>)`,
      `📊 <b>Condition:</b> ${condition.asset} ${condition.operator} $${condition.threshold}`,
      `⏰ <b>Expires in 24 hours</b>`,
      ``,
      `I'll check every 30 seconds and execute automatically when the condition is met.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["CONDITIONAL_TRANSFER"], source: message.content.source });
    logger.info(`CONDITIONAL: Set for ${entityId} — ${condition.asset} ${condition.operator} $${condition.threshold}`);

    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Send 100 USDC to Mom when SOL is above $150" } },
      { name: "{{agent}}", content: { text: "⏳ Conditional transfer set!...", actions: ["CONDITIONAL_TRANSFER"] } },
    ],
  ],
};
