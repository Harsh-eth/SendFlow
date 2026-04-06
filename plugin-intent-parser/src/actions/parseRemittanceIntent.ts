import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  type JSONSchema,
  Memory,
  ModelType,
  State,
} from "@elizaos/core";
import type { RemittanceIntent, RemittanceRail } from "../types";
import { loggerCompat as logger } from "../utils/structuredLogger";
import {
  getPending,
  isExpired,
  isProcessing,
  getLastRequestTime,
  setLastRequestTime,
} from "../pendingFlow";
import { extractSolanaAddress, isValidReceiverWallet } from "../utils/solanaAddress";
import { resolveSolDomain, extractSolDomain } from "../utils/resolveDomain";
import { getContact } from "../utils/contactBook";
import { lookupToken, TOKEN_REGISTRY, tokenEmoji } from "../utils/tokenRegistry";
import { detectSpeedMode, speedLabel, estimatedExtraFee, type SpeedMode } from "../utils/priorityFee";
import { resolveUsername } from "../utils/sendflowId";
import { tryExtractPhoneRemittance } from "../utils/phoneRemittance";
import { lookupLinkedWalletForPhone } from "../utils/phoneWalletLinks";
import { TRANSFER_LIMITS } from "../utils/transferLimits";

const RATE_LIMIT_MS = 10_000;

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

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/** Exported: tries AMOUNT_PATTERNS + word-to-number for messy user input. */
export function extractAmountFromText(text: string): number | null {
  const e = extractAmount(text);
  if (e?.amount && e.amount > 0) return e.amount;
  const lower = text.toLowerCase();
  const payWord = lower.match(/\b(?:pay|send|transfer)\s+([a-z]+)\s+to\b/);
  if (payWord?.[1] && WORD_NUMBERS[payWord[1]] != null) return WORD_NUMBERS[payWord[1]];
  const tw = lower.match(/\b(twenty|thirty|forty|fifty|ten|five)\b/);
  if (tw?.[1] && WORD_NUMBERS[tw[1]] != null) return WORD_NUMBERS[tw[1]];
  return null;
}

function extractAmount(text: string): { amount: number; token?: string } | undefined {
  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,6})?)/);
  if (dollar?.[1]) return { amount: Number(dollar[1]), token: "USDC" };
  const usd = text.match(/\bUSD\s*([0-9]+(?:\.[0-9]{1,6})?)\b/i);
  if (usd?.[1]) return { amount: Number(usd[1]), token: "USDC" };

  const stp = text.match(/\b(?:send|transfer|pay)\s+(\d+(?:\.\d+)?)\b/i);
  if (stp?.[1]) return { amount: Number(stp[1]), token: "USDC" };

  const tokenSymbols = Object.keys(TOKEN_REGISTRY).join("|");
  const tokenAmountRegex = new RegExp(`\\b([0-9]+(?:\\.[0-9]{1,9})?)\\s*(${tokenSymbols}|dollars|bucks)\\b`, "i");
  const tokenMatch = text.match(tokenAmountRegex);
  if (tokenMatch?.[1]) {
    const sym = tokenMatch[2].toUpperCase();
    if (sym === "DOLLARS" || sym === "BUCKS") return { amount: Number(tokenMatch[1]), token: "USDC" };
    return { amount: Number(tokenMatch[1]), token: sym };
  }

  const usdcAlt = text.match(/\b(\d+(?:\.\d+)?)\s*(usdc|usd)\b/i);
  if (usdcAlt?.[1]) return { amount: Number(usdcAlt[1]), token: "USDC" };

  const dollarWorthRegex = new RegExp(`\\$([0-9]+(?:\\.[0-9]{1,6})?)\\s+(?:worth\\s+of\\s+|of\\s+)(${tokenSymbols})`, "i");
  const worthMatch = text.match(dollarWorthRegex);
  if (worthMatch?.[1]) return { amount: Number(worthMatch[1]), token: worthMatch[2].toUpperCase() };

  const lower = text.toLowerCase();
  for (const [w, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${w}\\b`).test(lower)) return { amount: n, token: "USDC" };
  }

  return undefined;
}

function extractReceiverLabel(text: string): string {
  const m = text.match(/\bto\s+(.+?)(?:\s+at|\s+wallet|\s+via|\s*$)/i);
  if (!m?.[1]) return "recipient";
  return m[1].trim().replace(/[.?!]+$/, "").slice(0, 120);
}

function wantsNonUsdcTarget(text: string): string | null {
  const s = text.toLowerCase();
  if (/\b(?:swap|convert|exchange)\b/.test(s)) return WSOL_MAINNET;
  if (/\b(?:in\s+sol|to\s+sol|as\s+sol|sol\b.*?instead)\b/.test(s)) return WSOL_MAINNET;
  if (/\bsol\b/.test(s) && !/\bsol(?:ana|scan)\b/.test(s)) return WSOL_MAINNET;
  return null;
}

function parseDeterministic(
  userText: string,
  entityId?: string
): (RemittanceIntent & { speedMode?: SpeedMode }) | null {
  const extracted = extractAmount(userText);
  if (!extracted || extracted.amount <= 0) return null;
  const { amount, token: detectedToken } = extracted;
  let receiverWallet = extractSolanaAddress(userText);
  const solDomain = extractSolDomain(userText);
  const sendflowM = userText.match(/\bsendflow\/([a-zA-Z0-9_]{3,20})\b/i);
  const sendflowProfile = sendflowM ? resolveUsername(sendflowM[1]) : null;
  let contactLabel: string | undefined;
  if (!receiverWallet && !solDomain && !sendflowProfile?.walletAddress && entityId) {
    const at = userText.match(/@([a-zA-Z0-9_]{3,32})\b/);
    if (at?.[1]) {
      const p = resolveUsername(at[1]);
      if (p?.walletAddress) receiverWallet = p.walletAddress;
    }
    if (!receiverWallet) {
      const toNamed = userText.match(/\bto\s+([A-Za-z][A-Za-z0-9_]{0,39})\b/i);
      const payNamed = userText.match(/\b(?:pay|send)\s+(?:[a-z]+\s+)?to\s+([A-Za-z][A-Za-z0-9_]{0,39})\b/i);
      const name = (toNamed?.[1] ?? payNamed?.[1])?.trim();
      if (name && !/\.sol$/i.test(name)) {
        const cw = getContact(entityId, name);
        if (cw) {
          receiverWallet = cw;
          contactLabel = name;
        }
      }
    }
  }
  const receiver = receiverWallet ?? solDomain ?? sendflowProfile?.walletAddress;
  if (!receiver) return null;

  const speed = detectSpeedMode(userText);

  const tokenInfo = detectedToken ? lookupToken(detectedToken) : null;

  const sendflowLabel = sendflowM ? `sendflow/${sendflowM[1].toLowerCase()}` : undefined;
  const receiverLabelBase = contactLabel ?? sendflowLabel ?? solDomain ?? extractReceiverLabel(userText);

  if (tokenInfo && tokenInfo.symbol !== "USDC") {
    return {
      amount,
      sourceMint: USDC_MAINNET,
      targetMint: tokenInfo.mint,
      targetRail: "JUPITER_SWAP" as RemittanceRail,
      receiverLabel: receiverLabelBase,
      receiverWallet: receiver,
      memo: undefined,
      confidence: 0.45,
      speedMode: speed,
    };
  }

  const nonUsdcTarget = wantsNonUsdcTarget(userText);
  const targetMint = nonUsdcTarget ?? USDC_MAINNET;
  const targetRail = nonUsdcTarget ? "JUPITER_SWAP" as RemittanceRail : guessRailFromText(userText);
  return {
    amount,
    sourceMint: USDC_MAINNET,
    targetMint,
    targetRail,
    receiverLabel: receiverLabelBase,
    receiverWallet: receiver,
    memo: undefined,
    confidence: 0.45,
    speedMode: speed,
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
  similes: ["PARSE_INTENT", "REMITTANCE_INTENT", "SEND_MONEY_INTENT", "SEND_USDC", "TRANSFER_USDC", "REMIT", "SEND_MONEY", "TRANSFER_MONEY"],
  description:
    "Parses natural language into SendFlow intent: USDC amount, mints, Solana rail, receiver wallet.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = message?.content?.text?.trim();
    if (!text) return false;
    const entityId = message.entityId as string | undefined;
    if (entityId && isProcessing(entityId)) return false;
    const roomId = message.roomId;
    if (roomId && entityId) {
      const p = getPending(roomId, entityId);
      if (p && !isExpired(p)) return false;
    }

    const lower = text.toLowerCase();
    if (/\b(?:split|each\s+to|equally\s+between|equally\s+among)\b/.test(lower)) return false;

    if (/\bbuy\b/.test(lower) && /\busdc\b/.test(lower) && !/\b(?:send|transfer|pay)\b/.test(lower)) {
      return false;
    }

    const amount = extractAmountFromText(text);
    if (amount == null || amount <= 0) return false;

    if (extractSolanaAddress(text)) return true;
    if (extractSolDomain(text)) return true;

    const sendflowM = text.match(/\bsendflow\/([a-zA-Z0-9_]{3,20})\b/i);
    if (sendflowM?.[1] && resolveUsername(sendflowM[1])?.walletAddress) return true;

    const at = text.match(/@([a-zA-Z0-9_]{3,32})\b/);
    if (at?.[1] && resolveUsername(at[1])?.walletAddress) return true;

    if (tryExtractPhoneRemittance(text)) return true;

    if (/\bto\s+(?:my\s+)?(?:friend|friends|buddy|buddies|someone|anyone|them|him|her|there)\b/i.test(lower)) {
      return false;
    }

    if (entityId) {
      const toNamed = text.match(/\bto\s+([A-Za-z][A-Za-z0-9_]{0,39})\b/i);
      const payNamed = text.match(/\b(?:pay|send)\s+(?:[a-z]+\s+)?to\s+([A-Za-z][A-Za-z0-9_]{0,39})\b/i);
      let name = (toNamed?.[1] ?? payNamed?.[1])?.trim();
      if (name && /^(my|a|the|our|your)$/i.test(name)) {
        const ext = text.match(/\bto\s+(?:my|a|the|our|your)\s+([A-Za-z][A-Za-z0-9_]{0,39})\b/i);
        name = ext?.[1]?.trim();
      }
      if (name && !/^(friend|friends|buddy|someone)$/i.test(name) && !/\.sol$/i.test(name)) {
        if (getContact(entityId, name)) return true;
      }
    }

    return false;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;

    const elapsed = Date.now() - getLastRequestTime(entityId);
    if (elapsed < RATE_LIMIT_MS) {
      const wait = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
      const text = `⏱ <b>Please wait ${wait}s</b> before sending another request.`;
      if (callback) {
        await callback({ text, actions: ["PARSE_REMITTANCE_INTENT"], source: message.content.source });
      }
      return { success: false, text };
    }
    setLastRequestTime(entityId);

    const userText = message.content.text ?? "";
    if (callback) {
      await callback({
        text: "Parsing transfer intent…",
        actions: ["PARSE_REMITTANCE_INTENT"],
        source: message.content.source,
      });
    }

    const phoneRm = tryExtractPhoneRemittance(userText);
    if (phoneRm) {
      const linked = lookupLinkedWalletForPhone(phoneRm.normalizedPhone);
      if (linked) {
        const mint = runtime.getSetting("USDC_MINT") || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
        const intent: RemittanceIntent = {
          amount: phoneRm.amount,
          sourceMint: typeof mint === "string" ? mint : String(mint),
          targetMint: typeof mint === "string" ? mint : String(mint),
          targetRail: "SPL_TRANSFER",
          receiverLabel: `📱 ${phoneRm.normalizedPhone}`,
          receiverWallet: linked,
          confidence: 1,
        };
        return {
          success: true,
          text: "phone_linked_wallet_intent",
          values: { sendflow: { intent } },
        };
      }
      return {
        success: true,
        text: "phone_claim_intent",
        values: {
          sendflow: {
            phoneClaim: {
              normalizedPhone: phoneRm.normalizedPhone,
              amount: phoneRm.amount,
            },
          },
        },
      };
    }

    const llmIntent = await parseWithLlm(runtime, userText);
    const fallback = parseDeterministic(userText, entityId);
    const intent =
      llmIntent && llmIntent.confidence >= 0.6 ? llmIntent : fallback ?? llmIntent;

    const speedMode = (fallback as any)?.speedMode ?? detectSpeedMode(userText);

    if (!intent) {
      return {
        success: false,
        text: [
          `⚠️ <b>Couldn't parse your request</b>`,
          ``,
          `<b>Please include:</b>`,
          `• Amount in USDC (e.g. 10 USDC)`,
          `• Recipient Solana wallet address`,
          ``,
          `Example: "Send 100 USDC to 7xKX...sAsU"`,
        ].join("\n"),
      };
    }

    function applySendflowResolution(rintent: RemittanceIntent): { ok: true } | { ok: false; text: string } {
      const w = rintent.receiverWallet.trim();
      const wl = w.toLowerCase();
      if (wl.startsWith("sendflow/")) {
        const uname = wl.slice("sendflow/".length);
        const profile = resolveUsername(uname);
        if (!profile) {
          return { ok: false, text: `⚠️ <b>sendflow/${uname}</b> not found. Ask them to claim a username first.` };
        }
        rintent.receiverWallet = profile.walletAddress;
        rintent.receiverLabel = `sendflow/${uname}`;
        return { ok: true };
      }
      const lab = rintent.receiverLabel.trim().toLowerCase();
      if (lab.startsWith("sendflow/")) {
        const uname = lab.slice("sendflow/".length);
        const profile = resolveUsername(uname);
        if (!profile) {
          return { ok: false, text: `⚠️ <b>sendflow/${uname}</b> not found.` };
        }
        rintent.receiverWallet = profile.walletAddress;
        rintent.receiverLabel = `sendflow/${uname}`;
        return { ok: true };
      }
      return { ok: true };
    }

    const sfRes = applySendflowResolution(intent);
    if (!sfRes.ok) {
      return { success: false, text: sfRes.text };
    }

    if (!isValidReceiverWallet(intent.receiverWallet)) {
      const contactWallet = getContact(entityId, intent.receiverLabel) ?? getContact(entityId, intent.receiverWallet);
      if (contactWallet) {
        logger.info(`Resolved contact "${intent.receiverLabel}" → ${contactWallet}`);
        intent.receiverWallet = contactWallet;
      }
    }

    if (intent.receiverWallet.endsWith(".sol")) {
      const rpcUrl = (() => {
        const v = runtime.getSetting("SOLANA_RPC_URL");
        return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
      })();
      try {
        intent.receiverWallet = await resolveSolDomain(intent.receiverWallet, rpcUrl);
        logger.info(`Resolved ${intent.receiverLabel} → ${intent.receiverWallet}`);
      } catch {
        return {
          success: false,
          text: `⚠️ <b>Could not resolve</b> ${intent.receiverLabel ?? intent.receiverWallet}\n\nPlease check the .sol domain or use a wallet address directly.`,
        };
      }
    }

    if (!isValidReceiverWallet(intent.receiverWallet)) {
      return {
        success: false,
        text: `⚠️ <b>Invalid wallet address</b>\n\nThe address "${intent.receiverWallet.slice(0, 8)}…" is not a valid Solana public key. Please paste a valid base58 address.`,
      };
    }

    const minRaw = runtime.getSetting("MIN_TRANSFER_USDC");
    const maxRaw = runtime.getSetting("MAX_TRANSFER_USDC");
    const minTransfer =
      typeof minRaw === "string" && minRaw ? Number(minRaw) : TRANSFER_LIMITS.MIN_USDC;
    const maxTransfer =
      typeof maxRaw === "string" && maxRaw ? Number(maxRaw) : TRANSFER_LIMITS.MAX_USDC;

    if (intent.amount < minTransfer) {
      return {
        success: false,
        text: `⚠️ <b>Amount too small</b>\n\nMinimum transfer is ${minTransfer} USDC. You requested ${intent.amount} USDC.`,
      };
    }
    if (intent.amount > maxTransfer) {
      return {
        success: false,
        text: `⚠️ <b>Amount too large</b>\n\nMaximum transfer is ${maxTransfer} USDC. You requested ${intent.amount} USDC.`,
      };
    }

    return {
      success: true,
      text: "Intent parsed",
      data: { intent },
      values: {
        sendflow: {
          intent,
          speedMode,
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
