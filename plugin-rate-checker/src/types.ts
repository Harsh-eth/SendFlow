export interface SendflowRate {
  sourceMint: string;
  targetMint: string;
  jupiterRate: number;
  pythRate: number;
  bestRate: number;
  provider: "jupiter" | "pyth";
  recipientGets: number;
  sendflowFee: number;
  fetchedAt: string;
}
