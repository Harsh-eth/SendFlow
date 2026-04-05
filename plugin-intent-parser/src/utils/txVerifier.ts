import { ComputeBudgetProgram, Connection, PublicKey, Transaction } from "@solana/web3.js";

export {
  simulateAndVerifyCore,
  simulateAndVerifyVersionedCore,
  buildAllowedPrograms,
  parseSplTransfers,
  type TokenTransfer,
  type SimResult,
  type SimulateAndVerifyParams,
  type SimulateVerifyMode,
  type RawTokenTransfer,
} from "./simulationVerify";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_TRANSFER_IX = 3;

const ALLOWED_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
]);

export interface VerifyTxParams {
  expectedAmountHuman: number;
  /** Destination token account (base58) that must receive the transfer */
  expectedDestination: string;
  mintDecimals: number;
}

function humanToRaw(amount: number, decimals: number): bigint {
  const factor = 10 ** decimals;
  return BigInt(Math.round(amount * factor));
}

/**
 * Verifies SPL token transfer amount/destination and blockhash validity.
 * Allows only Compute Budget + Token program instructions.
 */
export async function verifyTransactionIntegrity(
  connection: Connection,
  params: VerifyTxParams,
  transaction: Transaction
): Promise<{ valid: boolean; reason?: string }> {
  const { expectedAmountHuman, expectedDestination, mintDecimals } = params;
  const expectedDestPk = new PublicKey(expectedDestination);
  const expectedRaw = humanToRaw(expectedAmountHuman, mintDecimals);

  if (!transaction.recentBlockhash) {
    return { valid: false, reason: "Transaction missing recent blockhash" };
  }

  try {
    const { value: bhValid } = await connection.isBlockhashValid(transaction.recentBlockhash);
    if (!bhValid) {
      return { valid: false, reason: "Blockhash expired — transaction no longer valid" };
    }
  } catch {
    return { valid: false, reason: "Could not verify blockhash with RPC" };
  }

  const ixs = transaction.instructions;
  if (ixs.length === 0 || ixs.length > 8) {
    return { valid: false, reason: "Unexpected instruction count" };
  }

  let foundTransfer = false;

  for (const ix of ixs) {
    const pid = ix.programId.toBase58();
    if (!ALLOWED_PROGRAMS.has(pid)) {
      return { valid: false, reason: `Disallowed program in transaction: ${pid}` };
    }

    if (pid === TOKEN_PROGRAM_ID.toBase58()) {
      if (ix.data.length < 9) {
        return { valid: false, reason: "Invalid token instruction data" };
      }
      const tag = ix.data[0];
      if (tag !== TOKEN_TRANSFER_IX) {
        return { valid: false, reason: `Unexpected SPL token instruction (${tag})` };
      }
      const amt = ix.data.readBigUInt64LE(1);
      if (amt !== expectedRaw) {
        return { valid: false, reason: `Amount mismatch: expected ${expectedRaw} raw, got ${amt}` };
      }
      if (ix.keys.length < 2) {
        return { valid: false, reason: "Token transfer missing accounts" };
      }
      const dest = ix.keys[1]?.pubkey;
      if (!dest || !dest.equals(expectedDestPk)) {
        return { valid: false, reason: "Recipient token account mismatch (possible substitution attack)" };
      }
      foundTransfer = true;
    }
  }

  if (!foundTransfer) {
    return { valid: false, reason: "No token transfer instruction found" };
  }

  return { valid: true };
}
