import { describe, expect, it, mock } from "bun:test";
import { notifyPartiesAction } from "../src/actions/notifyParties";

describe("plugin-notifier", () => {
  it("validate requires payout + intent", async () => {
    const ok = await notifyPartiesAction.validate(
      {} as never,
      {} as never,
      {
        values: {
          sendflow: {
            intent: { receiverLabel: "Mom" },
            payout: { txHash: "abc" },
          },
        },
        text: "",
        data: {},
      }
    );
    expect(ok).toBe(true);
  });

  it("sends Telegram when token and chats exist", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mock(async () => ({ ok: true, text: async () => "" }) as Response);
    try {
      const runtime = {
        getSetting: (k: string) => {
          if (k === "TELEGRAM_BOT_TOKEN") return "test-token";
          return "";
        },
        logger: { info: () => {} },
      } as never;

      const res = await notifyPartiesAction.handler(
        runtime,
        {
          metadata: { telegram: { chat: { id: 123 } } },
          content: {},
        } as never,
        {
          values: {
            sendflow: {
              intent: {
                receiverLabel: "Mom",
                receiverWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
                amount: 1,
                sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                targetMint: "So11111111111111111111111111111111111111112",
                targetRail: "SPL_TRANSFER",
                confidence: 1,
              },
              payout: {
                txHash: "sig",
                amountSent: 100,
                explorerUrl: "https://solscan.io/tx/sig",
              },
              receiverTelegramId: "999",
            },
          },
          text: "",
          data: {},
        },
        undefined,
        undefined
      );
      expect(res?.success).toBe(true);
      expect(res?.data?.notification?.senderNotified).toBe(true);
      expect(res?.data?.notification?.receiverNotified).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
