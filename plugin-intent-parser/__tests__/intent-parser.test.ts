import { describe, expect, it } from "bun:test";
import { parseRemittanceIntentAction } from "../src/actions/parseRemittanceIntent";

function elizaGetSetting(key: string): string | undefined {
  if (key === "MIN_TRANSFER_USDC") return "0.1";
  if (key === "MAX_TRANSFER_USDC") return "10000";
  return undefined;
}

const mockRuntime = {
  useModel: async () => {
    throw new Error("model unavailable");
  },
  getSetting: elizaGetSetting,
} as never;

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

    const res = await parseRemittanceIntentAction.handler(
      mockRuntime,
      {
        entityId: "test-parse-deterministic",
        roomId: "room-1",
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
    const runtime = {
      useModel: async () => ({}),
      getSetting: elizaGetSetting,
    } as never;
    const res = await parseRemittanceIntentAction.handler(
      runtime,
      {
        entityId: "test-parse-invalid-wallet",
        roomId: "room-2",
        content: {
          text: "Send 10 USDC to not_a_wallet",
        },
      } as never,
      undefined,
      undefined,
      undefined
    );
    expect(res?.success).toBe(false);
    expect(String(res?.text ?? "")).toMatch(/Couldn't parse|Could not parse|valid Solana|Invalid wallet/i);
  });
});
