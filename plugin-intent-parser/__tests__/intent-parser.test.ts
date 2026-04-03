import { describe, expect, it } from "bun:test";
import { parseRemittanceIntentAction } from "../src/actions/parseRemittanceIntent";

describe("plugin-intent-parser", () => {
  it("validates messages with text", async () => {
    const ok = await parseRemittanceIntentAction.validate(
      {} as never,
      { content: { text: "Send 10 USDC to x" } } as never
    );
    expect(ok).toBe(true);
  });

  it("parses deterministic message when LLM unavailable", async () => {
    const wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    const runtime = {
      useModel: async () => {
        throw new Error("model unavailable");
      },
    } as never;

    const res = await parseRemittanceIntentAction.handler(
      runtime,
      {
        content: { text: `Send 100 USDC to my mom at ${wallet}` },
      } as never,
      undefined,
      undefined,
      undefined
    );

    expect(res?.success).toBe(true);
    expect(res?.data?.intent.amount).toBe(100);
    expect(res?.data?.intent.receiverWallet).toBe(wallet);
    expect(res?.values?.sendflow?.intent.receiverWallet).toBe(wallet);
  });

  it("fails when no valid wallet can be resolved", async () => {
    const runtime = { useModel: async () => ({}) } as never;
    const res = await parseRemittanceIntentAction.handler(
      runtime,
      {
        content: {
          text: "Send 10 USDC to not_a_wallet",
        },
      } as never,
      undefined,
      undefined,
      undefined
    );
    expect(res?.success).toBe(false);
    expect(String(res?.text ?? "")).toMatch(/Could not parse|valid Solana/i);
  });
});
