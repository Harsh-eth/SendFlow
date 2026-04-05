import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";

export interface OffRampOption {
  provider: string;
  url: string;
  fees: string;
  deliveryMethod: string;
  countries: string[];
  estimatedTime: string;
}

export const OFF_RAMP_OPTIONS: OffRampOption[] = [
  {
    provider: "Transak",
    url: "https://global.transak.com/?productsAvailed=SELL&cryptoCurrencyCode=USDC&network=solana",
    fees: "~1.5%",
    deliveryMethod: "Bank transfer, UPI, GCash, M-Pesa",
    countries: ["IN", "PH", "KE", "NG"],
    estimatedTime: "1–2 hours",
  },
  {
    provider: "MoonPay",
    url: "https://sell.moonpay.com/?baseCurrencyCode=usdc_sol",
    fees: "~2%",
    deliveryMethod: "Bank transfer",
    countries: ["US", "UK", "DE", "FR", "EU"],
    estimatedTime: "1–3 days",
  },
];

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboardButton[][] {
  return m.reply_markup.inline_keyboard as InlineKeyboardButton[][];
}

export function getOffRampOptions(userCountry?: string): OffRampOption[] {
  if (!userCountry) return OFF_RAMP_OPTIONS;
  const u = userCountry.toUpperCase();
  const filtered = OFF_RAMP_OPTIONS.filter((o) => o.countries.some((c) => c === u || (c === "EU" && /^[A-Z]{2}$/.test(u))));
  return filtered.length ? filtered : OFF_RAMP_OPTIONS;
}

export function formatOffRampReply(userCountry?: string): string {
  const opts = getOffRampOptions(userCountry);
  return [
    `<b>Cash out to your bank</b>`,
    ``,
    `Convert USDC to local currency. Pick a provider:`,
    ``,
    ...opts.map(
      (o) =>
        `<b>${o.provider}</b> — ${o.fees}\n${o.deliveryMethod}\nTypical: ${o.estimatedTime}\n<i>Available: ${o.countries.join(", ")}</i>`
    ),
    ``,
    `Open a provider below and follow their KYC steps.`,
  ].join("\n");
}

export function getOffRampKeyboard(_userCountry?: string): InlineKeyboardButton[][] {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.url("Sell via Transak", OFF_RAMP_OPTIONS[0]!.url)],
      [Markup.button.url("Sell via MoonPay", OFF_RAMP_OPTIONS[1]!.url)],
    ])
  );
}
