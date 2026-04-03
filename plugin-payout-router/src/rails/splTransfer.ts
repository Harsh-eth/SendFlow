import { PublicKey } from "@solana/web3.js";
import { releaseEscrow } from "@sendflow/plugin-usdc-handler";
import type { Connection, Keypair } from "@solana/web3.js";

export async function splTransferEscrowToReceiver(params: {
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
