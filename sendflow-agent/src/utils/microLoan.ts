import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import bs58 from "bs58";
import { sharedGetAllTransfers } from "@sendflow/plugin-intent-parser";

const MAX_LOANS = 10_000;
const loans = new Map<string, LoanApplication>();
const userLoans = new Map<string, string>();
let loanSeq = 0;

export interface LoanApplication {
  loanId: string;
  userId: string;
  requestedAmount: number;
  approvedAmount: number;
  interestRate: number;
  disbursedAt?: string;
  dueDate: string;
  status: "pending" | "approved" | "disbursed" | "repaid" | "overdue";
  creditScore: number;
}

function trimLoans(): void {
  while (loans.size >= MAX_LOANS) {
    const first = loans.keys().next().value as string | undefined;
    if (first) loans.delete(first);
    else break;
  }
}

export function calculateCreditScore(userId: string): number {
  const txs = sharedGetAllTransfers(userId);
  const transferCount = txs.length;
  const totalVolume = txs.reduce((s, t) => s + (t.amount ?? 0), 0);
  const accountAgeDays = Math.min(365, transferCount > 0 ? transferCount * 3 : 0);
  const prevRepaid = [...loans.values()].some((l) => l.userId === userId && l.status === "repaid");

  const fromCount = Math.min(40, transferCount * 2);
  const fromVol = Math.min(30, totalVolume / 100);
  const fromAge = Math.min(20, accountAgeDays);
  const bonus = prevRepaid ? 10 : 0;
  return Math.min(100, Math.round(fromCount + fromVol + fromAge + bonus));
}

export function getMaxLoanAmount(score: number): number {
  if (score < 30) return 0;
  if (score < 60) return 10;
  if (score < 80) return 50;
  return Math.min(Number(process.env.LOAN_MAX_AMOUNT ?? 100), 100);
}

export function applyForLoan(userId: string, amount: number): LoanApplication {
  const score = calculateCreditScore(userId);
  const maxAmt = getMaxLoanAmount(score);
  const rate = Number(process.env.LOAN_INTEREST_RATE ?? 0.02);
  loanSeq += 1;
  trimLoans();
  const loanId = `loan_${Date.now()}_${loanSeq}`;
  if (maxAmt <= 0 || amount > maxAmt) {
    const denied: LoanApplication = {
      loanId,
      userId,
      requestedAmount: amount,
      approvedAmount: 0,
      interestRate: rate,
      dueDate: new Date().toISOString(),
      status: "pending",
      creditScore: score,
    };
    loans.set(loanId, denied);
    return denied;
  }
  const approvedAmount = amount;
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const app: LoanApplication = {
    loanId,
    userId,
    requestedAmount: amount,
    approvedAmount,
    interestRate: rate,
    dueDate: due,
    status: "approved",
    creditScore: score,
  };
  loans.set(loanId, app);
  userLoans.set(userId, loanId);
  return app;
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

export async function disburseLoan(loanId: string, escrowKeypair: Keypair, connection: Connection): Promise<string> {
  const loan = loans.get(loanId);
  if (!loan || loan.status !== "approved") throw new Error("Invalid loan for disbursement");
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const custodial = await import("./custodialWallet").then((m) => m.getCustodialWallet(loan.userId));
  if (!custodial) throw new Error("No custodial wallet for user");
  const recv = new PublicKey(custodial.publicKey);
  const raw = BigInt(Math.round(loan.approvedAmount * 1_000_000));
  const escrowAta = await getAssociatedTokenAddress(mint, escrowKeypair.publicKey);
  const recvAta = await getOrCreateAssociatedTokenAccount(connection, escrowKeypair, mint, recv);
  const ix = createTransferInstruction(escrowAta, recvAta.address, escrowKeypair.publicKey, raw);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = escrowKeypair.publicKey;
  tx.sign(escrowKeypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  loan.status = "disbursed";
  loan.disbursedAt = new Date().toISOString();
  loan.dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString();
  return sig;
}

export async function repayLoan(
  loanId: string,
  userId: string,
  escrowKeypair: Keypair,
  connection: Connection
): Promise<string> {
  const loan = loans.get(loanId);
  if (!loan || loan.userId !== userId) throw new Error("Loan not found");
  if (loan.status !== "disbursed" && loan.status !== "overdue") throw new Error("Nothing to repay");
  const repay = loan.approvedAmount * (1 + loan.interestRate);
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const senderSecret = process.env.SENDER_WALLET_PRIVATE_KEY;
  if (!senderSecret) throw new Error("SENDER_WALLET_PRIVATE_KEY not set");
  const sender = loadKp(senderSecret);
  if (!sender) throw new Error("Invalid sender key");
  const raw = BigInt(Math.round(repay * 1_000_000));
  const senderAta = await getAssociatedTokenAddress(mint, sender.publicKey);
  const escrowAta = await getAssociatedTokenAddress(mint, escrowKeypair.publicKey);
  const ix = createTransferInstruction(senderAta, escrowAta, sender.publicKey, raw);
  const tx = new Transaction();
  tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = sender.publicKey;
  tx.sign(sender);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  loan.status = "repaid";
  userLoans.delete(userId);
  return sig;
}

export function checkOverdueLoans(): LoanApplication[] {
  const now = Date.now();
  const out: LoanApplication[] = [];
  for (const l of loans.values()) {
    if (l.status === "disbursed" && new Date(l.dueDate).getTime() < now) {
      l.status = "overdue";
      out.push(l);
    }
  }
  return out;
}

export function getActiveLoan(userId: string): LoanApplication | null {
  const id = userLoans.get(userId);
  if (!id) return null;
  return loans.get(id) ?? null;
}

export function getLoanById(loanId: string): LoanApplication | undefined {
  return loans.get(loanId);
}
