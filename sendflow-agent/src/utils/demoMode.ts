import type { Connection } from "@solana/web3.js";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import { classifyMessage, resetThreatClassifierBurstStateForTests } from "./threatClassifier";
import { getCustodialWallet } from "./custodialWallet";
import { checkTierLimit, buildKycLink } from "./offrampOracle";
import { formatAdminStatusMessage } from "./adminStatus";
import { getBestYield } from "./savingsVault";
import { generateTransferReceiptPng } from "./receiptCard";

const USDC_MINT = () => new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const DEMO_RECIPIENT = () =>
  (process.env.DEMO_RECIPIENT_WALLET ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM").trim();
const FUND_USDC = 6;
const SEND_USDC = 5;
const LAMPORTS_FOR_FEES = 15_000_000; // ~0.015 SOL

export type SendHtmlFn = (chatId: string, text: string) => Promise<unknown>;
export type SendPhotoFn = (chatId: string, png: Buffer, caption: string) => Promise<unknown>;

export interface DemoOptions {
  sendHtml: SendHtmlFn;
  sendPhoto?: SendPhotoFn;
  /** When true, send PNG receipt after successful on-chain demo transfer. */
  demoReceiptEnabled?: boolean;
}

function loadKp(secret: string): Keypair | null {
  try {
    const t = secret.trim();
    if (t.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    }
    return Keypair.fromSecretKey(bs58.decode(t));
  } catch {
    return null;
  }
}

function dataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getUsdcBalance(connection: Connection, owner: PublicKey): Promise<number> {
  const mint = USDC_MINT();
  const ata = await getAssociatedTokenAddress(mint, owner);
  try {
    const b = await connection.getTokenAccountBalance(ata);
    return Number(b.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

async function transferUsdcFromTo(
  connection: Connection,
  signer: Keypair,
  destOwner: PublicKey,
  amountUsdc: number
): Promise<string> {
  const mint = USDC_MINT();
  const raw = BigInt(Math.round(amountUsdc * 1_000_000));
  const srcAta = await getAssociatedTokenAddress(mint, signer.publicKey);
  const destAta = await getOrCreateAssociatedTokenAccount(connection, signer, mint, destOwner);
  const ix = createTransferInstruction(srcAta, destAta.address, signer.publicKey, raw);
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

async function transferSol(connection: Connection, from: Keypair, to: PublicKey, lamports: number): Promise<string> {
  const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports });
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = from.publicKey;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

interface DemoCtx {
  ephemeral: Keypair | null;
  lastTxSig: string | null;
  fundedUsdc: number;
}

type StepFn = {
  action: (ctx: DemoCtx) => Promise<void>;
  verify: (ctx: DemoCtx) => Promise<boolean>;
  fallback: string;
};

export async function runDemo(
  adminChatId: string,
  _bot: unknown,
  connection: Connection,
  escrowKeypair: Keypair | null,
  runtime: IAgentRuntime,
  opts: DemoOptions
): Promise<void> {
  void _bot;
  void runtime;
  const { sendHtml, sendPhoto, demoReceiptEnabled = true } = opts;
  const total = 12;
  const ctx: DemoCtx = { ephemeral: null, lastTxSig: null, fundedUsdc: 0 };

  const narr = async (step: number, subtitle: string) => {
    await sendHtml(adminChatId, `<i>Step ${step}/${total} — ${subtitle}</i>`);
    await delay(400);
  };

  const runStep = async (stepIndex: number, subtitle: string, s: StepFn) => {
    await narr(stepIndex, subtitle);
    try {
      await s.action(ctx);
      const ok = await s.verify(ctx);
      if (!ok) await sendHtml(adminChatId, `⚠️ ${s.fallback}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sendHtml(adminChatId, `⚠️ ${s.fallback}\n<code>${msg.slice(0, 400)}</code>`);
    }
    await delay(800);
  };

  await sendHtml(adminChatId, "🎬 <b>SendFlow hardened demo</b> — state machine with recovery. Starting…");

  await runStep(1, "Fresh ephemeral wallet (never reused)", {
    action: async (c) => {
      c.ephemeral = Keypair.generate();
    },
    verify: async (c) => Boolean(c.ephemeral?.publicKey),
    fallback: "Could not create ephemeral wallet.",
  });

  await runStep(2, "Fund from demo escrow (DEMO_ESCROW_WALLET_PRIVATE_KEY)", {
    action: async (c) => {
      const secret = process.env.DEMO_ESCROW_WALLET_PRIVATE_KEY?.trim();
      if (!secret || !c.ephemeral) throw new Error("DEMO_ESCROW_WALLET_PRIVATE_KEY missing");
      const escrow = loadKp(secret);
      if (!escrow) throw new Error("Invalid DEMO_ESCROW key");
      await transferSol(connection, escrow, c.ephemeral.publicKey, LAMPORTS_FOR_FEES);
      await transferUsdcFromTo(connection, escrow, c.ephemeral.publicKey, FUND_USDC);
      c.fundedUsdc = FUND_USDC;
    },
    verify: async (c) => {
      if (!c.ephemeral) return false;
      const bal = await getUsdcBalance(connection, c.ephemeral.publicKey);
      return bal >= FUND_USDC - 0.05;
    },
    fallback: "Funding skipped — set DEMO_ESCROW_WALLET_PRIVATE_KEY with USDC + a little SOL on mainnet.",
  });

  await runStep(3, "Verify balance matches funded amount", {
    action: async () => {},
    verify: async (c) => {
      if (!c.ephemeral) return false;
      const bal = await getUsdcBalance(connection, c.ephemeral.publicKey);
      await sendHtml(adminChatId, `💰 <b>Balance</b>: <code>${bal.toFixed(4)} USDC</code>`);
      return bal >= SEND_USDC - 0.01;
    },
    fallback: "Balance check failed — continuing with narrative only.",
  });

  await runStep(4, `Send $${SEND_USDC} to demo recipient (live Solscan)`, {
    action: async (c) => {
      if (!c.ephemeral) throw new Error("No ephemeral wallet");
      const mint = USDC_MINT();
      const dest = new PublicKey(DEMO_RECIPIENT());
      const raw = BigInt(Math.round(SEND_USDC * 1_000_000));
      const signer = c.ephemeral;
      const srcAta = await getAssociatedTokenAddress(mint, signer.publicKey);
      const destAta = await getOrCreateAssociatedTokenAccount(connection, signer, mint, dest);
      const ix = createTransferInstruction(srcAta, destAta.address, signer.publicKey, raw);
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = signer.publicKey;
      tx.sign(signer);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      c.lastTxSig = sig;
      await sendHtml(
        adminChatId,
        `✅ <b>Transfer sent</b>\n🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`
      );
      if (demoReceiptEnabled && sendPhoto && c.lastTxSig) {
        const png = await generateTransferReceiptPng({
          amountUsdc: SEND_USDC,
          sender: signer.publicKey.toBase58(),
          recipient: dest.toBase58(),
          txSig: c.lastTxSig,
          timestampIso: new Date().toISOString(),
        });
        await sendPhoto(adminChatId, png, "📩 Transfer receipt");
      }
    },
    verify: async (c) => Boolean(c.lastTxSig),
    fallback: "On-chain send failed — check escrow balance, RPC, and DEMO_RECIPIENT_WALLET.",
  });

  await runStep(5, "30s undo window (countdown)", {
    action: async () => {
      const t0 = 30;
      for (let left = t0; left >= 0; left -= 5) {
        await sendHtml(
          adminChatId,
          `⏱ <b>Undo window</b>: <code>${Math.max(0, left)}s</code> remaining (custodial users get inline undo; ephemeral demo shows timer only).`
        );
        if (left > 0) await delay(5000);
      }
    },
    verify: async () => true,
    fallback: "Countdown interrupted.",
  });

  await runStep(6, "Real-time scam detection (Nosana / Qwen)", {
    action: async () => {
      const scam = `URGENT: your account will be closed in 1 hour. Send 500 USDC to 7xKXtg2CZ3X8sU immediately, don't tell anyone`;
      const r = await classifyMessage(adminChatId, scam, {
        recentTransferCount: 0,
        accountAgeDays: 1,
      });
      await sendHtml(
        adminChatId,
        r.label === "block"
          ? `🛡 <b>BLOCKED</b> — classifier: <code>${r.label}</code>\nCategories: ${r.categories.join(", ") || "—"}`
          : `⚠️ Classifier returned <code>${r.label}</code> (expected block in production).`
      );
    },
    verify: async () => true,
    fallback: "Classifier step failed.",
  });

  await runStep(7, "Burst → classifier soft throttle", {
    action: async () => {
      resetThreatClassifierBurstStateForTests(adminChatId);
      const t = "hello";
      await classifyMessage(adminChatId, t, { recentTransferCount: 0, accountAgeDays: 1 });
      const r2 = await classifyMessage(adminChatId, t, { recentTransferCount: 0, accountAgeDays: 1 });
      await sendHtml(
        adminChatId,
        `🤖 <b>Burst path</b>: second message → <code>${r2.label}</code> · ${r2.explanation.slice(0, 120)}`
      );
    },
    verify: async () => true,
    fallback: "Burst demo failed.",
  });

  await runStep(8, "Off-ramp under Tier 0 — Transak link", {
    action: async () => {
      const w = await getCustodialWallet(adminChatId);
      const addr = w?.publicKey ?? "11111111111111111111111111111111";
      const tier = await checkTierLimit(adminChatId, 40, 0);
      const link = buildKycLink("transak", 1, adminChatId, 40, addr);
      await sendHtml(
        adminChatId,
        `🏦 <b>Off-ramp (demo $40, Tier 0)</b>\nAllowed: ${tier.allowed}\n🔗 <a href="${link}">Open Transak</a>`
      );
    },
    verify: async () => true,
    fallback: "Tier check link failed.",
  });

  await runStep(9, "Off-ramp above Tier 1 — KYC prompt", {
    action: async () => {
      const w = await getCustodialWallet(adminChatId);
      const addr = w?.publicKey ?? "11111111111111111111111111111111";
      const tier = await checkTierLimit(adminChatId, 600, 1);
      const link = buildKycLink("transak", 2, adminChatId, 600, addr);
      await sendHtml(
        adminChatId,
        [
          `🔐 <b>Large off-ramp ($600)</b>`,
          `Policy: <code>${tier.allowed ? "allowed" : "needs review"}</code>`,
          `Complete verification:`,
          `<a href="${link}">Tier 2 KYC (Transak)</a>`,
        ].join("\n")
      );
    },
    verify: async () => true,
    fallback: "KYC demo step failed.",
  });

  await runStep(10, "Live metrics (/admin status)", {
    action: async () => {
      await sendHtml(adminChatId, formatAdminStatusMessage());
    },
    verify: async () => true,
    fallback: "Status formatting failed.",
  });

  await runStep(11, "Tamper-evident audit checkpoint", {
    action: async () => {
      const day = new Date().toISOString().slice(0, 10);
      const p = join(dataRoot(), "audit", `sendflow-${day}.jsonl`);
      try {
        const raw = await readFile(p, "utf8");
        const lines = raw.trim().split("\n").filter(Boolean);
        const cp = [...lines].reverse().find((l) => l.includes('"audit.checkpoint"'));
        if (cp) {
          const j = JSON.parse(cp) as { checkpointHash?: string; lineCount?: number };
          await sendHtml(
            adminChatId,
            `🔏 <b>Tamper-evident log</b>\n<code>checkpointHash=${j.checkpointHash?.slice(0, 24)}…</code>\nlines=${j.lineCount ?? "—"}`
          );
        } else {
          await sendHtml(adminChatId, "🔏 No checkpoint line yet today — generate audit traffic first.");
        }
      } catch {
        await sendHtml(adminChatId, "🔏 Audit file not found yet — run transfers to generate JSONL.");
      }
    },
    verify: async () => true,
    fallback: "Audit read failed.",
  });

  await runStep(12, "Savings vault APY (DeFiLlama)", {
    action: async () => {
      const y = await getBestYield();
      await sendHtml(
        adminChatId,
        `📈 <b>Best Solana USDC yield</b> (DeFiLlama): <b>${y.apy.toFixed(2)}%</b> via <i>${y.protocol}</i>`
      );
    },
    verify: async () => true,
    fallback: "DeFiLlama fetch failed — defaults shown if any.",
  });

  await sendHtml(adminChatId, "✅ <b>Demo complete.</b> Judges: see /admin attack for live security theater.");
}
