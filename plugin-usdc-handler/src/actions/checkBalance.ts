import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import bs58 from "bs58";
import { shortWallet, solscanAddrLink } from "@sendflow/plugin-intent-parser";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

export const checkBalanceAction: Action = {
  name: "CHECK_BALANCE",
  similes: ["BALANCE", "MY_BALANCE", "WALLET_BALANCE", "USDC_BALANCE", "CHECK_WALLET"],
  description: "Shows the sender's USDC and SOL balance on Solana.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:balance|how\s*much|my\s*wallet|my\s*usdc|funds)\b/.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const rpc = getStr(runtime, "SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const senderSecret = getStr(runtime, "SENDER_WALLET_PRIVATE_KEY");

    if (!senderSecret) {
      const text =
        "⚠️ <b>Wallet not configured</b>\n\n<b>SENDER_WALLET_PRIVATE_KEY</b> is not set.\n💡 Configure your wallet to check balance.";
      if (callback) {
        await callback({ text, actions: ["CHECK_BALANCE"], source: message.content.source });
      }
      return { success: false, text };
    }

    const sender = loadKeypair(senderSecret);
    if (!sender) {
      const text =
        "⚠️ <b>Invalid wallet key</b>\n\nCould not load your wallet.\n💡 Check <b>SENDER_WALLET_PRIVATE_KEY</b> in your environment.";
      if (callback) {
        await callback({ text, actions: ["CHECK_BALANCE"], source: message.content.source });
      }
      return { success: false, text };
    }

    const connection = new Connection(rpc, "confirmed");
    const mint = new PublicKey(USDC_MAINNET);

    try {
      const [solBalance, usdcAta] = await Promise.all([
        connection.getBalance(sender.publicKey),
        getAssociatedTokenAddress(mint, sender.publicKey),
      ]);

      let usdcBalance = 0;
      try {
        const tokenInfo = await connection.getTokenAccountBalance(usdcAta);
        usdcBalance = Number(tokenInfo.value.uiAmount ?? 0);
      } catch {
        usdcBalance = 0;
      }

      const solHuman = (solBalance / 1_000_000_000).toFixed(4);
      const walletAddr = sender.publicKey.toBase58();

      const text = [
        `💰 <b>Your SendFlow Wallet</b>`,
        ``,
        `💵 USDC Balance: <b>${usdcBalance.toFixed(2)} USDC</b>`,
        `◎ SOL Balance: <b>${solHuman} SOL</b> (for fees)`,
        `👛 Wallet: <code>${shortWallet(walletAddr)}</code>`,
        `🔗 ${solscanAddrLink(walletAddr, "View on Solscan")}`,
        ``,
        `⚡ Powered by SendFlow on Nosana`,
      ].join("\n");

      if (callback) {
        await callback({ text, actions: ["CHECK_BALANCE"], source: message.content.source });
      }
      return { success: true, text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /timeout|timed?\s*out/i.test(msg)
        ? "⚠️ <b>Network timeout</b>\n\nCouldn't reach the Solana RPC.\n💡 Please try again in a moment."
        : `❌ <b>Could not fetch balance</b>\n\n<code>${msg}</code>\n💡 Check your RPC URL and try again.`;
      if (callback) {
        await callback({ text: friendly, actions: ["CHECK_BALANCE"], source: message.content.source });
      }
      return { success: false, text: friendly };
    }
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "balance" } },
      { name: "{{agent}}", content: { text: "💰 Wallet Balance...", actions: ["CHECK_BALANCE"] } },
    ],
  ],
};
