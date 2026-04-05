import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { loggerCompat as logger } from "@sendflow/plugin-intent-parser";
import { Connection, PublicKey } from "@solana/web3.js";
import { addWatch, removeWatch, listWatches, type WatchAlert } from "../utils/walletWatcher";
import {
  shortWallet,
  isValidReceiverWallet,
  extractSolanaAddress,
  getContact,
  resolveSolDomain,
} from "@sendflow/plugin-intent-parser";

export const watchWalletAction: Action = {
  name: "WATCH_WALLET",
  similes: ["ALERT_WALLET", "MONITOR_WALLET", "WATCH_BALANCE", "STOP_WATCHING"],
  description: "Set up real-time alerts when a wallet's USDC balance changes.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:watch|alert\s+me|notify\s+me|monitor|stop\s+watch|my\s+watches)\b/.test(text);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;
    const text = message.content.text ?? "";
    const lower = text.toLowerCase();

    const rpcUrl = (() => {
      const v = runtime.getSetting("SOLANA_RPC_URL");
      return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
    })();
    const connection = new Connection(rpcUrl, "confirmed");

    if (/\b(?:my\s+watches|list\s+watches|show\s+watches)\b/.test(lower)) {
      const watches = listWatches(entityId);
      if (watches.length === 0) {
        const msg =
          "👀 <b>No active watches</b>\n\nTry: \"Watch Mom's wallet\" or \"Alert me when balance drops below 50 USDC\"";
        if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
        return { success: true, text: msg };
      }
      const lines = watches.map((w) =>
        `  <b>${w.label}</b> (<code>${shortWallet(w.walletAddress)}</code>) — <b>${w.condition}</b>${w.threshold ? ` <b>$${w.threshold}</b>` : ""}`
      );
      const msg = [`👀 <b>Your active watches</b> (<b>${watches.length}</b>/3):`, "", ...lines].join("\n");
      if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
      return { success: true, text: msg };
    }

    if (/\bstop\s+watch/.test(lower)) {
      const labelMatch = text.match(/stop\s+watch(?:ing)?\s+(.+?)(?:'s)?\s*(?:wallet)?$/i);
      const label = labelMatch?.[1]?.trim() ?? "";
      if (!label) {
        const msg = "⚠️ <b>Specify which watch to stop</b>\n\nExample: \"Stop watching Mom\"\n💡 Use the same label you used when creating the watch.";
        if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
        return { success: false, text: msg };
      }
      const removed = removeWatch(entityId, label, connection);
      const msg = removed
        ? `✅ <b>Stopped watching</b> ${label}'s wallet.`
        : `⚠️ <b>No watch found</b> for \"${label}\".\n💡 Check your active watches with \"my watches\".`;
      if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
      return { success: true, text: msg };
    }

    let condition: "any" | "above" | "below" = "any";
    let threshold: number | undefined;
    const condMatch = lower.match(/\b(above|below|drops?\s+below|goes?\s+above|over|under)\s+\$?([0-9]+(?:\.[0-9]+)?)/);
    if (condMatch) {
      const op = condMatch[1];
      threshold = Number(condMatch[2]);
      condition = /below|under|drop/.test(op) ? "below" : "above";
    }

    let walletLabel = "";
    let walletAddr = "";

    const watchMatch = text.match(/\b(?:watch|alert|notify|monitor)\s+(?:me\s+(?:when|if)\s+)?(.+?)(?:'s)?\s*(?:wallet|balance)?$/i);
    const rawTarget = watchMatch?.[1]?.trim()?.replace(/\b(drops?|goes?|is|above|below|over|under)\b.*$/, "").trim() ?? "";

    if (rawTarget) {
      const contactWallet = getContact(entityId, rawTarget);
      if (contactWallet) {
        walletAddr = contactWallet;
        walletLabel = rawTarget;
      } else if (rawTarget.endsWith(".sol")) {
        try {
          walletAddr = await resolveSolDomain(rawTarget, rpcUrl);
          walletLabel = rawTarget;
        } catch {
          const msg = `⚠️ <b>Could not resolve</b> ${rawTarget}.\n💡 Check the spelling or try a full wallet address.`;
          if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
          return { success: false, text: msg };
        }
      } else {
        const addr = extractSolanaAddress(rawTarget);
        if (addr) {
          walletAddr = addr;
          walletLabel = shortWallet(addr);
        }
      }
    }

    if (!walletAddr) {
      const addrFromText = extractSolanaAddress(text);
      if (addrFromText) {
        walletAddr = addrFromText;
        walletLabel = shortWallet(addrFromText);
      }
    }

    if (!walletAddr || !isValidReceiverWallet(walletAddr)) {
      const msg =
        "⚠️ <b>Please specify a wallet to watch</b>\n\nExample: \"Watch Mom's wallet\" or paste a Solana address.\n💡 Say <code>my watches</code> to see active alerts.";
      if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
      return { success: false, text: msg };
    }

    const alert: WatchAlert = {
      userId: entityId,
      walletAddress: walletAddr,
      label: walletLabel,
      condition,
      threshold,
    };

    const result = await addWatch(alert, connection);
    if (!result.success) {
      const msg = `⚠️ <b>Could not add watch</b>\n\n${result.error}\n💡 You can have up to 3 watches — remove one or fix the issue above.`;
      if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
      return { success: false, text: msg };
    }

    const condDesc = condition === "any"
      ? "any USDC activity"
      : `USDC balance ${condition} $${threshold}`;

    const msg = [
      `👀 <b>Wallet Watch Active</b>`,
      ``,
      `🏷 <b>Label:</b> ${walletLabel}`,
      `👛 <b>Wallet:</b> <code>${shortWallet(walletAddr)}</code>`,
      `📊 <b>Condition:</b> ${condDesc}`,
      ``,
      `I'll notify you in real-time when the condition is met.`,
      `Use \"Stop watching ${walletLabel}\" to remove.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["WATCH_WALLET"], source: message.content.source });
    logger.info(`WATCH: ${entityId} watching ${walletAddr} — ${condDesc}`);
    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Alert me when my wallet drops below 50 USDC" } },
      { name: "{{agent}}", content: { text: "👀 Wallet Watch Active...", actions: ["WATCH_WALLET"] } },
    ],
  ],
};
