import { formatAmountInLocalCurrency, type UserLocale } from "./countryDetector";
import { recordSavingsVsWu } from "./growthMetrics";

export interface CompetitorFees {
  westernUnion: number;
  paypal: number;
  bankWire: number;
  sendflow: number;
  userSaved: number;
}

/** Corridor keys: FROM-TO (ISO). Approximate effective fee % for comparison only. */
export const WU_RATES: Record<string, number> = {
  "US-IN": 0.04,
  "US-PH": 0.03,
  "EU-KE": 0.06,
  "US-KE": 0.055,
  "US-NG": 0.055,
  DEFAULT: 0.05,
};

function corridorKey(fromCountry: string, toCountry: string): string {
  return `${fromCountry}-${toCountry}`;
}

export function calculateCompetitorFees(amount: number, fromCountry: string, toCountry: string): CompetitorFees {
  const wuRate = WU_RATES[corridorKey(fromCountry, toCountry)] ?? WU_RATES.DEFAULT;
  const westernUnion = amount * wuRate;
  const paypal = Math.min(amount * 0.034 + 0.49, amount * 0.05);
  const bankWire = Math.min(25, Math.max(15, amount * 0.01));
  const sendflow = Math.max(0.01, amount * 0.005);
  const userSaved = Math.max(0, westernUnion - sendflow);
  return { westernUnion, paypal, bankWire, sendflow, userSaved };
}

export function formatCompetitorBlock(
  amount: number,
  fromCountry: string,
  toCountry: string,
  lifetimeSaved: number
): string {
  const c = calculateCompetitorFees(amount, fromCountry, toCountry);
  return [
    `<b>What others might charge (estimates):</b>`,
    `Western Union: <b>$${c.westernUnion.toFixed(2)}</b>`,
    `PayPal: <b>$${c.paypal.toFixed(2)}</b>`,
    `Bank wire: <b>$${c.bankWire.toFixed(2)}</b>`,
    `SendFlow: <b>$${c.sendflow.toFixed(2)}</b> ✅`,
    ``,
    `<b>You saved ~$${c.userSaved.toFixed(2)} on this transfer vs WU.</b>`,
    `Total saved vs WU (tracked): <b>$${lifetimeSaved.toFixed(2)}</b>`,
  ].join("\n");
}

/** Call after each successful USDC transfer for analytics + lifetime savings. */
export function recordTransferSavings(userId: string, amount: number, fromCountry: string, toCountry: string): number {
  const { userSaved } = calculateCompetitorFees(amount, fromCountry, toCountry);
  recordSavingsVsWu(userId, userSaved);
  return userSaved;
}

export function formatLocalizedWuLine(amountUsd: number, locale: UserLocale, toCountry: string): string {
  const c = calculateCompetitorFees(amountUsd, locale.country, toCountry);
  const local = formatAmountInLocalCurrency(c.userSaved, locale);
  return `You saved: <b>${local}</b> vs typical Western Union on this amount 🎉`;
}
