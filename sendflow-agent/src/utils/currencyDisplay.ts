import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";

export interface CurrencyPreference {
  userId: string;
  displayCurrency: string;
  displaySymbol: string;
  exchangeRate: number;
  lastUpdated: string;
}

const SYMBOLS: Record<string, string> = {
  USD: "$",
  INR: "₹",
  PHP: "₱",
  KES: "KSh",
  NGN: "₦",
  EUR: "€",
  GBP: "£",
};

const prefsStore = new Map<string, CurrencyPreference>();

function filePathData(): Record<string, CurrencyPreference> {
  return persistLoad<Record<string, CurrencyPreference>>("currency-prefs.json", {});
}

function persist(): void {
  persistSave("currency-prefs.json", Object.fromEntries(prefsStore));
}

function load(): void {
  prefsStore.clear();
  const o = filePathData();
  for (const [k, v] of Object.entries(o)) {
    prefsStore.set(k, v);
  }
}

load();

/** USDC ~ USD; units of foreign per 1 USDC. Used for quick conversion replies. */
export async function getExchangeRate(targetCurrency: string): Promise<number> {
  const c = targetCurrency.toUpperCase();
  if (c === "USD") return 1;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return 1;
    const j = (await res.json()) as { rates?: Record<string, number> };
    const r = j.rates?.[c];
    return typeof r === "number" && r > 0 ? r : 1;
  } catch {
    return 1;
  }
}

export function formatInLocalCurrency(usdcAmount: number, prefs: CurrencyPreference): string {
  const local = usdcAmount * prefs.exchangeRate;
  const sym = prefs.displaySymbol || SYMBOLS[prefs.displayCurrency] || prefs.displayCurrency;
  if (prefs.displayCurrency === "USD") return `${sym}${local.toFixed(2)}`;
  return `${sym}${local.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export async function setDisplayCurrency(userId: string, currency: string): Promise<CurrencyPreference> {
  const displayCurrency = currency.toUpperCase();
  const rate = await getExchangeRate(displayCurrency);
  const pref: CurrencyPreference = {
    userId,
    displayCurrency,
    displaySymbol: SYMBOLS[displayCurrency] ?? displayCurrency,
    exchangeRate: rate,
    lastUpdated: new Date().toISOString(),
  };
  prefsStore.set(userId, pref);
  persist();
  return pref;
}

export function getDisplayCurrencyPrefs(userId: string): CurrencyPreference | null {
  return prefsStore.get(userId) ?? null;
}

/** One line for transfer previews, e.g. (~₹4,170) */
export async function formatConversionLine(userId: string, usdcAmount: number): Promise<string> {
  let p = getDisplayCurrencyPrefs(userId);
  if (!p) return "";
  const age = Date.now() - new Date(p.lastUpdated).getTime();
  if (age > 6 * 3600_000) {
    const rate = await getExchangeRate(p.displayCurrency);
    p = { ...p, exchangeRate: rate, lastUpdated: new Date().toISOString() };
    prefsStore.set(userId, p);
    persist();
  }
  return `(~${formatInLocalCurrency(usdcAmount, p)})`;
}
