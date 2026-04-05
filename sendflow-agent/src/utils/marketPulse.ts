import { Connection } from "@solana/web3.js";
import { updateCachedSolPriceUsd } from "@sendflow/plugin-intent-parser";
import { loggerCompat as logger } from "./structuredLogger";

interface TokenPrice {
  symbol: string;
  price: number;
  emoji: string;
}

async function fetchPrices(): Promise<TokenPrice[]> {
  const mints: Record<string, { symbol: string; emoji: string }> = {
    So11111111111111111111111111111111111111112: { symbol: "SOL", emoji: "◎" },
    "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh": { symbol: "BTC", emoji: "₿" },
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", emoji: "💵" },
  };
  const ids = Object.keys(mints).join(",");
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Record<string, { price?: string }> };
    const results: TokenPrice[] = [];
    for (const [mint, info] of Object.entries(mints)) {
      const priceStr = data.data?.[mint]?.price;
      if (priceStr) results.push({ ...info, price: Number(priceStr) });
    }
    /** Spot SOL/USD (Jupiter) → savings engine fee USD; override with env SOL_PRICE_USD if needed. */
    const sol = results.find((r) => r.symbol === "SOL");
    if (sol && Number.isFinite(sol.price) && sol.price > 0) {
      updateCachedSolPriceUsd(sol.price);
    }
    return results;
  } catch (err) {
    logger.warn(`Market pulse price fetch failed: ${err}`);
    return [];
  }
}

async function fetchSolanaTps(connection: Connection): Promise<number | null> {
  try {
    const samples = await connection.getRecentPerformanceSamples(1);
    if (samples.length > 0) {
      return Math.round(samples[0].numTransactions / samples[0].samplePeriodSecs);
    }
  } catch { /* non-critical */ }
  return null;
}

export async function getMarketPulse(connection: Connection): Promise<string> {
  const [prices, tps] = await Promise.all([fetchPrices(), fetchSolanaTps(connection)]);

  const lines: string[] = [`📊 <b>Market Pulse</b>`, ``];

  for (const t of prices) {
    const peg = t.symbol === "USDC" ? (Math.abs(t.price - 1) < 0.005 ? " ✅ (pegged)" : " ⚠️") : "";
    const fmt = t.price >= 1000 ? `$${t.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${t.price.toFixed(2)}`;
    lines.push(`${t.emoji} ${t.symbol}: <b>${fmt}</b>${peg}`);
  }

  if (tps != null) {
    lines.push(`⚡ Solana TPS: <b>${tps.toLocaleString()}</b>`);
  }

  lines.push(``);
  lines.push(`⚡ Powered by SendFlow on Nosana`);

  return lines.join("\n");
}
