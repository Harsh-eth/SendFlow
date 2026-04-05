import { ComputeBudgetProgram, type TransactionInstruction } from "@solana/web3.js";

export type SpeedMode = "slow" | "normal" | "fast" | "turbo";

export const PRIORITY_FEES: Record<SpeedMode, number> = {
  slow: 0,
  normal: 1_000,
  fast: 100_000,
  turbo: 1_000_000,
};

const SPEED_LABELS: Record<SpeedMode, string> = {
  slow: "🐢 Slow (~30s)",
  normal: "⚡ Normal (~5s)",
  fast: "🚀 Fast (~2s)",
  turbo: "⚡⚡ Turbo (~1s)",
};

export function detectSpeedMode(text: string): SpeedMode {
  const lower = text.toLowerCase();
  if (/\bturbo\b/.test(lower)) return "turbo";
  if (/\bfast\b|\bquick\b|\bpriority\b/.test(lower)) return "fast";
  if (/\bcheap\b|\bslow\b|\bno\s*fee\b/.test(lower)) return "slow";
  return "normal";
}

export function speedLabel(mode: SpeedMode): string {
  return SPEED_LABELS[mode];
}

export function priorityFeeIx(mode: SpeedMode): TransactionInstruction | null {
  const fee = PRIORITY_FEES[mode];
  if (fee <= 0) return null;
  return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee });
}

export function estimatedExtraFee(mode: SpeedMode): string {
  const fee = PRIORITY_FEES[mode];
  if (fee <= 0) return "0 SOL";
  const sol = (fee * 200_000) / 1e9;
  return `~${sol.toFixed(6)} SOL`;
}
