import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  simulateAndVerifyCore,
  simulateAndVerifyVersionedCore,
  buildAllowedPrograms,
  type SimResult,
  type SimulateVerifyMode,
} from "@sendflow/plugin-intent-parser";
import { getCustodialWallet } from "./custodialWallet";

const DEFAULT_JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const DEFAULT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getSimConnection(): Connection {
  const url =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.HELIUS_RPC_URL?.trim() ||
    "https://api.mainnet-beta.solana.com";
  return new Connection(url, "confirmed");
}

function jupiterId(): string {
  return process.env.JUPITER_PROGRAM_ID?.trim() || DEFAULT_JUPITER;
}

/**
 * Pre-sign simulation entry point (uses custodial wallet + env RPC + ALLOWED_PROGRAMS).
 * For signing paths prefer {@link signTransaction} / {@link signVersionedTransaction} on custodialWallet.
 */
export async function simulateAndVerify(
  userId: string,
  tx: Transaction,
  intendedAmountUsdc: number,
  intendedRecipient: string,
  mode: SimulateVerifyMode = "transfer"
): Promise<SimResult> {
  const cw = await getCustodialWallet(userId);
  if (!cw) {
    return { safe: false, reason: "no_wallet", actualTransfers: [] };
  }
  const usdcMint = process.env.USDC_MINT?.trim() || DEFAULT_USDC;
  const allowed = buildAllowedPrograms(jupiterId());
  return simulateAndVerifyCore(
    getSimConnection(),
    tx,
    {
      userWallet: cw.publicKey,
      intendedAmountUsdc,
      intendedRecipient,
      usdcMint,
      mode,
    },
    allowed
  );
}

export async function simulateAndVerifyVersioned(
  userId: string,
  tx: VersionedTransaction,
  intendedAmountUsdc: number,
  intendedRecipient: string,
  mode: SimulateVerifyMode = "swap"
): Promise<SimResult> {
  const cw = await getCustodialWallet(userId);
  if (!cw) {
    return { safe: false, reason: "no_wallet", actualTransfers: [] };
  }
  const usdcMint = process.env.USDC_MINT?.trim() || DEFAULT_USDC;
  const allowed = buildAllowedPrograms(jupiterId());
  return simulateAndVerifyVersionedCore(
    getSimConnection(),
    tx,
    {
      userWallet: cw.publicKey,
      intendedAmountUsdc,
      intendedRecipient,
      usdcMint,
      mode,
    },
    allowed
  );
}

export { buildAllowedPrograms };
export type { SimResult, SimulateVerifyMode } from "@sendflow/plugin-intent-parser";
