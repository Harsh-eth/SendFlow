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
import { resolveSolDomain } from "../utils/resolveDomain";
import { getContact } from "../utils/contactBook";
import { createRequest } from "../utils/paymentRequests";
import { shortWallet } from "../utils/format";

function extractAmount(text: string): number | undefined {
  const m = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\b/i);
  return m ? Number(m[1]) : undefined;
}

function extractTarget(text: string): string | undefined {
  const fromMatch = text.match(/\bfrom\s+(\S+)/i);
  if (fromMatch) return fromMatch[1];
  const askMatch = text.match(/\bask\s+(\S+)\s+to\b/i);
  if (askMatch) return askMatch[1];
  return undefined;
}

export const requestPaymentAction: Action = {
  name: "REQUEST_PAYMENT",
  similes: ["ASK_PAYMENT", "REQUEST_USDC", "SEND_REQUEST"],
  description: "Request USDC from another user.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:request\s+\d|ask\s+\S+\s+to\s+send)\b/.test(text);
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

    const amount = extractAmount(text);
    if (!amount) {
      const msg =
        "⚠️ <b>Please include a USDC amount.</b> Example: \"Request 20 USDC from raj.sol\"";
      if (callback) await callback({ text: msg, actions: ["REQUEST_PAYMENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    const rawTarget = extractTarget(text);
    if (!rawTarget) {
      const msg =
        "⚠️ <b>Please specify who to request from.</b> Example: \"Request 20 USDC from raj.sol\"";
      if (callback) await callback({ text: msg, actions: ["REQUEST_PAYMENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    let targetWallet = rawTarget;
    let targetLabel = rawTarget;

    const contactWallet = getContact(entityId, rawTarget);
    if (contactWallet) {
      targetWallet = contactWallet;
      targetLabel = rawTarget;
    } else if (rawTarget.endsWith(".sol")) {
      const rpcUrl = (() => {
        const v = runtime.getSetting("SOLANA_RPC_URL");
        return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
      })();
      try {
        targetWallet = await resolveSolDomain(rawTarget, rpcUrl);
        targetLabel = rawTarget;
      } catch {
        const msg = `⚠️ <b>Could not resolve</b> ${rawTarget}`;
        if (callback) await callback({ text: msg, actions: ["REQUEST_PAYMENT"], source: message.content.source });
        return { success: false, text: msg };
      }
    } else {
      const addr = extractSolanaAddress(rawTarget);
      if (addr) targetWallet = addr;
    }

    if (!isValidReceiverWallet(targetWallet)) {
      const msg = `⚠️ <b>Invalid target:</b> "${rawTarget}". Use a wallet address, .sol domain, or saved contact name.`;
      if (callback) await callback({ text: msg, actions: ["REQUEST_PAYMENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    const senderWalletRaw = runtime.getSetting("SOLANA_SENDER_PUBLIC_KEY");
    const senderWallet = typeof senderWalletRaw === "string" ? senderWalletRaw : "";

    const pr = createRequest({
      requestorEntityId: entityId,
      requestorWallet: senderWallet,
      requestorName: entityId.slice(0, 8),
      targetWallet,
      amount,
    });

    const msg = [
      `💸 <b>Payment Request Created</b>`,
      ``,
      `📋 <b>Request ID:</b> <code>${pr.requestId}</code>`,
      `💰 <b>Amount:</b> ${amount} USDC`,
      `🎯 <b>From:</b> ${targetLabel} (<code>${shortWallet(targetWallet)}</code>)`,
      `⏰ <b>Expires in 24 hours</b>`,
      ``,
      `The recipient can reply <b>PAY</b> to send instantly, or <b>DECLINE</b> to reject.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["REQUEST_PAYMENT"], source: message.content.source });
    logger.info(`REQUEST: ${entityId} requested ${amount} USDC from ${targetWallet} — ID: ${pr.requestId}`);

    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Request 20 USDC from raj.sol" } },
      { name: "{{agent}}", content: { text: "💸 Payment Request Created...", actions: ["REQUEST_PAYMENT"] } },
    ],
  ],
};
