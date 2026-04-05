import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { saveContact, getContact, listContacts, deleteContact } from "../utils/contactBook";
import { isValidReceiverWallet } from "../utils/solanaAddress";
import { shortWallet } from "../utils/format";

export const manageContactsAction: Action = {
  name: "MANAGE_CONTACTS",
  similes: ["SAVE_CONTACT", "ADD_CONTACT", "LIST_CONTACTS", "DELETE_CONTACT", "SHOW_CONTACTS"],
  description: "Save, list, or delete named contacts for quick transfers.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:save\s+(?:this\s+)?(?:wallet|contact|address)\s+as|save\s+\w+\s+as|add\s+contact|show\s+(?:my\s+)?contacts|list\s+contacts|delete\s+contact|remove\s+contact|my\s+contacts)\b/.test(text);
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: unknown,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const entityId = message.entityId as string;
    const text = (message.content.text ?? "").trim();
    const lower = text.toLowerCase();

    if (/\b(?:show|list|my)\s+(?:my\s+)?contacts\b/i.test(lower)) {
      const contacts = listContacts(entityId);
      const entries = Object.entries(contacts);
      if (entries.length === 0) {
        const msg =
          "📇 <b>No contacts saved yet</b>\n\nUse: \"Save wallet as Mom: <code>7xKX...sU</code>\"";
        if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
        return { success: true, text: msg };
      }
      const lines = entries.map(
        ([name, wallet]) => `  ${name} → <code>${shortWallet(wallet)}</code>`
      );
      const msg = [
        `<b>📇 Your contacts (${entries.length}):</b>`,
        "",
        ...lines,
        "",
        "Use a contact name in transfers: \"Send 10 USDC to Mom\"",
      ].join("\n");
      if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
      return { success: true, text: msg };
    }

    if (/\b(?:delete|remove)\s+contact\b/i.test(lower)) {
      const nameMatch = text.match(/(?:delete|remove)\s+contact\s+(.+)/i);
      const name = nameMatch?.[1]?.trim();
      if (!name) {
        const msg = "⚠️ <b>Please specify a contact name:</b> \"Delete contact Mom\"";
        if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
        return { success: false, text: msg };
      }
      const deleted = deleteContact(entityId, name);
      const msg = deleted
        ? `✅ Contact <b>"${name}"</b> deleted.`
        : `⚠️ No contact named <b>"${name}"</b> found.`;
      if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
      return { success: true, text: msg };
    }

    const saveMatch = text.match(
      /(?:save\s+(?:this\s+)?(?:wallet|contact|address)\s+as|save)\s+(\S+?)[\s:]+([1-9A-HJ-NP-Za-km-z]{32,44})/i
    );
    if (saveMatch) {
      const name = saveMatch[1].replace(/:$/, "");
      const wallet = saveMatch[2];
      if (!isValidReceiverWallet(wallet)) {
        const msg = `⚠️ <code>${shortWallet(wallet)}</code> is not a valid Solana address.`;
        if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
        return { success: false, text: msg };
      }
      saveContact(entityId, name, wallet);
      const msg = `✅ <b>Saved!</b> ${name} → <code>${shortWallet(wallet)}</code>`;
      if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
      return { success: true, text: msg };
    }

    const msg =
      "⚠️ <b>Couldn't understand the contact command.</b>\n\nTry:\n• \"Save wallet as Mom: <code>7xKX...sU</code>\"\n• \"Show my contacts\"\n• \"Delete contact Mom\"";
    if (callback) await callback({ text: msg, actions: ["MANAGE_CONTACTS"], source: message.content.source });
    return { success: false, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Save wallet as Mom: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" } },
      { name: "{{agent}}", content: { text: "✅ Saved! Mom → 7xKX...sU", actions: ["MANAGE_CONTACTS"] } },
    ],
    [
      { name: "{{user}}", content: { text: "Show my contacts" } },
      { name: "{{agent}}", content: { text: "📇 Your contacts...", actions: ["MANAGE_CONTACTS"] } },
    ],
  ],
};
