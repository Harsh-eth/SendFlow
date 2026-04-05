import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { loggerCompat as logger } from "../utils/structuredLogger";
import { createInvoice as storeInvoice } from "../utils/invoiceStore";

function extractAmount(text: string): number | undefined {
  const m = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\b/i);
  return m ? Number(m[1]) : undefined;
}

function extractLabel(text: string): string {
  const m = text.match(/\b(?:label|for|memo|note)\s+(?:it\s+)?(.+?)$/i);
  return m?.[1]?.trim().replace(/['"]+/g, "") ?? "Payment";
}

export const createInvoiceAction: Action = {
  name: "CREATE_INVOICE",
  similes: ["GENERATE_INVOICE", "PAYMENT_LINK", "INVOICE"],
  description: "Generate a shareable payment link for receiving USDC.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:create\s+invoice|generate\s+(?:invoice|payment\s+link)|payment\s+link)\b/.test(text);
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
        "⚠️ <b>Please include a USDC amount.</b> Example: \"Create invoice for 50 USDC\"";
      if (callback) await callback({ text: msg, actions: ["CREATE_INVOICE"], source: message.content.source });
      return { success: false, text: msg };
    }

    const label = extractLabel(text);

    const senderWalletRaw = runtime.getSetting("SOLANA_SENDER_PUBLIC_KEY");
    const creatorWallet = typeof senderWalletRaw === "string" ? senderWalletRaw : "";

    const invoice = storeInvoice({
      creatorWallet,
      creatorEntityId: entityId,
      amount,
      label,
    });

    const botUsername = runtime.getSetting("TELEGRAM_BOT_USERNAME") ?? "SendFlowSol_bot";
    const paymentLink = `https://t.me/${botUsername}?start=inv_${invoice.invoiceId}`;

    const msg = [
      `🧾 <b>Invoice Created!</b>`,
      ``,
      `💰 <b>Amount:</b> ${amount} USDC`,
      `🏷 <b>Label:</b> ${label}`,
      `📎 <b>Payment link:</b> ${paymentLink}`,
      `⏰ <b>Expires in 7 days</b>`,
      ``,
      `Share this link — they click it and pay in 2 taps.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["CREATE_INVOICE"], source: message.content.source });
    logger.info(`INVOICE: Created ${invoice.invoiceId} for ${amount} USDC`);

    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Create invoice for 50 USDC" } },
      { name: "{{agent}}", content: { text: "🧾 Invoice Created!...", actions: ["CREATE_INVOICE"] } },
    ],
  ],
};
