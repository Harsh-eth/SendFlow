import { TRANSFER_LIMITS } from "@sendflow/plugin-intent-parser";

const ERROR_SUGGESTIONS: Record<string, string> = {
  insufficient_balance: "Fund your wallet — tap <b>Fund my wallet</b> below or buy USDC on Coinbase",
  invalid_wallet:
    "Check the wallet address — it should be 32–44 characters, or use a <code>.sol</code> domain",
  rpc_timeout: "Solana is busy — your transfer may be queued; wait 30s and check <b>history</b>",
  amount_too_low: `Minimum transfer is ${TRANSFER_LIMITS.MIN_USDC} USDC`,
  amount_too_high: `Maximum transfer is ${TRANSFER_LIMITS.MAX_USDC} USDC`,
  rate_limit: "You are sending too fast — wait 60 seconds and try again",
  loan_active: "You already have an active loan — repay with <b>repay my loan</b>",
  no_contacts: "No contacts saved — try <code>Save Mom: wallet_address</code>",
};

export function getErrorSuggestion(errorType: string): string {
  return ERROR_SUGGESTIONS[errorType] ?? "Type <b>help</b> for commands or try again in a moment.";
}

export function formatErrorMessage(errorType: string, details?: string): string {
  const title = errorType.replace(/_/g, " ");
  const sug = getErrorSuggestion(errorType);
  return [`❌ <b>${title}</b>`, details ? String(details) : ``, `💡 ${sug}`].filter(Boolean).join("\n");
}
