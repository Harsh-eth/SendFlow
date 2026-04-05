import { Keypair, PublicKey, Transaction, Connection, VersionedTransaction } from "@solana/web3.js";
import { sign as ed25519Sign } from "@solana/web3.js/src/utils/ed25519.js";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import {
  getMasterKey,
  encryptPrivateKey,
  decryptPrivateKeyBytes,
  decryptPrivateKeyBytesV2,
  decryptLegacyCbc,
  computeWalletMac,
  verifyWalletMac,
  zeroize,
} from "./encryption";
import { loggerCompat as logger, log } from "./structuredLogger";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
  simulateAndVerifyCore,
  simulateAndVerifyVersionedCore,
  buildAllowedPrograms,
  type SimulateVerifyMode,
} from "@sendflow/plugin-intent-parser";
import { notifyAdminBlockedTx } from "./txSecurityNotify";
import { assertSignatureNotReplay, recordSubmittedSignature } from "@sendflow/plugin-intent-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function getWalletDir(): string {
  return join(getDataRoot(), "wallets");
}

/** Ensure <data>/wallets exists before any wallet read/write. */
export async function ensureWalletDataDir(): Promise<void> {
  await mkdir(getWalletDir(), { recursive: true });
}

const DEFAULT_JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export interface SignTxVerify {
  connection: Connection;
  intendedAmountUsdc: number;
  /** Recipient wallet (base58); USDC must land in this wallet's ATA for the mint */
  intendedRecipient: string;
  mode?: SimulateVerifyMode;
}

export interface CustodialWallet {
  userId: string;
  publicKey: string;
  encryptedPrivateKey: string;
  createdAt: string;
  balance?: number;
  /** 1 = legacy AES-CBC; 2 = per-user AES-GCM HMAC-only; 3 = PBKDF2 + GCM */
  KEY_VERSION?: number;
  /** HMAC-SHA256(master, ciphertext hex) — integrity */
  mac?: string;
}

const walletCache = new Map<string, CustodialWallet>();

function legacyKeyBuffer(): Buffer {
  const key = getMasterKey();
  if (key.length >= 64 && /^[0-9a-fA-F]+$/i.test(key)) {
    return Buffer.from(key.slice(0, 64), "hex");
  }
  return Buffer.from(key.slice(0, 32).padEnd(32, "0"));
}

function walletPath(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getWalletDir(), `${safeId}.json`);
}

async function persistWallet(wallet: CustodialWallet): Promise<void> {
  try {
    const master = getMasterKey();
    wallet.mac = computeWalletMac(wallet.encryptedPrivateKey, master);
    await mkdir(getWalletDir(), { recursive: true });
    await writeFile(walletPath(wallet.userId), JSON.stringify(wallet, null, 2), "utf8");
  } catch (err) {
    logger.warn(`Failed to persist wallet for ${wallet.userId}: ${err}`);
  }
}

async function secretKeyToWallet(secret: Uint8Array, userId: string): Promise<CustodialWallet> {
  const kp = Keypair.fromSecretKey(secret);
  const master = getMasterKey();
  const encryptedPrivateKey = await encryptPrivateKey(kp.secretKey, userId, master);
  try {
    kp.secretKey.fill(0);
  } catch {
    /* ignore */
  }
  return {
    userId,
    publicKey: kp.publicKey.toBase58(),
    encryptedPrivateKey,
    createdAt: new Date().toISOString(),
    KEY_VERSION: 3,
  };
}

export async function createCustodialWallet(userId: string): Promise<CustodialWallet> {
  const existing = await getCustodialWallet(userId);
  if (existing) return existing;

  const keypair = Keypair.generate();
  try {
    const wallet = await secretKeyToWallet(keypair.secretKey, userId);
    walletCache.set(userId, wallet);
    await persistWallet(wallet);
    logger.info(`Custodial wallet created for ${userId}: ${wallet.publicKey}`);
    return wallet;
  } finally {
    try {
      keypair.secretKey.fill(0);
    } catch {
      /* ignore */
    }
  }
}

export async function migrateWalletIfNeeded(wallet: CustodialWallet): Promise<CustodialWallet> {
  const parts = wallet.encryptedPrivateKey.split(":");
  if (wallet.KEY_VERSION === 3 && parts.length === 3) {
    return wallet;
  }
  if (parts.length === 3 && (wallet.KEY_VERSION === 2 || wallet.KEY_VERSION === undefined)) {
    const master = getMasterKey();
    let secretBuf: Buffer | null = null;
    try {
      if (wallet.KEY_VERSION === 2) {
        secretBuf = decryptPrivateKeyBytesV2(wallet.encryptedPrivateKey, wallet.userId, master);
      } else {
        try {
          secretBuf = decryptPrivateKeyBytesV2(wallet.encryptedPrivateKey, wallet.userId, master);
        } catch {
          secretBuf = await decryptPrivateKeyBytes(wallet.encryptedPrivateKey, wallet.userId, master);
        }
      }
      const next = await secretKeyToWallet(secretBuf, wallet.userId);
      next.createdAt = wallet.createdAt;
      walletCache.set(wallet.userId, next);
      await persistWallet(next);
      logger.info(`Migrated wallet ${wallet.userId} to KEY_VERSION=3 (PBKDF2)`);
      return next;
    } finally {
      if (secretBuf) zeroize(secretBuf);
    }
  }
  try {
    const legacyStr = decryptLegacyCbc(wallet.encryptedPrivateKey, legacyKeyBuffer());
    const secret = bs58.decode(legacyStr);
    const next = await secretKeyToWallet(secret, wallet.userId);
    next.createdAt = wallet.createdAt;
    walletCache.set(wallet.userId, next);
    await persistWallet(next);
    logger.info(`Migrated wallet ${wallet.userId} from legacy CBC to KEY_VERSION=3`);
    return next;
  } catch (e) {
    logger.warn(`Wallet migration failed for ${wallet.userId}: ${e}`);
    return wallet;
  }
}

/** Decrypt to buffer; caller MUST zeroize() the buffer after use. */
async function decryptSecretKeyBuffer(wallet: CustodialWallet): Promise<Buffer> {
  const master = getMasterKey();
  if (wallet.KEY_VERSION === 3 && wallet.encryptedPrivateKey.split(":").length === 3) {
    return decryptPrivateKeyBytes(wallet.encryptedPrivateKey, wallet.userId, master);
  }
  if (wallet.KEY_VERSION === 2 && wallet.encryptedPrivateKey.split(":").length === 3) {
    return Promise.resolve(decryptPrivateKeyBytesV2(wallet.encryptedPrivateKey, wallet.userId, master));
  }
  const legacyStr = decryptLegacyCbc(wallet.encryptedPrivateKey, legacyKeyBuffer());
  const decoded = bs58.decode(legacyStr);
  return Buffer.from(decoded);
}

async function withInternalKeypair<T>(wallet: CustodialWallet, fn: (kp: Keypair) => Promise<T> | T): Promise<T> {
  const w = await migrateWalletIfNeeded(wallet);
  const bytes = await decryptSecretKeyBuffer(w);
  let kp: Keypair | null = null;
  try {
    kp = Keypair.fromSecretKey(bytes);
    return await fn(kp);
  } finally {
    zeroize(bytes);
    try {
      if (kp) kp.secretKey.fill(0);
    } catch {
      /* ignore */
    }
  }
}

export async function signTransaction(userId: string, tx: Transaction, verify: SignTxVerify): Promise<Transaction> {
  const wallet = await getCustodialWallet(userId);
  if (!wallet) throw new Error("No custodial wallet found");
  const usdcMint = process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const allowed = buildAllowedPrograms(process.env.JUPITER_PROGRAM_ID?.trim() || DEFAULT_JUPITER);
  await withInternalKeypair(wallet, async (kp) => {
    tx.partialSign(kp);
    const sim = await simulateAndVerifyCore(
      verify.connection,
      tx,
      {
        userWallet: wallet.publicKey,
        intendedAmountUsdc: verify.intendedAmountUsdc,
        intendedRecipient: verify.intendedRecipient,
        usdcMint,
        mode: verify.mode ?? "transfer",
      },
      allowed
    );
    if (!sim.safe) {
      const raw = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
      await notifyAdminBlockedTx({ userId, reason: sim.reason, txBase64: raw });
      throw new Error(`Transaction blocked: ${sim.reason ?? "unknown"}`);
    }
  });
  return tx;
}

export async function signMessage(userId: string, message: Uint8Array): Promise<Uint8Array> {
  const wallet = await getCustodialWallet(userId);
  if (!wallet) throw new Error("No custodial wallet found");
  return withInternalKeypair(wallet, (kp) => Promise.resolve(ed25519Sign(message, kp.secretKey)));
}

export async function signVersionedTransaction(
  userId: string,
  tx: VersionedTransaction,
  verify: SignTxVerify
): Promise<VersionedTransaction> {
  const wallet = await getCustodialWallet(userId);
  if (!wallet) throw new Error("No custodial wallet found");
  const usdcMint = process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const allowed = buildAllowedPrograms(process.env.JUPITER_PROGRAM_ID?.trim() || DEFAULT_JUPITER);
  await withInternalKeypair(wallet, async (kp) => {
    tx.sign([kp]);
    const sim = await simulateAndVerifyVersionedCore(
      verify.connection,
      tx,
      {
        userWallet: wallet.publicKey,
        intendedAmountUsdc: verify.intendedAmountUsdc,
        intendedRecipient: verify.intendedRecipient,
        usdcMint,
        mode: verify.mode ?? "swap",
      },
      allowed
    );
    if (!sim.safe) {
      const raw = Buffer.from(tx.serialize()).toString("base64");
      await notifyAdminBlockedTx({ userId, reason: sim.reason, txBase64: raw });
      throw new Error(`Transaction blocked: ${sim.reason ?? "unknown"}`);
    }
  });
  return tx;
}

/** First signed signature (base58), for replay checks before broadcast. */
export function getFirstSignatureBase58(tx: Transaction | VersionedTransaction): string {
  const first = tx.signatures[0];
  if (!first) throw new Error("Missing transaction signature");
  if (first instanceof Uint8Array) return bs58.encode(first);
  const buf = (first as { signature?: Uint8Array | null }).signature;
  if (!buf) throw new Error("Missing signature bytes");
  return bs58.encode(buf);
}

/**
 * One-shot base58 secret for backup UX only. Prefer never storing the return value longer than needed to send.
 */
export async function exportPrivateKeyBase58OneShot(userId: string): Promise<string> {
  const wallet = await getCustodialWallet(userId);
  if (!wallet) throw new Error("No custodial wallet");
  const bytes = await decryptSecretKeyBuffer(await migrateWalletIfNeeded(wallet));
  try {
    return bs58.encode(bytes);
  } finally {
    zeroize(bytes);
  }
}

/** Recipient-initiated rollback USDC leg — signing stays inside this module. */
export async function executeRollbackRecipientTransfer(
  connection: Connection,
  recipientUserId: string,
  senderWalletAddress: string,
  amountUsdc: number
): Promise<string> {
  const recvWallet = await getCustodialWallet(recipientUserId);
  if (!recvWallet) throw new Error("Recipient wallet not found");
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const raw = BigInt(Math.round(amountUsdc * 1_000_000));
  const sendPk = new PublicKey(senderWalletAddress);
  const rw = await migrateWalletIfNeeded(recvWallet);
  const allowed = buildAllowedPrograms(process.env.JUPITER_PROGRAM_ID?.trim() || DEFAULT_JUPITER);
  const usdcMintStr = mint.toBase58();
  return withInternalKeypair(rw, async (recvKp) => {
    const recvAta = await getAssociatedTokenAddress(mint, recvKp.publicKey);
    const sendAta = await getOrCreateAssociatedTokenAccount(connection, recvKp, mint, sendPk);
    const ix = createTransferInstruction(recvAta, sendAta.address, recvKp.publicKey, raw);
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = recvKp.publicKey;
    tx.sign(recvKp);
    const sim = await simulateAndVerifyCore(
      connection,
      tx,
      {
        userWallet: recvKp.publicKey.toBase58(),
        intendedAmountUsdc: amountUsdc,
        intendedRecipient: senderWalletAddress,
        usdcMint: usdcMintStr,
        mode: "transfer",
      },
      allowed
    );
    if (!sim.safe) {
      const txB64 = Buffer.from(tx.serialize()).toString("base64");
      await notifyAdminBlockedTx({ userId: recipientUserId, reason: sim.reason, txBase64: txB64 });
      throw new Error(`Transaction blocked: ${sim.reason ?? "unknown"}`);
    }
    const sig = getFirstSignatureBase58(tx);
    await assertSignatureNotReplay(recipientUserId, sig);
    const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
    await recordSubmittedSignature(recipientUserId, sig);
    return txid;
  });
}

function loadEscrowKeypairFromEnv(): Keypair | null {
  const s = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
    } catch {
      return null;
    }
  }
}

/** Move USDC from user's custodial wallet into the escrow ATA (P2P sell offers). */
export async function transferCustodialUsdcToEscrow(
  userId: string,
  connection: Connection,
  amountHuman: number
): Promise<string> {
  const escrowKp = loadEscrowKeypairFromEnv();
  if (!escrowKp) throw new Error("SOLANA_ESCROW_WALLET_PRIVATE_KEY not configured");
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const usdcMintStr = mint.toBase58();
  const raw = BigInt(Math.round(amountHuman * 1_000_000));
  if (raw <= 0n) throw new Error("Amount must be positive");
  const wallet = await getCustodialWallet(userId);
  if (!wallet) throw new Error("No custodial wallet");
  const rw = await migrateWalletIfNeeded(wallet);
  const allowed = buildAllowedPrograms(process.env.JUPITER_PROGRAM_ID?.trim() || DEFAULT_JUPITER);
  return withInternalKeypair(rw, async (userKp) => {
    const userAta = await getAssociatedTokenAddress(mint, userKp.publicKey);
    const escrowAta = await getOrCreateAssociatedTokenAccount(connection, userKp, mint, escrowKp.publicKey);
    const ix = createTransferInstruction(userAta, escrowAta.address, userKp.publicKey, raw);
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = userKp.publicKey;
    tx.sign(userKp);
    const sim = await simulateAndVerifyCore(
      connection,
      tx,
      {
        userWallet: userKp.publicKey.toBase58(),
        intendedAmountUsdc: amountHuman,
        intendedRecipient: escrowKp.publicKey.toBase58(),
        usdcMint: usdcMintStr,
        mode: "transfer",
      },
      allowed
    );
    if (!sim.safe) {
      const txB64 = Buffer.from(tx.serialize()).toString("base64");
      await notifyAdminBlockedTx({ userId, reason: sim.reason, txBase64: txB64 });
      throw new Error(`Transaction blocked: ${sim.reason ?? "unknown"}`);
    }
    const sig58 = getFirstSignatureBase58(tx);
    await assertSignatureNotReplay(userId, sig58);
    const txid = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
    await recordSubmittedSignature(userId, sig58);
    return txid;
  });
}

export async function findUserIdByWalletAddress(address: string): Promise<string | null> {
  try {
    const dir = getWalletDir();
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf8");
        const w = JSON.parse(raw) as CustodialWallet;
        if (w.publicKey === address) return w.userId;
      } catch {
        /* skip corrupt */
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function getCustodialWallet(userId: string): Promise<CustodialWallet | null> {
  const cached = walletCache.get(userId);
  if (cached) {
    return migrateWalletIfNeeded(cached);
  }

  try {
    const raw = await readFile(walletPath(userId), "utf8");
    const wallet = JSON.parse(raw) as CustodialWallet;
    const master = getMasterKey();
    if (!verifyWalletMac(wallet.encryptedPrivateKey, wallet.mac, master)) {
      log.error("wallet.mac_invalid", { userId });
      const { alert } = await import("./adminAlerter");
      await alert("critical", "wallet.hmac_verification_failed", { userId });
      return null;
    }
    walletCache.set(userId, wallet);
    return migrateWalletIfNeeded(wallet);
  } catch {
    return null;
  }
}
