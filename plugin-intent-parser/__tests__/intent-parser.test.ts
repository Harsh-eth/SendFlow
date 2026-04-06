import { describe, expect, it } from "bun:test";
import { parseRemittanceIntentAction } from "../src/actions/parseRemittanceIntent";
import { parseSplitIntentAction } from "../src/actions/parseSplitIntent";

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
  const wallet = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

  it("validates only when amount and concrete destination are present", async () => {
    const ok = await parseRemittanceIntentAction.validate({} as never, {
      entityId: "t1",
      content: { text: `Send 10 USDC to ${wallet}` },
    } as never);
    expect(ok).toBe(true);
  });

  it("does not validate vague recipient without address", async () => {
    const ok = await parseRemittanceIntentAction.validate({} as never, {
      entityId: "t1",
      content: { text: "I want to send USDC to my friend" },
    } as never);
    expect(ok).toBe(false);
  });

  it("does not validate buy-usdc P2P phrasing as remittance", async () => {
    const ok = await parseRemittanceIntentAction.validate({} as never, {
      entityId: "t1",
      content: { text: "Buy 50 USDC with INR" },
    } as never);
    expect(ok).toBe(false);
  });

  it("PARSE_SPLIT_INTENT validates only with amount and 2+ recipients", async () => {
    expect(
      await parseSplitIntentAction.validate({} as never, { content: { text: "split some usdc" } } as never)
    ).toBe(false);
    expect(
      await parseSplitIntentAction.validate({} as never, {
        content: { text: "Split 90 USDC equally between raj.sol, mike.sol and sara.sol" },
      } as never)
    ).toBe(true);
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
