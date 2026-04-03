import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  type JSONSchema,
  Memory,
  ModelType,
  State,
  logger,
} from "@elizaos/core";
import type { RemittanceIntent, RemittanceRail } from "../types";
import { getPending, isExpired } from "../pendingFlow";
import { extractSolanaAddress, isValidReceiverWallet } from "../utils/solanaAddress";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MAINNET = "So11111111111111111111111111111111111111112";

const LlmExtractJsonSchema: JSONSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    amount: { type: "number", minimum: 0 },
    sourceMint: { type: "string" },
    targetMint: { type: "string" },
    targetRail: { type: "string", enum: ["SPL_TRANSFER", "JUPITER_SWAP", "SQUADS_ESCROW"] },
    receiverLabel: { type: "string" },
    receiverWallet: { type: "string" },
    memo: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["amount", "sourceMint", "targetMint", "targetRail", "receiverLabel", "receiverWallet", "confidence"],
};

function normalizeIntent(raw: Record<string, unknown>): RemittanceIntent | null {
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const sourceMint = String(raw.sourceMint ?? "").trim();
  const targetMint = String(raw.targetMint ?? "").trim();
  const receiverWallet = String(raw.receiverWallet ?? "").trim();
  const receiverLabel = String(raw.receiverLabel ?? "").trim();
  const memo = raw.memo != null ? String(raw.memo) : undefined;
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence ?? 0)));
  const rail = String(raw.targetRail ?? "") as RemittanceRail;
  const rails: RemittanceRail[] = ["SPL_TRANSFER", "JUPITER_SWAP", "SQUADS_ESCROW"];
  if (!rails.includes(rail)) return null;
  if (!isValidReceiverWallet(receiverWallet)) return null;
  return {
    amount,
    sourceMint: sourceMint || USDC_MAINNET,
    targetMint: targetMint || WSOL_MAINNET,
    targetRail: rail,
    receiverLabel: receiverLabel || "recipient",
    receiverWallet,
    memo,
    confidence,
  };
}

function guessRailFromText(t: string): RemittanceRail {
  const s = t.toLowerCase();
  if (/\bjupiter|swap\b/.test(s)) return "JUPITER_SWAP";
  if (/\bsquad|escrow|multisig\b/.test(s)) return "SQUADS_ESCROW";
  return "SPL_TRANSFER";
}

function extractAmount(text: string): number | undefined {
  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,6})?)/);
  if (dollar?.[1]) return Number(dollar[1]);
  const usd = text.match(/\bUSD\s*([0-9]+(?:\.[0-9]{1,6})?)\b/i);
  if (usd?.[1]) return Number(usd[1]);
  const dollars = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*(?:usdc|dollars|bucks)\b/i);
  if (dollars?.[1]) return Number(dollars[1]);
  return undefined;
}

function extractReceiverLabel(text: string): string {
  const m = text.match(/\bto\s+(.+?)(?:\s+at|\s+wallet|\s+via|\s*$)/i);
  if (!m?.[1]) return "recipient";
  return m[1].trim().replace(/[.?!]+$/, "").slice(0, 120);
}

function parseDeterministic(userText: string): RemittanceIntent | null {
  const amount = extractAmount(userText);
  if (!amount || amount <= 0) return null;
  const receiverWallet = extractSolanaAddress(userText);
  if (!receiverWallet) return null;
  return {
    amount,
    sourceMint: USDC_MAINNET,
    targetMint: WSOL_MAINNET,
    targetRail: guessRailFromText(userText),
    receiverLabel: extractReceiverLabel(userText),
    receiverWallet,
    memo: undefined,
    confidence: 0.45,
  };
}

async function parseWithLlm(
  runtime: IAgentRuntime,
  userText: string
): Promise<RemittanceIntent | null> {
  try {
    const prompt = [
      "Extract a Solana USDC remittance intent from a Telegram user message.",
      "sourceMint and targetMint must be Solana SPL mint addresses (base58). Default sourceMint USDC:",
      USDC_MAINNET,
      "Default targetMint wrapped SOL:",
      WSOL_MAINNET,
      "",
      `User message: ${JSON.stringify(userText)}`,
      "",
      "Rules:",
      "- amount is the USDC amount to send (number).",
      "- receiverWallet must be a valid Solana address present in the message.",
      "- targetRail: SPL_TRANSFER for direct token transfer; JUPITER_SWAP to swap then send; SQUADS_ESCROW for escrow release flow.",
      "- confidence between 0 and 1.",
      "",
      "Return ONLY JSON matching the schema. No markdown.",
    ].join("\n");

    const raw = await runtime.useModel(ModelType.OBJECT_SMALL, {
      prompt,
      schema: LlmExtractJsonSchema,
    });
    const candidate =
      raw && typeof raw === "object" && "object" in raw ? (raw as { object: unknown }).object : raw;
    if (!candidate || typeof candidate !== "object") return null;
    return normalizeIntent(candidate as Record<string, unknown>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`intent-parser LLM call failed; may use fallback: ${msg}`);
    return null;
  }
}

export const parseRemittanceIntentAction: Action = {
  name: "PARSE_REMITTANCE_INTENT",
  similes: ["PARSE_INTENT", "REMITTANCE_INTENT", "SEND_MONEY_INTENT"],
  description:
    "Parses natural language into SendFlow intent: USDC amount, mints, Solana rail, receiver wallet.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message?.content?.text?.trim();
    if (!text || text.length < 3) return false;
    const roomId = message.roomId;
    const entityId = message.entityId;
    if (roomId && entityId) {
      const p = getPending(roomId, entityId);
      if (p && !isExpired(p)) return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const userText = message.content.text ?? "";
    if (callback) {
      await callback({
        text: "Parsing transfer intent…",
        actions: ["PARSE_REMITTANCE_INTENT"],
        source: message.content.source,
      });
    }

    const llmIntent = await parseWithLlm(runtime, userText);
    const fallback = parseDeterministic(userText);
    const intent =
      llmIntent && llmIntent.confidence >= 0.6 ? llmIntent : fallback ?? llmIntent;

    if (!intent) {
      return {
        success: false,
        text:
          'Could not parse a valid SendFlow request. Include amount in USDC and the receiver Solana wallet address. Example: "Send 100 USDC to Mom at <wallet>".',
      };
    }

    if (!isValidReceiverWallet(intent.receiverWallet)) {
      return {
        success: false,
        text:
          "That receiver wallet does not look like a valid Solana address. Please paste a valid Solana public key (base58).",
      };
    }

    return {
      success: true,
      text: "Intent parsed",
      data: { intent },
      values: {
        sendflow: {
          intent,
        },
      },
    };
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: `Send 100 USDC to my mom at 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`,
        },
      },
      {
        name: "{{agent}}",
        content: { text: "Parsing transfer intent…", actions: ["PARSE_REMITTANCE_INTENT"] },
      },
    ],
  ],
};
