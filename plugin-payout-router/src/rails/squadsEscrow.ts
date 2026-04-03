import { PublicKey } from "@solana/web3.js";
import { releaseEscrow } from "@sendflow/plugin-usdc-handler";
import type { Connection, Keypair } from "@solana/web3.js";

/**
 * Production: integrate Squads multisig vault (SQUADS_PROGRAM_ID) for policy-gated release.
 * This build uses the same SPL release path as the escrow hot wallet for atomic tests.
 */
export async function squadsEscrowRelease(params: {
  connection: Connection;
  escrowKeypair: Keypair;
  receiverWallet: string;
  mint: PublicKey;
  amountHuman: number;
}): Promise<{ txHash: string; explorerUrl: string; payoutConfirmed: boolean }> {
  const receiver = new PublicKey(params.receiverWallet);
  const { signature, explorerUrl } = await releaseEscrow({
    connection: params.connection,
    escrowKeypair: params.escrowKeypair,
    receiverPubkey: receiver,
    mint: params.mint,
    amountHuman: params.amountHuman,
  });
  return { txHash: signature, explorerUrl, payoutConfirmed: true };
}
