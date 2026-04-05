export interface ShortcutContext {
  userId: string;
  chatId: string;
  sendHtml: (html: string) => Promise<void>;
  sendKeyboard?: (html: string, keyboard: import("./keyboards").InlineKeyboard) => Promise<void>;
}

export function isShortcut(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("/") && t.length <= 12) {
    const cmd = t.split(/\s/)[0]!.toLowerCase();
    return (
      ["/b", "/h", "/s", "/c", "/m", "/l", "/r", "/streak", "/earn", "/help"].includes(cmd) ||
      cmd === "/start"
    );
  }
  return false;
}

export async function handleShortcut(text: string, ctx: ShortcutContext): Promise<boolean> {
  const cmd = text.trim().split(/\s/)[0]!.toLowerCase();
  const { shortWallet } = await import("@sendflow/plugin-intent-parser");
  const { sharedGetAllTransfers } = await import("@sendflow/plugin-intent-parser");
  const { getMarketPulse } = await import("./marketPulse");
  const { getHealthyConnection } = await import("./rpcManager");
  const { getTopSenders, getUserRank } = await import("./leaderboard");
  const { generateReferralLink } = await import("./referralSystem");
  const { getStreak } = await import("./streakSystem");
  const { getStakeKeyboard } = await import("./earnProtocol");
  const { getCustodialWallet } = await import("./custodialWallet");
  const { getUsdcBalanceHuman } = await import("./walletBalance");
  const { HELP_MESSAGE } = await import("./userRegistry");
  const { helpKeyboard } = await import("./keyboards");

  if (cmd === "/b") {
    const bal = await getUsdcBalanceHuman(ctx.userId);
    await ctx.sendHtml(`💰 <b>Balance</b>\n<b>${bal.toFixed(4)} USDC</b>`);
    return true;
  }
  if (cmd === "/h") {
    const txs = sharedGetAllTransfers(ctx.userId).slice(0, 5);
    const lines = txs.map((t) => `• ${t.amount} → ${t.receiverLabel} <code>${shortWallet(t.receiverWallet)}</code>`);
    await ctx.sendHtml([`<b>Recent transfers</b>`, "", ...lines].join("\n"));
    return true;
  }
  if (cmd === "/s") {
    const txs = sharedGetAllTransfers(ctx.userId);
    const vol = txs.reduce((s, x) => s + x.amount, 0);
    await ctx.sendHtml(`📊 <b>Stats</b>\nTransfers: <b>${txs.length}</b>\nVolume: <b>${vol.toFixed(2)} USDC</b>`);
    return true;
  }
  if (cmd === "/c") {
    const { listContacts } = await import("@sendflow/plugin-intent-parser");
    const c = listContacts(ctx.userId);
    const entries = Object.entries(c);
    await ctx.sendHtml(
      entries.length
        ? `<b>Contacts</b>\n${entries.map(([n, w]) => `• ${n}: <code>${shortWallet(w)}</code>`).join("\n")}`
        : `No contacts yet. <code>Save Mom: address</code>`
    );
    return true;
  }
  if (cmd === "/m") {
    const conn = await getHealthyConnection();
    const pulse = await getMarketPulse(conn);
    await ctx.sendHtml(pulse);
    return true;
  }
  if (cmd === "/l") {
    const top = await getTopSenders(10);
    await ctx.sendHtml(
      top.length
        ? [`<b>Leaderboard</b>`, ...top.map((e, i) => `${i + 1}. ${e.displayName} — ${e.totalSent.toFixed(2)}`)].join("\n")
        : `No entries yet.`
    );
    return true;
  }
  if (cmd === "/r") {
    const bot = process.env.TELEGRAM_BOT_USERNAME ?? "SendFlowSol_bot";
    const link = generateReferralLink(ctx.userId, bot);
    await ctx.sendHtml(`👥 <b>Referral</b>\n${link}`);
    return true;
  }
  if (cmd === "/streak") {
    const st = getStreak(ctx.userId);
    await ctx.sendHtml(
      `🔥 <b>Streak</b>\nCurrent: <b>${st.currentStreak}</b> days\nLongest: <b>${st.longestStreak}</b>`
    );
    return true;
  }
  if (cmd === "/earn") {
    if (ctx.sendKeyboard) {
      await ctx.sendKeyboard(`💰 <b>SendFlow Earn</b>\nPick a lock period:`, getStakeKeyboard());
    } else {
      await ctx.sendHtml(`💰 Type: <code>Stake 50 USDC for 30 days</code>`);
    }
    return true;
  }
  if (cmd === "/help" || cmd === "/start") {
    if (ctx.sendKeyboard) {
      await ctx.sendKeyboard(
        [
          `📖 <b>Quick shortcuts (instant)</b>`,
          `/b — balance  /h — history  /s — stats`,
          `/c — contacts  /m — market  /l — leaderboard`,
          `/r — referral  /streak — streak  /earn — stake`,
          ``,
          HELP_MESSAGE,
        ].join("\n"),
        helpKeyboard
      );
    } else {
      await ctx.sendHtml([`Shortcuts: /b /h /s /c /m /l /r /streak /earn`, "", HELP_MESSAGE].join("\n"));
    }
    return true;
  }
  return false;
}
