import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";

export interface OnRampOption {
  provider: string;
  url: string;
  fees: string;
  minAmount: number;
  countries: string[];
  paymentMethods: string[];
}

export const ON_RAMP_OPTIONS: OnRampOption[] = [
  {
    provider: "MoonPay",
    url: "https://buy.moonpay.com/?currencyCode=usdc_sol&walletAddress={wallet}",
    fees: "~2%",
    minAmount: 20,
    countries: ["US", "UK", "IN", "PH", "KE", "NG"],
    paymentMethods: ["Debit card", "Credit card", "Bank transfer"],
  },
  {
    provider: "Transak",
    url: "https://global.transak.com/?cryptoCurrencyCode=USDC&network=solana&walletAddress={wallet}",
    fees: "~1.5%",
    minAmount: 10,
    countries: ["IN", "PH", "KE", "NG", "US", "UK"],
    paymentMethods: ["UPI", "GCash", "M-Pesa", "Bank card"],
  },
  {
    provider: "Coinbase Pay",
    url: "https://pay.coinbase.com/buy/select-asset?appId=sendflow&destinationWallets={wallet_json}",
    fees: "~0%",
    minAmount: 5,
    countries: ["US"],
    paymentMethods: ["Coinbase balance", "Debit card"],
  },
];

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboardButton[][] {
  return m.reply_markup.inline_keyboard as InlineKeyboardButton[][];
}

export function getOnRampOptions(userCountry?: string): OnRampOption[] {
  if (!userCountry) return ON_RAMP_OPTIONS;
  const u = userCountry.toUpperCase();
  const filtered = ON_RAMP_OPTIONS.filter((o) => o.countries.includes(u));
  return filtered.length ? filtered : ON_RAMP_OPTIONS;
}

export function buildOnRampUrl(provider: string, walletAddress: string): string {
  if (provider === "Coinbase Pay") {
    const payload = encodeURIComponent(JSON.stringify([{ address: walletAddress, assets: ["USDC"] }]));
    return `https://pay.coinbase.com/buy/select-asset?appId=sendflow&destinationWallets=${payload}`;
  }
  const opt = ON_RAMP_OPTIONS.find((o) => o.provider === provider);
  if (!opt) {
    return `https://buy.moonpay.com/?currencyCode=usdc_sol&walletAddress=${encodeURIComponent(walletAddress)}`;
  }
  return opt.url.replace(/\{wallet_json\}/g, "").replace(/\{wallet\}/g, encodeURIComponent(walletAddress));
}

export function formatOnRampReply(walletAddress: string, userCountry?: string): string {
  const opts = getOnRampOptions(userCountry);
  const lines = [
    `<b>Add money to your wallet</b>`,
    ``,
    `Choose how to buy USDC (fees vary by region):`,
    ``,
    ...opts.map(
      (o) =>
        `<b>${o.provider}</b> — ${o.fees} fee\n<i>${o.paymentMethods.join(", ")}</i>\nCountries: ${o.countries.join(", ")}`
    ),
    ``,
    `Use the buttons below — your wallet is pre-filled where supported.`,
  ];
  return lines.join("\n");
}

export function getOnRampKeyboard(walletAddress: string): InlineKeyboardButton[][] {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.url("Buy via MoonPay", buildOnRampUrl("MoonPay", walletAddress))],
      [Markup.button.url("Buy via Transak", buildOnRampUrl("Transak", walletAddress))],
      [Markup.button.url("Buy via Coinbase", buildOnRampUrl("Coinbase Pay", walletAddress))],
      [Markup.button.callback("I already have USDC", "onramp_skip")],
    ])
  );
}
