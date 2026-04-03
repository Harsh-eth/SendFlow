import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";

function getStr(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return typeof v === "string" ? v : "";
}

function loadKeypair(secret: string): Keypair | null {
  try {
    const raw = bs58.decode(secret.trim());
    return Keypair.fromSecretKey(raw);
  } catch {
    try {
      const json = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(json));
    } catch {
      return null;
    }
  }
}

export const lockUsdcEscrowAction: Action = {
  name: "LOCK_USDC_ESCROW",
  similes: ["LOCK_USDC", "ESCROW_LOCK"],
  description:
    "Locks USDC from sender ATA into escrow ATA on Solana (confirmed), records sendflow.usdc.",
  validate: async (_runtime: IAgentRuntime, _message: Memory, state?: State) => {
    const sf = state?.values?.sendflow as { intent?: RemittanceIntent; flow?: { confirmed?: boolean } } | undefined;
    return Boolean(sf?.intent?.amount && sf?.flow?.confirmed === true);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const sf = state?.values?.sendflow as {
      intent?: RemittanceIntent;
      usdc?: unknown;
    };
    const intent = sf?.intent as RemittanceIntent;

    const rpc = getStr(runtime, "SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const senderSecret = getStr(runtime, "SENDER_WALLET_PRIVATE_KEY");
    const escrowSecret = getStr(runtime, "SOLANA_ESCROW_WALLET_PRIVATE_KEY");
    const mintStr = getStr(runtime, "USDC_MINT") || intent.sourceMint;

    if (!senderSecret || !escrowSecret) {
      return {
        success: false,
        text: "❌ USDC lock failed. Configure SENDER_WALLET_PRIVATE_KEY and SOLANA_ESCROW_WALLET_PRIVATE_KEY.",
      };
    }

    const sender = loadKeypair(senderSecret);
    const escrow = loadKeypair(escrowSecret);
    if (!sender || !escrow) {
      return {
        success: false,
        text: "❌ USDC lock failed. Invalid key material in environment.",
      };
    }

    const mint = new PublicKey(mintStr);
    const connection = new Connection(rpc, "confirmed");

    const raw = BigInt(Math.round(intent.amount * 1_000_000));

    try {
      const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);
      const escrowAta = await getOrCreateAssociatedTokenAccount(
        connection,
        sender,
        mint,
        escrow.publicKey
      );

      const ix = createTransferInstruction(senderAta, escrowAta.address, sender.publicKey, raw);

      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

      const explorerUrl = `https://solscan.io/tx/${signature}`;
      const usdc = {
        txHash: signature,
        amountLocked: intent.amount,
        escrowWallet: escrow.publicKey.toBase58(),
        confirmedAt: new Date().toISOString(),
        explorerUrl,
      };

      if (callback) {
        await callback({
          text: `🔒 USDC locked: ${explorerUrl}`,
          actions: ["LOCK_USDC_ESCROW"],
          source: message.content.source,
        });
      }

      const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
      return {
        success: true,
        text: "USDC locked in escrow",
        data: { usdc },
        values: {
          sendflow: {
            ...prev,
            usdc,
          },
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        text: `❌ USDC lock failed. Check your wallet balance and try again. (${msg})`,
      };
    }
  },
  examples: [],
};
