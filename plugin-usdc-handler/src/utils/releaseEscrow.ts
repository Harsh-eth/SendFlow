import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

/** Refund or payout: move `amountHuman` USDC from escrow ATA to receiver (escrow signs). */
export async function releaseEscrow(params: {
  connection: Connection;
  escrowKeypair: Keypair;
  receiverPubkey: PublicKey;
  mint: PublicKey;
  amountHuman: number;
}): Promise<{ signature: string; explorerUrl: string }> {
  const { connection, escrowKeypair, receiverPubkey, mint, amountHuman } = params;
  const raw = BigInt(Math.round(amountHuman * 1_000_000));
  if (raw <= 0n) {
    throw new Error("amountHuman must be positive");
  }

  const escrowAta = await getAssociatedTokenAddress(mint, escrowKeypair.publicKey);
  const receiverAta = await getOrCreateAssociatedTokenAccount(
    connection,
    escrowKeypair,
    mint,
    receiverPubkey
  );

  const ix = createTransferInstruction(
    escrowAta,
    receiverAta.address,
    escrowKeypair.publicKey,
    raw
  );

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = escrowKeypair.publicKey;
  tx.sign(escrowKeypair);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    signature,
    explorerUrl: `https://solscan.io/tx/${signature}`,
  };
}
