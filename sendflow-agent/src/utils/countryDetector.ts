/** Telegram-language–based locale + rough FX for comparisons (approximate). */

export interface UserLocale {
  country: string;
  currency: string;
  currencySymbol: string;
  language: string;
  preferredOnRamp: string;
  preferredOffRamp: string;
  westernUnionRate: number;
}

const localeByLang: Record<string, Partial<UserLocale> & { country: string }> = {
  hi: { country: "IN", currency: "INR", currencySymbol: "₹", language: "hi", preferredOnRamp: "Transak", preferredOffRamp: "Transak", westernUnionRate: 0.05 },
  tl: { country: "PH", currency: "PHP", currencySymbol: "₱", language: "tl", preferredOnRamp: "Transak", preferredOffRamp: "Transak", westernUnionRate: 0.04 },
  fil: { country: "PH", currency: "PHP", currencySymbol: "₱", language: "tl", preferredOnRamp: "Transak", preferredOffRamp: "Transak", westernUnionRate: 0.04 },
  sw: { country: "KE", currency: "KES", currencySymbol: "KSh", language: "sw", preferredOnRamp: "Transak", preferredOffRamp: "Transak", westernUnionRate: 0.06 },
  en: { country: "US", currency: "USD", currencySymbol: "$", language: "en", preferredOnRamp: "MoonPay", preferredOffRamp: "MoonPay", westernUnionRate: 0.05 },
};

/** Local currency units per 1 USD (approximate). */
const USD_TO_LOCAL: Record<string, number> = {
  USD: 1,
  INR: 83,
  PHP: 56,
  KES: 130,
  NGN: 1500,
  EUR: 0.92,
  GBP: 0.79,
};

const userLocaleCache = new Map<string, UserLocale>();

export function rememberUserLocale(userId: string, telegramLangCode?: string): UserLocale {
  const l = detectCountry(telegramLangCode);
  userLocaleCache.set(userId, l);
  return l;
}

export function getUserLocale(userId: string): UserLocale {
  return userLocaleCache.get(userId) ?? detectCountry();
}

export function detectCountry(telegramLangCode?: string, _timezone?: string): UserLocale {
  const code = (telegramLangCode ?? "en").split("-")[0]!.toLowerCase();
  const base = localeByLang[code] ?? localeByLang.en!;
  return {
    country: base.country!,
    currency: base.currency ?? "USD",
    currencySymbol: base.currencySymbol ?? "$",
    language: base.language ?? "en",
    preferredOnRamp: base.preferredOnRamp ?? "MoonPay",
    preferredOffRamp: base.preferredOffRamp ?? "MoonPay",
    westernUnionRate: base.westernUnionRate ?? 0.05,
  };
}

export function formatAmountInLocalCurrency(usdcAmount: number, locale: UserLocale): string {
  const units = USD_TO_LOCAL[locale.currency] ?? USD_TO_LOCAL.USD;
  const local = usdcAmount * units;
  if (locale.currency === "INR" || locale.currency === "PHP" || locale.currency === "KES" || locale.currency === "NGN") {
    return `${locale.currencySymbol}${local.toFixed(0)}`;
  }
  return `${locale.currencySymbol}${local.toFixed(2)}`;
}

export function getWesternUnionComparison(amountUsd: number, locale: UserLocale): string {
  const wuFeeUsd = amountUsd * locale.westernUnionRate;
  const wuLocal = formatAmountInLocalCurrency(wuFeeUsd, locale);
  const savedLocal = formatAmountInLocalCurrency(wuFeeUsd, locale);
  return `Western Union would charge about <b>${wuLocal}</b> for this corridor. With SendFlow you keep almost all of it — you saved ~<b>${savedLocal}</b> vs typical WU pricing.`;
}
