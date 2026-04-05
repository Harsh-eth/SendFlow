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
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";

const MEMO_PROGRAM_V2 = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcEo");
import bs58 from "bs58";
import {
  shortWallet,
  solscanTxLink,
  type RemittanceIntent,
  priorityFeeIx,
  type SpeedMode,
  simulateAndVerifyCore,
  buildAllowedPrograms,
  assertSignatureNotReplay,
  recordSubmittedSignature,
  enqueueRpcRetry,
  type PendingRateSnapshot,
  isEligibleForSponsorship,
  recordSponsoredTx,
  log,
  isBlocklistedWallet,
  classifyTransferFailure,
} from "@sendflow/plugin-intent-parser";

function getStr(runtime: IAgentRuntime, key: string): string {
  const v = runtime.getSetting(key);
  return typeof v === "string" ? v : "";
}

const RETRIABLE_ERRORS = [
  "blockhash not found",
  "too many requests",
  "connection refused",
  "timeout",
  "429",
  "service unavailable",
  "timed out",
  "fetch failed",
  "econnreset",
];

function isRetriableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return RETRIABLE_ERRORS.some((e) => msg.includes(e));
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
  similes: ["LOCK_USDC", "ESCROW_LOCK", "CONFIRM_TRANSFER", "LOCK_FUNDS", "ESCROW_USDC"],
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
      speedMode?: SpeedMode;
    };
    const intent = sf?.intent as RemittanceIntent;
    const speed: SpeedMode = sf?.speedMode ?? "normal";
    const userId = String(message.entityId ?? "");

    const rpc = getStr(runtime, "SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
    const senderSecret = getStr(runtime, "SENDER_WALLET_PRIVATE_KEY");
    const escrowSecret = getStr(runtime, "SOLANA_ESCROW_WALLET_PRIVATE_KEY");
    const mintStr = getStr(runtime, "USDC_MINT") || intent.sourceMint;

    if (!senderSecret || !escrowSecret) {
      return {
        success: false,
        text:
          "❌ <b>USDC lock failed</b>\n\nConfigure <b>SENDER_WALLET_PRIVATE_KEY</b> and <b>SOLANA_ESCROW_WALLET_PRIVATE_KEY</b>.\n💡 Add both keys to your agent environment and restart.",
      };
    }

    const sender = loadKeypair(senderSecret);
    const escrow = loadKeypair(escrowSecret);
    if (!sender || !escrow) {
      return {
        success: false,
        text:
          "❌ <b>USDC lock failed</b>\n\nInvalid key material in environment.\n💡 Check that your private keys are valid base58 or JSON byte arrays.",
      };
    }

    const mint = new PublicKey(mintStr);
    const connection = new Connection(rpc, "confirmed");

    if (intent.receiverWallet && isBlocklistedWallet(intent.receiverWallet)) {
      const text =
        "❌ <b>Transfer blocked</b>\nThis wallet address has been flagged as unsafe.\n💡 Double-check the address and try again.";
      if (callback) {
        await callback({ text, actions: ["LOCK_USDC_ESCROW"], source: message.content.source });
      }
      return { success: false, text };
    }

    const raw = BigInt(Math.round(intent.amount * 1_000_000));

    try {
      const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);

      let senderBalance = 0;
      try {
        const balInfo = await connection.getTokenAccountBalance(senderAta);
        senderBalance = Number(balInfo.value.uiAmount ?? 0);
      } catch {
        senderBalance = 0;
      }
      if (senderBalance < intent.amount) {
        const text = `⚠️ <b>Insufficient USDC balance</b>\n\nYou have <b>${senderBalance.toFixed(2)} USDC</b> but tried to send <b>${intent.amount} USDC</b>.\n👛 <code>${shortWallet(sender.publicKey.toBase58())}</code>\n💡 Top up your wallet and try again.`;
        if (callback) {
          await callback({ text, actions: ["LOCK_USDC_ESCROW"], source: message.content.source });
        }
        return { success: false, text };
      }
      const escrowAta = await getOrCreateAssociatedTokenAccount(
        connection,
        sender,
        mint,
        escrow.publicKey
      );

      const ix = createTransferInstruction(senderAta, escrowAta.address, sender.publicKey, raw);

      const tx = new Transaction();
      const pFeeIx = priorityFeeIx(speed);
      if (pFeeIx) tx.add(pFeeIx);
      const memoStr = intent.memo?.trim();
      if (memoStr && memoStr.length > 0 && memoStr.length <= 566) {
        tx.add(
          new TransactionInstruction({
            keys: [],
            programId: MEMO_PROGRAM_V2,
            data: Buffer.from(memoStr, "utf8"),
          })
        );
      }
      tx.add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      const sponsorFee = Boolean(userId) && isEligibleForSponsorship(userId);
      tx.feePayer = sponsorFee ? escrow.publicKey : sender.publicKey;

      const simSigners = sponsorFee ? [sender, escrow] : [sender];
      if (sponsorFee) {
        tx.sign(sender, escrow);
      } else {
        tx.sign(sender);
      }

      const jup = getStr(runtime, "JUPITER_PROGRAM_ID");
      const allowed = buildAllowedPrograms(jup || undefined);
      const sim = await simulateAndVerifyCore(
        connection,
        tx,
        {
          userWallet: sender.publicKey.toBase58(),
          intendedAmountUsdc: intent.amount,
          intendedRecipient: escrow.publicKey.toBase58(),
          usdcMint: mintStr,
          mode: "transfer",
        },
        allowed
      );
      if (!sim.safe) {
        const txB64 = Buffer.from(tx.serialize()).toString("base64");
        log.error("lock_usdc.sim_verify_failed", { userId, reason: sim.reason, txB64: txB64.slice(0, 120) });
        const admin = getStr(runtime, "ADMIN_TELEGRAM_ID");
        const tok = getStr(runtime, "TELEGRAM_BOT_TOKEN");
        if (admin && tok) {
          await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: admin,
              text: `Transaction blocked (LOCK_USDC): ${sim.reason}\nuserId=${userId}\ntx: ${txB64.slice(0, 200)}…`,
            }),
          }).catch(() => {});
        }
        const text = `⚠️ <b>Security check failed</b>\n\n${sim.reason ?? "Transaction verification failed"}\n💡 If this persists, contact support.`;
        if (callback) {
          await callback({ text, actions: ["LOCK_USDC_ESCROW"], source: message.content.source });
        }
        return { success: false, text };
      }

      const s0 = tx.signatures[0];
      const sig58 =
        s0 && "signature" in s0 && s0.signature ? bs58.encode(s0.signature) : "";
      if (userId && sig58) {
        await assertSignatureNotReplay(userId, sig58);
      }

      const sfState = state?.values?.sendflow as {
        intent?: RemittanceIntent;
        rate?: PendingRateSnapshot;
        speedMode?: SpeedMode;
      } | undefined;
      const rateSnap = sfState?.rate;
      const uid = userId;
      const rid = String(message.roomId ?? "");
      const meta = message.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
      const tgChat = meta?.telegram?.chat?.id != null ? String(meta.telegram.chat.id) : undefined;

      let signature: string;
      try {
        signature = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (userId && sig58) {
          await recordSubmittedSignature(userId, sig58);
        }
        if (sponsorFee) {
          recordSponsoredTx(uid, 5000);
        }
      } catch (err) {
        if (isRetriableError(err)) {
          const queueId = enqueueRpcRetry(
            uid,
            rid,
            intent,
            speed,
            err instanceof Error ? err.message : String(err),
            rateSnap,
            tgChat
          );
          const c = classifyTransferFailure(err);
          const qtext = `⏳ <b>Transfer delayed</b>\n${c.userMessage}\n\n${c.suggestion}\nQueued (ID: <code>${queueId}</code>).\n💡 No funds left your wallet yet — we will retry automatically.`;
          if (callback) {
            await callback({ text: qtext, actions: ["LOCK_USDC_ESCROW"], source: message.content.source });
          }
          return { success: true, text: qtext, data: { queued: true, queueId } };
        }
        throw err;
      }

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
          text: `🔒 <b>USDC Locked</b>\n${solscanTxLink(signature)}`,
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
      const c = classifyTransferFailure(err);
      let friendly: string;
      if (/0x1\b|insufficient|not enough/i.test(msg)) {
        friendly = `⚠️ <b>Insufficient USDC balance</b>\n\nYour wallet doesn't have enough USDC for this transfer.\n💡 Top up your wallet and try again.`;
      } else if (/invalid.*public.*key|invalid.*address/i.test(msg)) {
        friendly = `⚠️ <b>Invalid wallet address</b>\n\nThe recipient wallet address is not a valid Solana address.\n💡 Double-check the address and try again.`;
      } else {
        friendly = [
          `❌ <b>Transfer failed</b>`,
          `Reason: ${c.userMessage}`,
          ``,
          `💡 ${c.suggestion}`,
          c.retryable ? `\n⏳ If this keeps happening, wait ${Math.ceil(c.retryDelayMs / 1000)}s and try again.` : "",
          ``,
          `<b>What happened?</b> Solana processes huge volume; sometimes txs need resubmission. Your funds stay in your wallet until a transfer confirms.`,
        ]
          .filter(Boolean)
          .join("\n");
      }
      return { success: false, text: friendly };
    }
  },
  examples: [],
};
