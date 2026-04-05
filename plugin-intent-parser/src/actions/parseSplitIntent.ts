import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { loggerCompat as logger } from "../utils/structuredLogger";
import type { RemittanceIntent } from "../types";
import { extractSolanaAddress, isValidReceiverWallet } from "../utils/solanaAddress";
import { resolveSolDomain, extractSolDomain } from "../utils/resolveDomain";
import { getContact } from "../utils/contactBook";
import { shortWallet } from "../utils/format";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function extractRecipients(text: string): string[] {
  const toMatch = text.match(/\b(?:between|to|among)\s+(.+)/i);
  if (!toMatch) return [];
  const recipientsPart = toMatch[1];
  return recipientsPart
    .split(/\s*(?:,|\band\b)\s*/i)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

function extractAmount(text: string): { total: number; isEach: boolean } | null {
  const eachMatch = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\s+each\b/i);
  if (eachMatch) return { total: Number(eachMatch[1]), isEach: true };

  const totalMatch = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\b/i);
  if (totalMatch) return { total: Number(totalMatch[1]), isEach: false };

  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,6})?)/);
  if (dollar) return { total: Number(dollar[1]), isEach: false };

  return null;
}

async function resolveRecipient(
  raw: string,
  entityId: string,
  rpcUrl: string
): Promise<{ wallet: string; label: string } | null> {
  const contactWallet = getContact(entityId, raw);
  if (contactWallet) return { wallet: contactWallet, label: raw };

  if (raw.endsWith(".sol")) {
    try {
      const wallet = await resolveSolDomain(raw, rpcUrl);
      return { wallet, label: raw };
    } catch {
      return null;
    }
  }

  const addr = extractSolanaAddress(raw);
  if (addr && isValidReceiverWallet(addr)) {
    return { wallet: addr, label: raw };
  }

  return null;
}

export const parseSplitIntentAction: Action = {
  name: "PARSE_SPLIT_INTENT",
  similes: ["SPLIT_PAYMENT", "SPLIT_USDC", "SEND_EACH", "SPLIT_EQUALLY"],
  description: "Split a USDC amount equally between multiple wallets.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:split|each\s+to|equally\s+between|equally\s+among)\b/.test(text);
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

    const amountInfo = extractAmount(text);
    if (!amountInfo || amountInfo.total <= 0) {
      const msg =
        "⚠️ <b>Couldn't parse split amount.</b> Example: \"Split 90 USDC between raj.sol, mike.sol and sara.sol\"";
      if (callback) await callback({ text: msg, actions: ["PARSE_SPLIT_INTENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    const rawRecipients = extractRecipients(text);
    if (rawRecipients.length < 2) {
      const msg =
        "⚠️ <b>Need at least 2 recipients</b> for a split. Separate with commas or 'and'.";
      if (callback) await callback({ text: msg, actions: ["PARSE_SPLIT_INTENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    const rpcUrl = (() => {
      const v = runtime.getSetting("SOLANA_RPC_URL");
      return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
    })();

    const resolved: Array<{ wallet: string; label: string }> = [];
    const failed: string[] = [];
    for (const raw of rawRecipients) {
      const result = await resolveRecipient(raw, entityId, rpcUrl);
      if (result) resolved.push(result);
      else failed.push(raw);
    }

    if (failed.length > 0) {
      const msg = `⚠️ <b>Could not resolve:</b> ${failed.join(", ")}\n\nPlease check wallet addresses or .sol domains.`;
      if (callback) await callback({ text: msg, actions: ["PARSE_SPLIT_INTENT"], source: message.content.source });
      return { success: false, text: msg };
    }

    const amountEach = amountInfo.isEach
      ? amountInfo.total
      : Math.floor((amountInfo.total / resolved.length) * 1e6) / 1e6;
    const totalRequired = amountInfo.isEach
      ? amountInfo.total * resolved.length
      : amountInfo.total;

    const splitIntents: RemittanceIntent[] = resolved.map((r) => ({
      amount: amountEach,
      sourceMint: USDC_MAINNET,
      targetMint: USDC_MAINNET,
      targetRail: "SPL_TRANSFER" as const,
      receiverLabel: r.label,
      receiverWallet: r.wallet,
      confidence: 1.0,
    }));

    const previewLines = splitIntents.map(
      (si) =>
        `  <b>${si.amount} USDC</b> → ${si.receiverLabel} (<code>${shortWallet(si.receiverWallet)}</code>)`
    );

    const msg = [
      `💱 <b>Split Transfer Preview</b>`,
      ``,
      ...previewLines,
      ``,
      `💰 <b>Total:</b> ${totalRequired} USDC`,
      `👥 <b>Recipients:</b> ${resolved.length}`,
      ``,
      `Reply <b>YES</b> to confirm or <b>NO</b> to cancel.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["PARSE_SPLIT_INTENT"], source: message.content.source });

    logger.info(`SPLIT: Parsed ${resolved.length} recipients, ${amountEach} each`);

    return {
      success: true,
      text: msg,
      values: {
        sendflow: {
          splitIntents,
          splitTotal: totalRequired,
        },
      },
    };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Split 90 USDC equally between raj.sol, mike.sol and sara.sol" } },
      { name: "{{agent}}", content: { text: "💱 Split Transfer Preview...", actions: ["PARSE_SPLIT_INTENT"] } },
    ],
  ],
};
