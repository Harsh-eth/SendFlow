export interface TokenInfo {
  mint: string;
  decimals: number;
  symbol: string;
  emoji: string;
}

export const TOKEN_REGISTRY: Record<string, TokenInfo> = {
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, symbol: "USDC", emoji: "💵" },
  SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, symbol: "SOL", emoji: "◎" },
  BONK: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5, symbol: "BONK", emoji: "🐕" },
  JUP: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6, symbol: "JUP", emoji: "🪐" },
  WIF: { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6, symbol: "WIF", emoji: "🐶" },
  PYTH: { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", decimals: 6, symbol: "PYTH", emoji: "🔮" },
};

export function lookupToken(symbolOrMint: string): TokenInfo | null {
  const upper = symbolOrMint.toUpperCase();
  if (TOKEN_REGISTRY[upper]) return TOKEN_REGISTRY[upper];
  for (const info of Object.values(TOKEN_REGISTRY)) {
    if (info.mint === symbolOrMint) return info;
  }
  return null;
}

export function detectTokenFromText(text: string): TokenInfo | null {
  const lower = text.toLowerCase();
  for (const [symbol, info] of Object.entries(TOKEN_REGISTRY)) {
    const regex = new RegExp(`\\b${symbol.toLowerCase()}\\b`);
    if (regex.test(lower)) return info;
  }
  return null;
}

export function tokenEmoji(symbol: string): string {
  return TOKEN_REGISTRY[symbol.toUpperCase()]?.emoji ?? "🪙";
}
