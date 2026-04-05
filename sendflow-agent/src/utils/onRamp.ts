import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboardButton[][] {
  return m.reply_markup.inline_keyboard as InlineKeyboardButton[][];
}

/** @deprecated Wallet param kept for call-site compatibility; P2P is in-bot only. */
export function formatOnRampReply(_walletAddress: string, _userCountry?: string): string {
  void _walletAddress;
  void _userCountry;
  return [
    `<b>Add USDC — P2P marketplace</b>`,
    ``,
    `Buy USDC from other SendFlow users with <b>UPI</b>, <b>bank transfer</b>, <b>GCash</b>, <b>M-Pesa</b>, and more.`,
    `USDC sits in <b>escrow on Solana</b> until the seller releases — <b>zero platform fee</b>.`,
    ``,
    `Tap <b>Buy USDC</b> or <b>P2P menu</b> below, or type <code>Buy 50 USDC</code>.`,
  ].join("\n");
}

/** @deprecated walletAddress unused — callbacks only. */
export function getOnRampKeyboard(_walletAddress?: string): InlineKeyboardButton[][] {
  void _walletAddress;
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("💸 Buy USDC (P2P)", "p2p_buy"), Markup.button.callback("P2P menu", "p2p_menu")],
      [Markup.button.callback("Copy wallet address", "copy_wallet")],
      [Markup.button.callback("I already have USDC", "onramp_skip")],
    ])
  );
}
