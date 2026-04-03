import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { releaseEscrow } from "@sendflow/plugin-usdc-handler";
import type { RemittanceIntent } from "@sendflow/plugin-intent-parser";
import { splTransferEscrowToReceiver } from "../rails/splTransfer";
import { jupiterSwapFromEscrow } from "../rails/jupiterSwap";
import { squadsEscrowRelease } from "../rails/squadsEscrow";

function getStr(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return typeof v === "string" ? v : "";
}

function loadKeypair(secret: string): Keypair | null {
  try {
    return Keypair.fromSecretKey(bs58.decode(secret.trim()));
  } catch {
    try {
      const json = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(json));
    } catch {
      return null;
    }
  }
}

export const routePayoutAction: Action = {
  name: "ROUTE_PAYOUT",
  similes: ["PAYOUT", "SEND_PAYOUT"],
  description: "Routes USDC or swapped tokens from escrow to the receiver via SPL, Jupiter, or Squads path.",
  validate: async (_runtime, _message, state?: State) => {
    const sf = state?.values?.sendflow as { intent?: RemittanceIntent; usdc?: { amountLocked?: number } } | undefined;
    return Boolean(sf?.intent?.receiverWallet && sf?.usdc?.amountLocked);
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
      usdc?: { amountLocked: number; txHash?: string };
    };
    const intent = sf?.intent as RemittanceIntent;
    const usdc = sf?.usdc;
    if (!usdc?.amountLocked) {
      return { success: false, text: "❌ Payout failed: missing escrow lock." };
    }

    const rpc = getStr(runtime, "SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const escrowSecret = getStr(runtime, "SOLANA_ESCROW_WALLET_PRIVATE_KEY");
    const senderSecret = getStr(runtime, "SENDER_WALLET_PRIVATE_KEY");
    const jupiterApi = getStr(runtime, "JUPITER_API_URL") || "https://quote-api.jup.ag/v6";

    const escrow = escrowSecret ? loadKeypair(escrowSecret) : null;
    if (!escrow) {
      return { success: false, text: "❌ Payout failed: escrow wallet not configured." };
    }

    const connection = new Connection(rpc, "confirmed");
    const mint = new PublicKey(intent.sourceMint);

    const refundSender = async () => {
      if (!senderSecret) return;
      const sender = loadKeypair(senderSecret);
      if (!sender) return;
      try {
        await releaseEscrow({
          connection,
          escrowKeypair: escrow,
          receiverPubkey: sender.publicKey,
          mint,
          amountHuman: usdc.amountLocked,
        });
      } catch {
        // logged upstream
      }
    };

    try {
      let outcome: { txHash: string; explorerUrl: string; payoutConfirmed: boolean };

      if (intent.targetRail === "JUPITER_SWAP") {
        const raw = BigInt(Math.round(usdc.amountLocked * 1_000_000));
        outcome = await jupiterSwapFromEscrow({
          connection,
          escrowKeypair: escrow,
          inputMint: intent.sourceMint,
          outputMint: intent.targetMint,
          amountRaw: raw,
          jupiterApiUrl: jupiterApi,
        });
      } else if (intent.targetRail === "SQUADS_ESCROW") {
        outcome = await squadsEscrowRelease({
          connection,
          escrowKeypair: escrow,
          receiverWallet: intent.receiverWallet,
          mint,
          amountHuman: usdc.amountLocked,
        });
      } else {
        outcome = await splTransferEscrowToReceiver({
          connection,
          escrowKeypair: escrow,
          receiverWallet: intent.receiverWallet,
          mint,
          amountHuman: usdc.amountLocked,
        });
      }

      const payout = {
        rail: intent.targetRail,
        destinationWallet: intent.receiverWallet,
        amountSent: usdc.amountLocked,
        mint: intent.sourceMint,
        txHash: outcome.txHash,
        payoutConfirmed: outcome.payoutConfirmed,
        explorerUrl: outcome.explorerUrl,
        completedAt: new Date().toISOString(),
      };

      if (callback) {
        await callback({
          text: `✅ Payout submitted: ${outcome.explorerUrl}`,
          actions: ["ROUTE_PAYOUT"],
          source: message.content.source,
        });
      }

      const prev = (state?.values?.sendflow as Record<string, unknown> | undefined) ?? {};
      return {
        success: true,
        text: "Payout routed",
        data: { payout },
        values: {
          sendflow: {
            ...prev,
            payout,
          },
        },
      };
    } catch (err) {
      await refundSender();
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        text: `❌ Payout failed; attempted refund to sender. ${msg}`,
      };
    }
  },
  examples: [],
};
