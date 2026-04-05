import {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { loggerCompat as logger } from "../utils/structuredLogger";
import { extractSolanaAddress, isValidReceiverWallet } from "../utils/solanaAddress";
import { resolveSolDomain } from "../utils/resolveDomain";
import { getContact } from "../utils/contactBook";
import {
  addSchedule,
  cancelScheduleByLabel,
  listSchedules,
  type RecurringTransfer,
} from "../utils/scheduler";
import { shortWallet } from "../utils/format";

const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function extractAmount(text: string): number | undefined {
  const m = text.match(/\b([0-9]+(?:\.[0-9]{1,6})?)\s*USDC\b/i);
  return m ? Number(m[1]) : undefined;
}

function extractReceiver(text: string): string | undefined {
  const toMatch = text.match(/\bto\s+(\S+)/i);
  return toMatch?.[1];
}

function extractFrequency(text: string): {
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek?: number;
  dayOfMonth?: number;
} | null {
  const lower = text.toLowerCase();
  if (/\bevery\s+day\b|\bdaily\b/.test(lower)) return { frequency: "daily" };

  const weekdayMatch = lower.match(
    /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/
  );
  if (weekdayMatch) {
    const days: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    return { frequency: "weekly", dayOfWeek: days[weekdayMatch[1]] };
  }

  if (/\bweekly\b/.test(lower)) return { frequency: "weekly" };

  const monthDayMatch = lower.match(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+(?:the\s+)?)?month\b/);
  if (monthDayMatch) return { frequency: "monthly", dayOfMonth: Number(monthDayMatch[1]) };

  if (/\bmonthly\b|\bevery\s+month\b/.test(lower)) return { frequency: "monthly", dayOfMonth: 1 };

  return null;
}

function computeFirstRun(freq: { frequency: string; dayOfWeek?: number; dayOfMonth?: number }): Date {
  const now = new Date();
  switch (freq.frequency) {
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly": {
      const target = freq.dayOfWeek ?? now.getDay();
      const daysAhead = (target - now.getDay() + 7) % 7 || 7;
      const next = new Date(now);
      next.setDate(next.getDate() + daysAhead);
      next.setHours(9, 0, 0, 0);
      return next;
    }
    case "monthly": {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      if (freq.dayOfMonth) next.setDate(freq.dayOfMonth);
      next.setHours(9, 0, 0, 0);
      return next;
    }
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

export const scheduleTransferAction: Action = {
  name: "SCHEDULE_TRANSFER",
  similes: ["RECURRING_TRANSFER", "AUTO_SEND", "SETUP_SCHEDULE", "CANCEL_SCHEDULE", "MY_SCHEDULES"],
  description: "Schedule automatic recurring USDC transfers.",
  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    const text = (message?.content?.text ?? "").trim().toLowerCase();
    return /\b(?:every\s+\w+|recurring|schedule|weekly|monthly|daily|cancel\s+recurring|my\s+schedules|show\s+schedules)\b/.test(text);
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

    if (/\b(?:my\s+schedules|show\s+schedules|list\s+schedules)\b/.test(lower)) {
      const schedules = listSchedules(entityId);
      if (schedules.length === 0) {
        const msg =
          "📅 <b>No active recurring transfers.</b>\n\nTry: \"Send 100 USDC to Mom every 1st of the month\"";
        if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
        return { success: true, text: msg };
      }
      const lines = schedules.map((s) => {
        const next = s.nextRunAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `  <b>${s.intent.amount} USDC</b> → ${s.intent.receiverLabel} (<code>${shortWallet(s.intent.receiverWallet)}</code>) | ${s.frequency} | <b>Next:</b> ${next}`;
      });
      const msg = [`<b>📅 Your recurring transfers (${schedules.length}/5):</b>`, "", ...lines].join("\n");
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: true, text: msg };
    }

    if (/\bcancel\s+(?:recurring|schedule)\b/.test(lower)) {
      const labelMatch = text.match(/cancel\s+(?:recurring|schedule)\s+(?:transfer\s+)?(?:to\s+)?(.+)/i);
      const label = labelMatch?.[1]?.trim() ?? "";
      if (!label) {
        const msg =
          "⚠️ <b>Specify which schedule to cancel:</b> \"Cancel recurring transfer to Mom\"";
        if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
        return { success: false, text: msg };
      }
      const cancelled = cancelScheduleByLabel(entityId, label);
      const msg = cancelled
        ? `✅ <b>Recurring transfer to ${label} cancelled.</b>`
        : `⚠️ No active recurring transfer to <b>"${label}"</b> found.`;
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: true, text: msg };
    }

    const amount = extractAmount(text);
    if (!amount) {
      const msg =
        "⚠️ <b>Please include a USDC amount.</b> Example: \"Send 100 USDC to Mom every Monday\"";
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const freq = extractFrequency(text);
    if (!freq) {
      const msg =
        "⚠️ <b>Couldn't parse frequency.</b> Use: daily, weekly, every Monday, monthly, every 1st of month";
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const rawReceiver = extractReceiver(text);
    if (!rawReceiver) {
      const msg =
        "⚠️ <b>Please specify a recipient.</b> Example: \"Send 100 USDC to Mom every Monday\"";
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    let receiverWallet = rawReceiver;
    let receiverLabel = rawReceiver;

    const contactWallet = getContact(entityId, rawReceiver);
    if (contactWallet) {
      receiverWallet = contactWallet;
      receiverLabel = rawReceiver;
    } else if (rawReceiver.endsWith(".sol")) {
      const rpcUrl = (() => {
        const v = runtime.getSetting("SOLANA_RPC_URL");
        return typeof v === "string" && v ? v : "https://api.mainnet-beta.solana.com";
      })();
      try {
        receiverWallet = await resolveSolDomain(rawReceiver, rpcUrl);
        receiverLabel = rawReceiver;
      } catch {
        const msg = `⚠️ <b>Could not resolve</b> ${rawReceiver}`;
        if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
        return { success: false, text: msg };
      }
    } else {
      const addr = extractSolanaAddress(rawReceiver);
      if (addr) receiverWallet = addr;
    }

    if (!isValidReceiverWallet(receiverWallet)) {
      const msg = `⚠️ <b>Invalid recipient:</b> "${rawReceiver}". Use a wallet address, .sol domain, or saved contact name.`;
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const nextRunAt = computeFirstRun(freq);
    const result = addSchedule({
      userId: entityId,
      intent: {
        amount,
        sourceMint: USDC_MAINNET,
        targetMint: USDC_MAINNET,
        targetRail: "SPL_TRANSFER",
        receiverLabel,
        receiverWallet,
        confidence: 1.0,
      },
      frequency: freq.frequency,
      dayOfWeek: freq.dayOfWeek,
      dayOfMonth: freq.dayOfMonth,
      nextRunAt,
    });

    if (!result.success) {
      const msg = `⚠️ <b>${result.error}</b>`;
      if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
      return { success: false, text: msg };
    }

    const nextDate = nextRunAt.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    const msg = [
      `🔄 <b>Recurring Transfer Scheduled!</b>`,
      ``,
      `💸 <b>${amount} USDC</b> → ${receiverLabel} (<code>${shortWallet(receiverWallet)}</code>)`,
      `📅 <b>Frequency:</b> ${freq.frequency}`,
      `⏰ <b>Next transfer:</b> ${nextDate}`,
      ``,
      `Use "Cancel recurring transfer to ${receiverLabel}" to stop.`,
      `Use "Show my schedules" to see all.`,
    ].join("\n");

    if (callback) await callback({ text: msg, actions: ["SCHEDULE_TRANSFER"], source: message.content.source });
    logger.info(`SCHEDULE: Set ${freq.frequency} ${amount} USDC → ${receiverLabel} for ${entityId}`);

    return { success: true, text: msg };
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Send 100 USDC to Mom every 1st of the month" } },
      { name: "{{agent}}", content: { text: "🔄 Recurring Transfer Scheduled!...", actions: ["SCHEDULE_TRANSFER"] } },
    ],
  ],
};
