import { Connection, VersionedTransaction } from "@solana/web3.js";
import { loggerCompat as logger } from "./structuredLogger";
import { getFirstSignatureBase58, signVersionedTransaction } from "./custodialWallet";
import { assertSignatureNotReplay, recordSubmittedSignature } from "@sendflow/plugin-intent-parser";
import {
  applySwapMevShield,
  clampSwapSlippageForStable,
  confirmTransactionWithTimeout,
  isRpcCircuitOpen,
  RPC_CIRCUIT_USER_MESSAGE,
  rpcSendWithQuorum,
  versionedTxWithFreshBlockhash,
} from "./rpcManager";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface SwapQuoteResult {
  outputAmount: number;
  priceImpact: number;
  route: string;
  inAmountRaw: string;
  outAmountRaw: string;
}

export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amountHuman: number,
  inputDecimals: number,
  slippageBps: number
): Promise<SwapQuoteResult | null> {
  const amountRaw = BigInt(Math.round(amountHuman * 10 ** inputDecimals));
  try {
    const qs = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountRaw.toString(),
      slippageBps: String(slippageBps),
    });
    const res = await fetch(`https://quote-api.jup.ag/v6/quote?${qs}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      outAmount?: string;
      priceImpactPct?: number;
      routePlan?: { swapInfo?: { label?: string } }[];
    };
    const out = data.outAmount ? Number(data.outAmount) : 0;
    const route = data.routePlan?.map((r) => r.swapInfo?.label).filter(Boolean).join(" → ") || "Jupiter";
    return {
      outputAmount: out,
      priceImpact: Number(data.priceImpactPct ?? 0),
      route,
      inAmountRaw: amountRaw.toString(),
      outAmountRaw: data.outAmount ?? "0",
    };
  } catch (e) {
    logger.warn(`getSwapQuote failed: ${e}`);
    return null;
  }
}

export async function executeSwap(
  userId: string,
  inputMint: string,
  outputMint: string,
  amountHuman: number,
  inputDecimals: number,
  slippageBps: number,
  connection: Connection
): Promise<string | null> {
  const { getCustodialWallet } = await import("./custodialWallet");
  const cw = await getCustodialWallet(userId);
  if (!cw) return null;

  if (isRpcCircuitOpen()) {
    logger.warn(`Swap blocked: ${RPC_CIRCUIT_USER_MESSAGE}`);
    return null;
  }

  const amountRaw = BigInt(Math.round(amountHuman * 10 ** inputDecimals));
  const slip = clampSwapSlippageForStable(inputMint, outputMint, slippageBps);
  try {
    const qs = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amountRaw.toString(),
      slippageBps: String(slip),
    });
    const quoteRes = await fetch(`https://quote-api.jup.ag/v6/quote?${qs}`, { signal: AbortSignal.timeout(15_000) });
    if (!quoteRes.ok) return null;
    const quoteJson = (await quoteRes.json()) as Record<string, unknown>;
    const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quoteJson,
        userPublicKey: cw.publicKey,
        wrapAndUnwrapSol: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!swapRes.ok) return null;
    const { swapTransaction } = (await swapRes.json()) as { swapTransaction?: string };
    if (!swapTransaction) return null;
    let vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    vtx = await applySwapMevShield(vtx, userId, connection);
    const fresh = await versionedTxWithFreshBlockhash(vtx, connection);
    vtx = fresh.tx;
    const signed = await signVersionedTransaction(userId, vtx, {
      connection,
      intendedAmountUsdc: amountHuman,
      intendedRecipient: cw.publicKey,
      mode: "swap",
    });
    const sig58 = getFirstSignatureBase58(signed);
    await assertSignatureNotReplay(userId, sig58);
    const sig = await rpcSendWithQuorum(Buffer.from(signed.serialize()));
    const conf = await confirmTransactionWithTimeout(sig, fresh.blockhash, fresh.lastValidBlockHeight, connection);
    if (!conf.ok) {
      logger.warn(`Swap confirm: ${conf.userMessage}`);
    }
    await recordSubmittedSignature(userId, sig58);
    return sig;
  } catch (e) {
    logger.warn(`executeSwap failed: ${e}`);
    return null;
  }
}

export { USDC_MAINNET, SOL_MINT };
