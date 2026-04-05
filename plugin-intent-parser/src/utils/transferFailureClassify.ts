const DEFAULT = {
  code: "unknown",
  userMessage: "Something went wrong",
  suggestion: "Please try again in a moment.",
  retryable: false,
  retryDelayMs: 0,
} as const;

const RULES: Array<{
  match: (msg: string) => boolean;
  code: string;
  userMessage: string;
  suggestion: string;
  retryable: boolean;
  retryDelayMs: number;
}> = [
  {
    match: (m) => m.includes("insufficient") || m.includes("not enough"),
    code: "insufficient_funds",
    userMessage: "Not enough USDC in your wallet",
    suggestion: "Add USDC via the Buy button, then try again",
    retryable: false,
    retryDelayMs: 0,
  },
  {
    match: (m) => m.includes("blockhash not found"),
    code: "blockhash_expired",
    userMessage: "Network was busy",
    suggestion: "Retrying automatically...",
    retryable: true,
    retryDelayMs: 5000,
  },
  {
    match: (m) => m.includes("too many requests") || m.includes("429"),
    code: "rate_limit",
    userMessage: "Network congested",
    suggestion: "Retrying in 30 seconds...",
    retryable: true,
    retryDelayMs: 30_000,
  },
  {
    match: (m) => m.includes("invalid account") || m.includes("account not found"),
    code: "invalid_account",
    userMessage: "Recipient wallet not found",
    suggestion: "Double-check the wallet address and try again",
    retryable: false,
    retryDelayMs: 0,
  },
  {
    match: (m) => m.includes("timeout") || m.includes("timed out"),
    code: "timeout",
    userMessage: "Connection timed out",
    suggestion: "The RPC was slow — we can retry shortly.",
    retryable: true,
    retryDelayMs: 15_000,
  },
];

export function classifyTransferFailure(error: unknown): {
  code: string;
  userMessage: string;
  suggestion: string;
  retryable: boolean;
  retryDelayMs: number;
} {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  for (const r of RULES) {
    if (r.match(msg)) {
      return {
        code: r.code,
        userMessage: r.userMessage,
        suggestion: r.suggestion,
        retryable: r.retryable,
        retryDelayMs: r.retryDelayMs,
      };
    }
  }
  return { ...DEFAULT };
}
