import { loggerCompat as logger } from "./structuredLogger";

export interface VaultPosition {
  userId: string;
  walletAddress: string;
  depositedAmount: number;
  protocol: string;
  depositedAt: string;
  estimatedAPY: number;
}

const vaultStore = new Map<string, VaultPosition>();

export async function getBestYield(): Promise<{ protocol: string; apy: number }> {
  try {
    const res = await fetch("https://yields.llama.fi/pools", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`DeFiLlama ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ project: string; symbol: string; chain: string; apy: number }> };
    const solanaUsdc = (data.data ?? [])
      .filter((p) => p.chain === "Solana" && /USDC/i.test(p.symbol) && p.apy > 0)
      .sort((a, b) => b.apy - a.apy);
    if (solanaUsdc.length > 0) {
      return { protocol: solanaUsdc[0].project, apy: solanaUsdc[0].apy };
    }
  } catch (err) {
    logger.warn(`DeFiLlama fetch failed: ${err}`);
  }
  return { protocol: "Kamino Finance", apy: 6.5 };
}

export async function depositToVault(userId: string, walletAddress: string, amount: number): Promise<VaultPosition> {
  const bestYield = await getBestYield();
  const position: VaultPosition = {
    userId,
    walletAddress,
    depositedAmount: amount,
    protocol: bestYield.protocol,
    depositedAt: new Date().toISOString(),
    estimatedAPY: bestYield.apy,
  };
  const existing = vaultStore.get(userId);
  if (existing) {
    existing.depositedAmount += amount;
    existing.estimatedAPY = bestYield.apy;
    return existing;
  }
  vaultStore.set(userId, position);
  return position;
}

export async function withdrawFromVault(userId: string): Promise<VaultPosition | null> {
  const position = vaultStore.get(userId);
  if (!position) return null;
  vaultStore.delete(userId);
  return position;
}

export function getVaultPosition(userId: string): VaultPosition | null {
  return vaultStore.get(userId) ?? null;
}

export function calculateEarnings(position: VaultPosition): { daily: number; monthly: number } {
  const daily = (position.depositedAmount * position.estimatedAPY) / 100 / 365;
  const monthly = daily * 30;
  return { daily, monthly };
}
