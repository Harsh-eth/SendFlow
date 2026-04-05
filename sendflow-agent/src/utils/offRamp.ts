import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboardButton[][] {
  return m.reply_markup.inline_keyboard as InlineKeyboardButton[][];
}

export function formatOffRampReply(_userCountry?: string): string {
  void _userCountry;
  return [
    `<b>Cash out — P2P marketplace</b>`,
    ``,
    `Sell USDC to local buyers. You lock USDC in escrow; after they pay fiat, you release.`,
    `<b>No third-party sell links</b> — trades are peer-to-peer with escrow.`,
    ``,
    `Type <code>Sell 100 USDC</code> or tap <b>Sell USDC</b> below.`,
  ].join("\n");
}

export function getOffRampKeyboard(_userCountry?: string): InlineKeyboardButton[][] {
  void _userCountry;
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("Sell USDC (P2P)", "p2p_sell"), Markup.button.callback("P2P menu", "p2p_menu")],
      [Markup.button.callback("View offers", "p2p_browse")],
    ])
  );
}
