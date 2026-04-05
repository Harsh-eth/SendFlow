import { Connection, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { loggerCompat as logger } from "./structuredLogger";

export interface SimulationResult {
  success: boolean;
  error?: string;
  unitsConsumed?: number;
}

export async function simulateTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  signers?: Keypair[]
): Promise<SimulationResult> {
  try {
    let result;
    if (transaction instanceof VersionedTransaction) {
      result = await connection.simulateTransaction(transaction);
    } else {
      if (signers && signers.length > 0) {
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = signers[0].publicKey;
        transaction.sign(...signers);
      }
      result = await connection.simulateTransaction(transaction);
    }

    if (result.value.err) {
      const errStr = JSON.stringify(result.value.err);
      let friendly: string;
      if (/InsufficientFunds/i.test(errStr) || /0x1\b/.test(errStr)) {
        friendly = "Insufficient funds for this transaction";
      } else if (/AccountNotFound/i.test(errStr)) {
        friendly = "Token account not found — recipient may need to create one";
      } else {
        friendly = `Simulation error: ${errStr}`;
      }
      return { success: false, error: friendly, unitsConsumed: result.value.unitsConsumed ?? undefined };
    }

    return { success: true, unitsConsumed: result.value.unitsConsumed ?? undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Transaction simulation failed: ${msg}`);
    return { success: false, error: `Simulation failed: ${msg}` };
  }
}
