/** Solana-native payout rails (no fiat APIs). */
export type RemittanceRail = "SPL_TRANSFER" | "JUPITER_SWAP" | "SQUADS_ESCROW";

export interface RemittanceIntent {
  amount: number;
  sourceMint: string;
  targetMint: string;
  targetRail: RemittanceRail;
  receiverLabel: string;
  receiverWallet: string;
  memo?: string;
  confidence: number;
}
