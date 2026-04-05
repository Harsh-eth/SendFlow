import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";

const MAX_TREASURIES = 5000;
const treasuries = new Map<string, Treasury>();
const userTreasury = new Map<string, string>();
let treasurySeq = 0;
let proposalSeq = 0;

export interface Proposal {
  proposalId: string;
  proposedBy: string;
  description: string;
  amount: number;
  recipient: string;
  votes: { userId: string; vote: "yes" | "no" }[];
  status: "voting" | "passed" | "rejected" | "executed";
  createdAt: string;
  expiresAt: string;
}

export interface Treasury {
  treasuryId: string;
  name: string;
  adminUserIds: string[];
  memberUserIds: string[];
  walletAddress: string;
  proposals: Proposal[];
  approvalThreshold: number;
  maxSingleSpend: number;
}

function trimTreasury(t: Treasury): void {
  while (t.proposals.length > 200) t.proposals.shift();
}

export function createTreasury(adminId: string, name: string, walletAddress: string): Treasury {
  treasurySeq += 1;
  while (treasuries.size >= MAX_TREASURIES) {
    const first = treasuries.keys().next().value as string | undefined;
    if (first) treasuries.delete(first);
    else break;
  }
  const treasuryId = `treasury_${treasurySeq}`;
  const t: Treasury = {
    treasuryId,
    name,
    adminUserIds: [adminId],
    memberUserIds: [adminId],
    walletAddress,
    proposals: [],
    approvalThreshold: 2,
    maxSingleSpend: 500,
  };
  treasuries.set(treasuryId, t);
  userTreasury.set(adminId, treasuryId);
  return t;
}

export function addMember(treasuryId: string, newUserId: string): void {
  const t = treasuries.get(treasuryId);
  if (!t) return;
  if (!t.memberUserIds.includes(newUserId)) t.memberUserIds.push(newUserId);
}

export function createProposal(
  treasuryId: string,
  proposedBy: string,
  desc: string,
  amount: number,
  recipient: string
): Proposal {
  const t = treasuries.get(treasuryId);
  if (!t) throw new Error("Treasury not found");
  proposalSeq += 1;
  const proposalId = `prop_${proposalSeq}`;
  const now = new Date();
  const expires = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const p: Proposal = {
    proposalId,
    proposedBy,
    description: desc,
    amount,
    recipient,
    votes: [],
    status: "voting",
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  t.proposals.push(p);
  trimTreasury(t);
  return p;
}

export function voteOnProposal(
  treasuryId: string,
  proposalId: string,
  userId: string,
  vote: "yes" | "no"
): { passed: boolean } {
  const t = treasuries.get(treasuryId);
  if (!t) return { passed: false };
  const p = t.proposals.find((x) => x.proposalId === proposalId);
  if (!p || p.status !== "voting") return { passed: false };
  if (!p.votes.some((v) => v.userId === userId)) p.votes.push({ userId, vote });
  const yes = p.votes.filter((v) => v.vote === "yes").length;
  const admins = t.adminUserIds.length;
  const threshold = Math.min(t.approvalThreshold, admins);
  if (yes >= threshold) {
    p.status = "passed";
    return { passed: true };
  }
  const no = p.votes.filter((v) => v.vote === "no").length;
  if (no > admins - threshold) p.status = "rejected";
  return { passed: false };
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

export async function executeProposal(
  treasuryId: string,
  proposalId: string,
  escrow: Keypair,
  connection: Connection
): Promise<string> {
  const t = treasuries.get(treasuryId);
  if (!t) throw new Error("Treasury not found");
  const p = t.proposals.find((x) => x.proposalId === proposalId);
  if (!p || p.status !== "passed") throw new Error("Proposal not executable");
  if (p.amount > t.maxSingleSpend) throw new Error("Amount exceeds max single spend");
  if (t.walletAddress !== escrow.publicKey.toBase58()) {
    throw new Error("Treasury wallet must match escrow for on-chain execution in this build.");
  }
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const recv = new PublicKey(p.recipient);
  const raw = BigInt(Math.round(p.amount * 1_000_000));
  const escrowAta = await getAssociatedTokenAddress(mint, escrow.publicKey);
  const recvAta = await getOrCreateAssociatedTokenAccount(connection, escrow, mint, recv);
  const ix = createTransferInstruction(escrowAta, recvAta.address, escrow.publicKey, raw);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = escrow.publicKey;
  tx.sign(escrow);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  p.status = "executed";
  return sig;
}

export function getTreasuryStatus(treasuryId: string): string {
  const t = treasuries.get(treasuryId);
  if (!t) return "⚠️ Treasury not found.";
  const lines = [
    `🏛 <b>${t.name}</b>`,
    `👛 Wallet: <code>${t.walletAddress.slice(0, 4)}…${t.walletAddress.slice(-4)}</code>`,
    `📋 Proposals: <b>${t.proposals.length}</b>`,
    `✅ Threshold: <b>${t.approvalThreshold}</b> yes votes`,
    ``,
  ];
  for (const p of t.proposals.slice(-5)) {
    lines.push(`• <b>${p.proposalId}</b> — ${p.status} — ${p.amount} USDC`);
  }
  return lines.join("\n");
}

export function findTreasuryByName(name: string): Treasury | null {
  const n = name.trim().toLowerCase();
  for (const t of treasuries.values()) {
    if (t.name.toLowerCase() === n) return t;
  }
  return null;
}

export function getUserTreasuryId(userId: string): string | undefined {
  return userTreasury.get(userId);
}

export function getTreasury(treasuryId: string): Treasury | undefined {
  return treasuries.get(treasuryId);
}

/** Resolve which treasury contains a proposal (for inline keyboard callbacks). */
export function findTreasuryIdByProposalId(proposalId: string): string | null {
  for (const [tid, t] of treasuries) {
    if (t.proposals.some((p) => p.proposalId === proposalId)) return tid;
  }
  return null;
}
