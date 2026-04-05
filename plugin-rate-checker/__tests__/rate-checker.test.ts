import { describe, expect, it, mock } from "bun:test";
import { checkRemittanceRateAction } from "../src/actions/checkRemittanceRate";

describe("plugin-rate-checker", () => {
  it("computes rate when Jupiter succeeds", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mock(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("price.jup.ag")) {
        const id = new URL(u).searchParams.get("ids") ?? "";
        const price = id.includes("EPjF") ? "1" : "100";
        return {
          ok: true,
          json: async () => ({
            data: { [id]: { price } },
          }),
        } as Response;
      }
      return { ok: false } as Response;
    });

    try {
      const runtime = {
        getSetting: (k: string) => {
          if (k === "JUPITER_PRICE_API_URL") return "https://price.jup.ag/v6";
          if (k === "PYTH_PRICE_SERVICE_URL") return "https://hermes.pyth.network";
          return "";
        },
      } as never;

      const intent = {
        amount: 100,
        sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        targetMint: "So11111111111111111111111111111111111111112",
        targetRail: "SPL_TRANSFER" as const,
        receiverLabel: "Mom",
        receiverWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        confidence: 0.9,
      };

      const res = await checkRemittanceRateAction.handler(
        runtime,
        { content: { text: "x" } } as never,
        { values: { sendflow: { intent } }, text: "", data: {} },
        undefined,
        undefined
      );

      expect(res?.success).toBe(true);
      expect(res?.data?.rate?.provider).toBe("jupiter");
      expect(res?.data?.rate?.sendflowFee).toBeCloseTo(0.5, 5);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("fails when both sources unavailable", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = mock(async () => ({ ok: false }) as Response);
    try {
      const runtime = {
        getSetting: () => "",
      } as never;
      const intent = {
        amount: 1,
        sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        targetMint: "So11111111111111111111111111111111111111112",
        targetRail: "SPL_TRANSFER" as const,
        receiverLabel: "x",
        receiverWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        confidence: 1,
      };
      const res = await checkRemittanceRateAction.handler(
        runtime,
        { content: {} } as never,
        { values: { sendflow: { intent } }, text: "", data: {} },
        undefined,
        undefined
      );
      expect(res?.success).toBe(false);
      expect(String(res?.text)).toMatch(/Could not fetch|Rate unavailable/i);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
