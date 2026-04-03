/**
 * Jupiter Price API + Pyth Hermes (Solana-native price sources).
 * All network calls wrapped in try/catch; callers handle null.
 */

export type JupiterPriceResponse = {
  data?: Record<string, { id?: string; mintSymbol?: string; price?: string }>;
};

export async function fetchJupiterUsdPerToken(
  mint: string,
  jupiterPriceBaseUrl: string
): Promise<number | null> {
  try {
    const url = `${jupiterPriceBaseUrl.replace(/\/$/, "")}/price?ids=${encodeURIComponent(mint)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as JupiterPriceResponse;
    const row = json.data?.[mint];
    const p = row?.price != null ? Number(row.price) : NaN;
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Pyth Hermes latest_price_feeds: returns price as (price * 10^expo) in payload. */
export async function fetchPythUsdPerToken(
  feedId: string,
  pythBaseUrl: string
): Promise<number | null> {
  try {
    const base = pythBaseUrl.replace(/\/$/, "");
    const url = `${base}/api/latest_price_feeds?ids=${encodeURIComponent(feedId)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{
      id?: string;
      price?: { price?: string; expo?: number };
    }>;
    const first = Array.isArray(arr) ? arr[0] : null;
    const raw = first?.price?.price;
    const expo = first?.price?.expo ?? 0;
    if (raw == null) return null;
    const v = Number(raw) * Math.pow(10, expo);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function computeRecipientGets(params: {
  amountSourceHuman: number;
  sourceUsd: number;
  targetUsd: number;
  feeBps: number;
}): number {
  const { amountSourceHuman, sourceUsd, targetUsd, feeBps } = params;
  if (sourceUsd <= 0 || targetUsd <= 0) return 0;
  const valueUsd = amountSourceHuman * sourceUsd;
  const afterFee = valueUsd * (1 - feeBps / 10_000);
  return afterFee / targetUsd;
}
