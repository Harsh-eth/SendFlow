import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { shortWallet } from "@sendflow/plugin-intent-parser";
import { loggerCompat as logger } from "./structuredLogger";

export interface ReceiptMetadata {
  sender: string;
  receiver: string;
  amount: number;
  token: string;
  txHash: string;
  timestamp: string;
  invoiceId?: string;
}

let receiptCounter = 0;

/**
 * Mints a proof-of-transfer receipt by storing metadata in a small memo
 * transaction on Solana (near-zero cost). This is a lightweight alternative
 * to full compressed NFTs that avoids requiring Metaplex/Bubblegum dependencies
 * while still creating on-chain proof.
 *
 * When MINT_RECEIPTS=true, this creates a memo transaction with the receipt data.
 */
export async function mintTransferReceipt(
  connection: Connection,
  payer: Keypair,
  metadata: ReceiptMetadata
): Promise<string | null> {
  try {
    receiptCounter += 1;
    const receiptId = `SF-${Date.now().toString(36).toUpperCase()}-${receiptCounter}`;

    const memoData = JSON.stringify({
      type: "sendflow_receipt",
      id: receiptId,
      from: shortWallet(metadata.sender),
      to: shortWallet(metadata.receiver),
      amount: metadata.amount,
      token: metadata.token,
      ref: metadata.txHash.slice(0, 16),
      ts: metadata.timestamp,
    });

    const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

    const tx = new Transaction().add({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoData, "utf8"),
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);

    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

    logger.info(`Receipt minted: ${receiptId} | tx: ${sig}`);
    return sig;
  } catch (err) {
    logger.warn(`Receipt mint failed (non-fatal): ${err}`);
    return null;
  }
}
