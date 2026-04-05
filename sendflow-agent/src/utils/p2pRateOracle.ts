import { getOffers, type P2POffer } from "./p2pMarket";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const EXCHANGE_RATE_API = "https://api.exchangerate-api.com/v4/latest/USD";

export const FALLBACK_RATES: Record<string, number> = {
  INR: 83.4,
  PHP: 56.2,
  KES: 129.5,
  NGN: 1580.0,
  PKR: 278.0,
  BDT: 110.0,
  GHS: 15.2,
  TZS: 2540.0,
  AED: 3.67,
  SAR: 3.75,
  MYR: 4.72,
  THB: 36.5,
  USD: 1,
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function medianFromOpenSells(currency: string): number | null {
  const sells = getOffers({ type: "sell", currency });
  const rates = sells.map((o) => o.pricePerUsdc).filter((n) => n > 0);
  if (!rates.length) return null;
  if (rates.length < 2) return rates[0] ?? null;
  return median(rates.slice(-10));
}

async function getJupiterUsdcPrice(): Promise<number> {
  const base = (process.env.JUPITER_PRICE_API_URL ?? "https://price.jup.ag/v6").replace(/\/$/, "");
  const url = `${base}/price?ids=${USDC_MINT}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 1;
    const data = (await res.json()) as {
      data?: Record<string, { price?: number }>;
    };
    const p = data?.data?.[USDC_MINT]?.price;
    return typeof p === "number" && p > 0 ? p : 1;
  } catch {
    return 1;
  }
}

async function getFxRate(localCurrency: string): Promise<number> {
  const c = localCurrency.toUpperCase();
  if (c === "USD") return 1;
  try {
    const res = await fetch(EXCHANGE_RATE_API, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error("fx http");
    const data = (await res.json()) as { rates?: Record<string, number> };
    const r = data?.rates?.[c];
    if (typeof r === "number" && r > 0) return r;
  } catch {
    /* fallback */
  }
  return FALLBACK_RATES[c] ?? 1;
}

export async function getMarketRate(localCurrency: string): Promise<{
  rate: number;
  usdcPeg: number;
  source: "p2p_median" | "jupiter_fx" | "fallback";
  spread: number;
  lastUpdated: string;
  warning?: string;
}> {
  const c = localCurrency.toUpperCase();
  const usdcPeg = await getJupiterUsdcPrice();
  let warning: string | undefined;
  if (Math.abs(usdcPeg - 1.0) > 0.005) {
    warning = `⚠️ USDC quote ~$${usdcPeg.toFixed(4)} — check peg before large trades`;
  }

  const p2p = medianFromOpenSells(c);
  if (p2p != null && p2p > 0) {
    return {
      rate: p2p,
      usdcPeg,
      source: "p2p_median",
      spread: 0.5,
      lastUpdated: new Date().toISOString(),
      warning,
    };
  }

  try {
    const fx = await getFxRate(c);
    if (fx > 0) {
      return {
        rate: fx * usdcPeg,
        usdcPeg,
        source: "jupiter_fx",
        spread: 0.8,
        lastUpdated: new Date().toISOString(),
        warning,
      };
    }
  } catch {
    /* */
  }

  const fb = (FALLBACK_RATES[c] ?? 1) * usdcPeg;
  return {
    rate: fb,
    usdcPeg,
    source: "fallback",
    spread: 1,
    lastUpdated: new Date().toISOString(),
    warning,
  };
}

export async function getRateSummary(currency: string): Promise<string> {
  const c = currency.toUpperCase();
  const m = await getMarketRate(c);
  const sells = getOffers({ type: "sell", currency: c });
  const buys = getOffers({ type: "buy", currency: c });
  const sym =
    c === "INR" ? "₹" : c === "PHP" ? "₱" : c === "KES" ? "KSh" : c === "NGN" ? "₦" : c + " ";
  const wu = m.rate * 0.95;
  const lines = [
    `<b>P2P rate summary — ${c}</b>`,
    ``,
    `Indicative: <b>${sym}${m.rate.toFixed(2)}</b> / USDC`,
    `Sources: <i>${m.source}</i> · USDC ref <b>$${m.usdcPeg.toFixed(4)}</b> · spread est. <b>${m.spread}%</b>`,
    `Active sell listings: <b>${sells.length}</b> · buy ads: <b>${buys.length}</b>`,
    ``,
    `<i>Western Union often pays ~5% less on the receiver side (~${sym}${wu.toFixed(2)}/USDC equivalent).</i>`,
  ];
  if (m.warning) lines.push("", m.warning);
  return lines.join("\n");
}

export function sortOffersForBuyer(offers: P2POffer[]): P2POffer[] {
  return [...offers].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (a.pricePerUsdc !== b.pricePerUsdc) return a.pricePerUsdc - b.pricePerUsdc;
    return tb - ta;
  });
}
