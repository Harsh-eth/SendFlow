import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  type RemittanceIntent,
  setPending,
  shortWallet,
  lookupToken,
  tokenEmoji,
  speedLabel,
  estimatedExtraFee,
  type SpeedMode,
  loggerCompat as logger,
  getSponsorshipMessage,
} from "@sendflow/plugin-intent-parser";
import type { SendflowRate } from "../types";
import {
  computeRecipientGets,
  fetchJupiterUsdPerToken,
  fetchPythUsdPerToken,
} from "../providers/fxProvider";

const FEE_BPS = 50;

function getEnv(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return typeof v === "string" ? v : "";
}

export const checkRemittanceRateAction: Action = {
  name: "CHECK_REMITTANCE_RATE",
  similes: ["CHECK_RATE", "FETCH_RATE", "GET_RATE", "QUOTE_RATE", "PRICE_CHECK"],
  description:
    "Fetches Jupiter and Pyth USD prices, picks the better deal for the user, sets sendflow.rate.",
  validate: async (_runtime: IAgentRuntime, _message: Memory, state?: State) => {
    const sf = state?.values?.sendflow as { intent?: RemittanceIntent } | undefined;
    const intent = sf?.intent;
    return Boolean(intent?.amount && intent?.sourceMint && intent?.targetMint);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const sf = state?.values?.sendflow as { intent?: RemittanceIntent; speedMode?: SpeedMode } | undefined;
    const intent = sf?.intent as RemittanceIntent;
    const speed: SpeedMode = (sf as any)?.speedMode ?? "normal";

    const isSameToken = intent.sourceMint === intent.targetMint;
    logger.info(`Rate check: sourceMint=${intent.sourceMint.slice(0,8)}… targetMint=${intent.targetMint.slice(0,8)}… sameToken=${isSameToken}`);
    if (isSameToken) {
      const sendflowFee = intent.amount * (FEE_BPS / 10_000);
      const recipientGets = intent.amount - sendflowFee;
      const rate: SendflowRate = {
        sourceMint: intent.sourceMint,
        targetMint: intent.targetMint,
        jupiterRate: 1,
        pythRate: 1,
        bestRate: 1,
        provider: "jupiter",
        recipientGets,
        sendflowFee,
        fetchedAt: new Date().toISOString(),
      };

      const tokenInfo = lookupToken(intent.sourceMint);
      const sym = tokenInfo?.symbol ?? "USDC";
      const em = tokenEmoji(sym);
      const speedLine = speed !== "normal" ? `\n${speedLabel(speed)} | Extra fee: ${estimatedExtraFee(speed)}` : "";
      const sponsorLine = message.entityId ? getSponsorshipMessage(String(message.entityId)) : "";

      const preview = `💱 <b>Transfer Preview</b>

${em} Sending: <b>${intent.amount} ${sym}</b>
👤 Recipient: <b>${intent.receiverLabel}</b>
📬 To: <code>${shortWallet(intent.receiverWallet)}</code>
💰 Fee: <b>${sendflowFee.toFixed(4)} ${sym}</b> (0.5%)
✨ They receive: <b>${recipientGets.toFixed(6)} ${sym}</b>
⛓ Network: Solana Mainnet${speedLine}${sponsorLine}

Reply <b>YES</b> to confirm or <b>NO</b> to cancel ⏱ 60s`;

      const roomId = message.roomId;
      const entityId = message.entityId;
      if (roomId && entityId) {
        setPending(roomId, entityId, {
          intent,
          rate: { ...rate },
          expiresAt: Date.now() + 60_000,
          initiatorEntityId: entityId as string,
        });
      }

      if (callback) {
        await callback({
          text: preview,
          actions: ["CHECK_REMITTANCE_RATE"],
          source: message.content.source,
        });
      }

      const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
      return {
        success: true,
        text: preview,
        data: { rate },
        values: { sendflow: { ...prev, rate } },
      };
    }

    const jupiterBase =
      getEnv(runtime, "JUPITER_PRICE_API_URL") || "https://api.jup.ag/price/v2";
    const pythBase = getEnv(runtime, "PYTH_PRICE_SERVICE_URL") || "https://hermes.pyth.network";
    const pythFeedSource = getEnv(runtime, "PYTH_FEED_ID_SOURCE");
    const pythFeedTarget = getEnv(runtime, "PYTH_FEED_ID_TARGET");

    let sourceJup: number | null = null;
    let targetJup: number | null = null;
    let sourcePyth: number | null = null;
    let targetPyth: number | null = null;

    try {
      [sourceJup, targetJup] = await Promise.all([
        fetchJupiterUsdPerToken(intent.sourceMint, jupiterBase),
        fetchJupiterUsdPerToken(intent.targetMint, jupiterBase),
      ]);
    } catch {
      sourceJup = null;
      targetJup = null;
    }

    try {
      if (pythFeedSource) {
        sourcePyth = await fetchPythUsdPerToken(pythFeedSource, pythBase);
      }
      if (pythFeedTarget) {
        targetPyth = await fetchPythUsdPerToken(pythFeedTarget, pythBase);
      }
    } catch {
      sourcePyth = sourcePyth ?? null;
      targetPyth = targetPyth ?? null;
    }

    const jupiterRecipient =
      sourceJup != null && targetJup != null
        ? computeRecipientGets({
            amountSourceHuman: intent.amount,
            sourceUsd: sourceJup,
            targetUsd: targetJup,
            feeBps: FEE_BPS,
          })
        : null;

    const pythRecipient =
      sourcePyth != null && targetPyth != null
        ? computeRecipientGets({
            amountSourceHuman: intent.amount,
            sourceUsd: sourcePyth,
            targetUsd: targetPyth,
            feeBps: FEE_BPS,
          })
        : null;

    if (jupiterRecipient == null && pythRecipient == null) {
      return {
        success: false,
        text: "⚠️ Rate unavailable\n\nCould not fetch a price from Jupiter or Pyth for this token pair. Please check the token mints and try again in a moment.",
      };
    }

    const usePyth =
      pythRecipient != null &&
      (jupiterRecipient == null || pythRecipient > jupiterRecipient);

    const sourceUsd = usePyth ? sourcePyth! : sourceJup!;
    const targetUsd = usePyth ? targetPyth! : targetJup!;
    const recipientGets = usePyth ? pythRecipient! : jupiterRecipient!;
    const jupiterRate =
      sourceJup != null && targetJup != null && targetJup > 0 ? targetJup / sourceJup : 0;
    const pythRate =
      sourcePyth != null && targetPyth != null && targetPyth > 0 ? targetPyth / sourcePyth : 0;
    const bestRate = targetUsd / sourceUsd;
    const sendflowFee = intent.amount * (FEE_BPS / 10_000);

    const rate: SendflowRate = {
      sourceMint: intent.sourceMint,
      targetMint: intent.targetMint,
      jupiterRate,
      pythRate,
      bestRate,
      provider: usePyth ? "pyth" : "jupiter",
      recipientGets,
      sendflowFee,
      fetchedAt: new Date().toISOString(),
    };

    const targetTokenInfo = lookupToken(intent.targetMint);
    const targetSym = targetTokenInfo?.symbol ?? shortWallet(intent.targetMint);
    const targetEm = targetTokenInfo ? tokenEmoji(targetSym) : "🪙";
    const speedLine2 = speed !== "normal" ? `\n${speedLabel(speed)} | Extra fee: ${estimatedExtraFee(speed)}` : "";
    const sponsorLine2 = message.entityId ? getSponsorshipMessage(String(message.entityId)) : "";

    const preview = `💱 <b>Swap Preview</b>

💵 Sending: <b>${intent.amount} USDC</b>
👤 Recipient: <b>${intent.receiverLabel}</b>
📬 To: <code>${shortWallet(intent.receiverWallet)}</code>
${targetEm} Swaps to: <b>${targetSym}</b>
📊 Rate: <b>1 USDC = ${bestRate.toFixed(6)} ${targetSym}</b> (via <b>${rate.provider}</b>)
💰 Fee: <b>${sendflowFee.toFixed(4)} USDC</b> (0.5%)
✨ They receive: <b>${recipientGets.toFixed(6)} ${targetSym}</b>
⛓ Network: Solana Mainnet${speedLine2}${sponsorLine2}

Reply <b>YES</b> to confirm or <b>NO</b> to cancel ⏱ 60s`;

    const roomId = message.roomId;
    const entityId = message.entityId;
    if (roomId && entityId) {
      setPending(roomId, entityId, {
        intent,
        rate: {
          sourceMint: rate.sourceMint,
          targetMint: rate.targetMint,
          jupiterRate: rate.jupiterRate,
          pythRate: rate.pythRate,
          bestRate: rate.bestRate,
          provider: rate.provider,
          recipientGets: rate.recipientGets,
          sendflowFee: rate.sendflowFee,
          fetchedAt: rate.fetchedAt,
        },
        expiresAt: Date.now() + 60_000,
        initiatorEntityId: entityId as string,
      });
    }

    if (callback) {
      await callback({
        text: preview,
        actions: ["CHECK_REMITTANCE_RATE"],
        source: message.content.source,
      });
    }

    const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
    return {
      success: true,
      text: preview,
      data: { rate },
      values: {
        sendflow: {
          ...prev,
          rate,
        },
      },
    };
  },
  examples: [],
};
