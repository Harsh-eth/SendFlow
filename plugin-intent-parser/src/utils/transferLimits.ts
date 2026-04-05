export const TRANSFER_LIMITS = {
  MIN_USDC: Number(process.env.MIN_TRANSFER_USDC ?? "0.1"),
  MAX_USDC: Number(process.env.MAX_TRANSFER_USDC ?? "100"),
  LARGE_TRANSFER_THRESHOLD: 10,
  MULTISIG_THRESHOLD: 50,
  GAS_FREE_COUNT: 3,
  RATE_LIMIT_MESSAGES: 20,
  RATE_LIMIT_TRANSFERS: 10,
} as const;

export function validateTransferAmount(amount: number): { valid: boolean; error?: string } {
  if (Number.isNaN(amount) || amount <= 0) {
    return { valid: false, error: "Amount must be greater than 0" };
  }
  if (amount < TRANSFER_LIMITS.MIN_USDC) {
    return { valid: false, error: `Minimum transfer is ${TRANSFER_LIMITS.MIN_USDC} USDC` };
  }
  if (amount > TRANSFER_LIMITS.MAX_USDC) {
    return {
      valid: false,
      error: `Maximum transfer is ${TRANSFER_LIMITS.MAX_USDC} USDC. Contact support for larger transfers.`,
    };
  }
  return { valid: true };
}
