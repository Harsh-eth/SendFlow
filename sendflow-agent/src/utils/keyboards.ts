import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "@telegraf/types";

/** Inline keyboard rows compatible with Telegram `reply_markup.inline_keyboard` */
export type InlineKeyboard = InlineKeyboardButton[][];

function rows(m: ReturnType<typeof Markup.inlineKeyboard>): InlineKeyboard {
  return m.reply_markup.inline_keyboard as InlineKeyboard;
}

export const mainMenuKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("💸 Send USDC", "action_send"), Markup.button.callback("Balance", "action_balance")],
    [Markup.button.callback("Contacts", "action_contacts"), Markup.button.callback("History", "action_history")],
    [Markup.button.callback("Invoice", "action_invoice"), Markup.button.callback("Settings", "action_settings")],
  ])
);

export const confirmKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm", "confirm_yes"), Markup.button.callback("❌ Cancel", "confirm_no")],
  ])
);

/** Behavioral step-up (distinct callback_data from confirm_yes / stake). */
export function behavioralConfirmKeyboard(pendingId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Yes", `beh_unusual_yes_${pendingId}`),
        Markup.button.callback("❌ No", `beh_unusual_no_${pendingId}`),
      ],
    ])
  );
}

export const afterTransferKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("💸 Send Again", "action_repeat"), Markup.button.callback("Stats", "action_stats")],
    [Markup.button.callback("Refer a Friend", "action_referral")],
  ])
);

export const fundWalletKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("💸 P2P: Buy USDC", "p2p_buy"), Markup.button.callback("P2P menu", "p2p_menu")],
    [Markup.button.callback("Copy wallet address", "copy_wallet")],
    [Markup.button.callback("Share wallet QR", "share_qr")],
  ])
);

export function p2pMainKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("💸 Buy USDC", "p2p_buy"), Markup.button.callback("Sell USDC", "p2p_sell")],
      [Markup.button.callback("View offers", "p2p_browse"), Markup.button.callback("My trades", "p2p_my_trades")],
      [Markup.button.callback("Current rates", "p2p_rates"), Markup.button.callback("My reputation", "p2p_reputation")],
    ])
  );
}

function encodeRateCb(rate: number): string {
  return `p2p_rate_${Math.round(rate * 10_000)}`;
}

export function p2pRateKeyboard(marketRate: number, currency: string): InlineKeyboard {
  const below = marketRate * 0.999;
  const above = marketRate * 1.001;
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback(`${currency} ${below.toFixed(2)} (below market)`, encodeRateCb(below))],
      [Markup.button.callback(`${currency} ${marketRate.toFixed(2)} (market rate)`, encodeRateCb(marketRate))],
      [Markup.button.callback(`${currency} ${above.toFixed(2)} (above market)`, encodeRateCb(above))],
      [Markup.button.callback("Custom rate", "p2p_rate_custom")],
    ])
  );
}

export function p2pPaymentMethodKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("UPI", "p2p_pm_upi"), Markup.button.callback("Bank transfer", "p2p_pm_bank_transfer")],
      [Markup.button.callback("GCash", "p2p_pm_gcash"), Markup.button.callback("M-Pesa", "p2p_pm_mpesa")],
      [Markup.button.callback("PayPal", "p2p_pm_paypal"), Markup.button.callback("Wise", "p2p_pm_wise")],
      [Markup.button.callback("Cash in person", "p2p_pm_cash")],
    ])
  );
}

export function p2pTradeActionKeyboard(tradeId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("I have paid", `trade_paid_${tradeId}`)],
      [Markup.button.callback("❌ Cancel trade", `trade_cancel_${tradeId}`)],
    ])
  );
}

export function p2pProofPromptKeyboard(tradeId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("Skip — I trust the seller", `p2p_proof_skip_${tradeId}`)],
    ])
  );
}

/** Partial-fill aware: custom amount when listing > min trade size. */
export function p2pOfferActionsKeyboard(o: { offerId: string; usdcAmount: number; minAmount: number }): InlineKeyboard {
  if (o.usdcAmount > o.minAmount + 1e-6) {
    return rows(
      Markup.inlineKeyboard([
        [Markup.button.callback(`Trade (≤${o.usdcAmount} USDC)`, `trade_start_${o.offerId}`)],
        [Markup.button.callback("Custom amount", `trade_custom_${o.offerId}`)],
      ])
    );
  }
  return rows(
    Markup.inlineKeyboard([[Markup.button.callback("💸 Trade with this seller", `trade_start_${o.offerId}`)]])
  );
}

export function p2pSellerActionKeyboard(tradeId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Release USDC", `trade_release_${tradeId}`),
        Markup.button.callback("❌ Dispute", `trade_dispute_${tradeId}`),
      ],
    ])
  );
}

export function p2pOfferKeyboard(offerId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([[Markup.button.callback("💸 Trade with this seller", `trade_start_${offerId}`)]])
  );
}

export function adminDisputeKeyboard(tradeId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("⚡ Release to buyer", `admin_release_buyer_${tradeId}`),
        Markup.button.callback("Return to seller", `admin_release_seller_${tradeId}`),
      ],
    ])
  );
}

export const loanKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Accept Loan", "loan_accept"), Markup.button.callback("❌ Decline", "loan_decline")],
  ])
);

export const streamKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("Pause stream", "stream_pause"), Markup.button.callback("❌ Stop and settle", "stream_stop")],
  ])
);

export const posKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("View today sales", "pos_sales"), Markup.button.callback("❌ Disable POS", "pos_disable")],
  ])
);

export function treasuryKeyboard(proposalId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Vote Yes", `vote_yes_${proposalId}`),
        Markup.button.callback("❌ Vote No", `vote_no_${proposalId}`),
      ],
      [Markup.button.callback("⚡ Execute", `execute_proposal_${proposalId}`)],
    ])
  );
}

export function profileKeyboard(username: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback(`💸 Send to ${username}`, `send_to_${username}`)],
      [Markup.button.callback("Copy Blink URL", `blink_profile_${username}`)],
    ])
  );
}

export const approvalKeyboard = (requestId: string): InlineKeyboard =>
  rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Approve", `approve_ms_${requestId}`),
        Markup.button.callback("❌ Reject", `reject_ms_${requestId}`),
      ],
    ])
  );

export const swapKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm Swap", "swap_confirm"), Markup.button.callback("❌ Cancel", "swap_cancel")],
  ])
);

export const wizardAmountKeyboard = rows(
  Markup.inlineKeyboard([
    [
      Markup.button.callback("1 USDC", "wizard_amount_1"),
      Markup.button.callback("5 USDC", "wizard_amount_5"),
      Markup.button.callback("10 USDC", "wizard_amount_10"),
    ],
    [
      Markup.button.callback("25 USDC", "wizard_amount_25"),
      Markup.button.callback("50 USDC", "wizard_amount_50"),
      Markup.button.callback("Custom", "wizard_amount_custom"),
    ],
  ])
);

export const exportKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("✅ Confirm export", "key_export_confirm"), Markup.button.callback("❌ Cancel", "key_export_cancel")],
  ])
);

export const leaderboardKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("Join leaderboard", "leaderboard_join"), Markup.button.callback("My rank", "leaderboard_rank")],
  ])
);

export const marketKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("Set price alert", "alert_new"), Markup.button.callback("💸 Buy SOL now", "swap_sol")],
  ])
);

export const savingsKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("Deposit to vault", "vault_deposit"), Markup.button.callback("Withdraw savings", "vault_withdraw")],
    [Markup.button.callback("View earnings", "vault_earnings")],
  ])
);

export const cryptoReplyKeyboard = rows(
  Markup.inlineKeyboard([
    [
      Markup.button.callback("💸 Send USDC", "action_send"),
      Markup.button.callback("Market pulse", "action_market"),
      Markup.button.callback("Balance", "action_balance"),
    ],
  ])
);

export const helpKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("💸 Send USDC", "action_send"), Markup.button.callback("Balance", "action_balance")],
    [Markup.button.callback("Contacts", "action_contacts"), Markup.button.callback("History", "action_history")],
    [Markup.button.callback("Savings vault", "action_savings"), Markup.button.callback("Market", "action_market")],
    [Markup.button.callback("Leaderboard", "action_leaderboard"), Markup.button.callback("My card", "action_card")],
    [Markup.button.callback("Refer a friend", "action_referral"), Markup.button.callback("Settings", "action_settings")],
  ])
);

export const settingsKeyboard: InlineKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("Language", "settings_lang"), Markup.button.callback("Speed Mode", "settings_speed")],
    [Markup.button.callback("Monthly Budget", "settings_budget"), Markup.button.callback("Export Wallet", "settings_export")],
    [Markup.button.callback("Daily Digest", "settings_digest"), Markup.button.callback("Business Mode", "settings_business")],
  ])
);

export function stakeKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("7 days — 5% APY", "stake_7"),
        Markup.button.callback("30 days — 10% APY", "stake_30"),
      ],
      [Markup.button.callback("90 days — 18% APY", "stake_90")],
      [Markup.button.callback("❌ Cancel", "stake_cancel")],
    ])
  );
}

export function stakeStatusKeyboard(): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("⚡ Withdraw", "stake_withdraw"), Markup.button.callback("View earnings", "stake_earnings")],
    ])
  );
}

export function rollbackKeyboard(userId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("↩ Undo transfer", `rollback_${userId}`),
        Markup.button.callback("Done", `rollback_dismiss_${userId}`),
      ],
    ])
  );
}

export function amountKeyboard(): InlineKeyboard {
  return wizardAmountKeyboard;
}

export function contactsKeyboard(contactMap: Record<string, string>): InlineKeyboard {
  const entries = Object.entries(contactMap);
  const rowPairs: InlineKeyboard = [];
  for (let i = 0; i < entries.length; i += 2) {
    const row = [
      Markup.button.callback(entries[i]![0], `wizard_to_${entries[i]![0]}`),
      ...(entries[i + 1] ? [Markup.button.callback(entries[i + 1]![0], `wizard_to_${entries[i + 1]![0]}`)] : []),
    ];
    rowPairs.push(row);
  }
  rowPairs.push([Markup.button.callback("Enter wallet/domain", "wizard_to_custom")]);
  return rowPairs as InlineKeyboard;
}

export function payLinkAmountKeyboard(username: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("10 USDC", `paylink_10_${username}`),
        Markup.button.callback("25 USDC", `paylink_25_${username}`),
      ],
      [
        Markup.button.callback("50 USDC", `paylink_50_${username}`),
        Markup.button.callback("100 USDC", `paylink_100_${username}`),
      ],
      [Markup.button.callback("Custom amount", `paylink_custom_${username}`)],
    ])
  );
}

export function challengeKeyboard(challengeId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [
        Markup.button.callback("Join challenge", `challenge_join_${challengeId}`),
        Markup.button.callback("View leaderboard", `challenge_lb_${challengeId}`),
      ],
    ])
  );
}

export function achievementUnlockedKeyboard(achievementId: string): InlineKeyboard {
  return rows(
    Markup.inlineKeyboard([
      [Markup.button.callback("Share on Twitter", `ach_share_${achievementId}`)],
      [Markup.button.callback("View all achievements", "ach_all")],
    ])
  );
}

export const feedFooterKeyboard: InlineKeyboard = rows(
  Markup.inlineKeyboard([
    [Markup.button.callback("💸 Send USDC", "action_send"), Markup.button.callback("Leaderboard", "action_leaderboard")],
  ])
);
