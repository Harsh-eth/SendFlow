import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

const MAX_STREAMS = 10_000;
const streams = new Map<string, PaymentStream>();
const userStreams = new Map<string, string>();
let streamSeq = 0;

export interface PaymentStream {
  streamId: string;
  senderUserId: string;
  receiverWallet: string;
  receiverLabel: string;
  ratePerSecond: number;
  totalDeposited: number;
  startedAt: number;
  lastSettledAt: number;
  status: "active" | "paused" | "ended";
  totalStreamed: number;
  pausedAt?: number;
  totalPausedMs: number;
}

function trimStreams(): void {
  while (streams.size >= MAX_STREAMS) {
    const first = streams.keys().next().value as string | undefined;
    if (first) streams.delete(first);
    else break;
  }
}

export function startStream(
  userId: string,
  receiverWallet: string,
  label: string,
  ratePerHour: number,
  totalBudget: number
): PaymentStream {
  const existing = userStreams.get(userId);
  if (existing) {
    const s = streams.get(existing);
    if (s && s.status !== "ended") throw new Error("You already have an active stream. Stop it first.");
  }
  streamSeq += 1;
  trimStreams();
  const streamId = `str_${Date.now()}_${streamSeq}`;
  const ratePerSecond = ratePerHour / 3600;
  const now = Date.now();
  const stream: PaymentStream = {
    streamId,
    senderUserId: userId,
    receiverWallet,
    receiverLabel: label,
    ratePerSecond,
    totalDeposited: totalBudget,
    startedAt: now,
    lastSettledAt: now,
    status: "active",
    totalStreamed: 0,
    totalPausedMs: 0,
  };
  streams.set(streamId, stream);
  userStreams.set(userId, streamId);
  return stream;
}

export function pauseStream(userId: string): PaymentStream | null {
  const id = userStreams.get(userId);
  if (!id) return null;
  const s = streams.get(id);
  if (!s || s.status !== "active") return null;
  s.status = "paused";
  s.pausedAt = Date.now();
  return s;
}

export function resumeStream(userId: string): PaymentStream | null {
  const id = userStreams.get(userId);
  if (!id) return null;
  const s = streams.get(id);
  if (!s || s.status !== "paused" || !s.pausedAt) return null;
  s.totalPausedMs += Date.now() - s.pausedAt;
  s.pausedAt = undefined;
  s.status = "active";
  s.lastSettledAt = Date.now();
  return s;
}

export function getStreamStatus(userId: string): PaymentStream | null {
  const id = userStreams.get(userId);
  return id ? streams.get(id) ?? null : null;
}

export function calculateStreamed(stream: PaymentStream): number {
  if (stream.status === "ended") return stream.totalStreamed;
  const end = stream.status === "paused" && stream.pausedAt ? stream.pausedAt : Date.now();
  const elapsedMs = end - stream.startedAt - stream.totalPausedMs;
  const elapsedSec = Math.max(0, elapsedMs / 1000);
  const theoretical = elapsedSec * stream.ratePerSecond;
  return Math.min(theoretical, stream.totalDeposited);
}

function loadKp(secret: string): Keypair | null {
  try {
    return Keypair.fromSecretKey(bs58.decode(secret.trim()));
  } catch {
    try {
      const j = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(j));
    } catch {
      return null;
    }
  }
}

export async function settleStream(
  userId: string,
  _escrowKeypair: Keypair,
  connection: Connection
): Promise<{ totalPaid: number; txHash: string }> {
  void _escrowKeypair;
  const id = userStreams.get(userId);
  if (!id) throw new Error("No active stream");
  const stream = streams.get(id);
  if (!stream || stream.status === "ended") throw new Error("No active stream");
  const delta = calculateStreamed(stream) - stream.totalStreamed;
  const pay = Math.max(0, Math.min(delta, stream.totalDeposited - stream.totalStreamed));
  if (pay < 0.01) {
    return { totalPaid: 0, txHash: "" };
  }
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const senderSecret = process.env.SENDER_WALLET_PRIVATE_KEY;
  if (!senderSecret) throw new Error("SENDER_WALLET_PRIVATE_KEY not set");
  const sender = loadKp(senderSecret);
  if (!sender) throw new Error("Invalid sender key");
  const recv = new PublicKey(stream.receiverWallet);
  const raw = BigInt(Math.round(pay * 1_000_000));
  const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);
  const recvAta = await getOrCreateAssociatedTokenAccount(connection, sender, mint, recv);
  const ix = createTransferInstruction(senderAta, recvAta.address, sender.publicKey, raw);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender.publicKey;
  tx.sign(sender);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  stream.totalStreamed += pay;
  stream.lastSettledAt = Date.now();
  return { totalPaid: pay, txHash: sig };
}

export function endStream(userId: string): PaymentStream | null {
  const id = userStreams.get(userId);
  if (!id) return null;
  const s = streams.get(id);
  if (!s) return null;
  s.status = "ended";
  userStreams.delete(userId);
  return s;
}

export function getStreamsMap(): Map<string, PaymentStream> {
  return streams;
}

export function getUserStreamsMap(): Map<string, string> {
  return userStreams;
}
