import { describe, expect, it } from "bun:test";
import { routePayoutAction } from "../src/actions/routePayout";

describe("plugin-payout-router", () => {
  it("validate requires usdc + intent", async () => {
    const intent = {
      amount: 1,
      sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      targetMint: "So11111111111111111111111111111111111111112",
      targetRail: "SPL_TRANSFER" as const,
      receiverLabel: "x",
      receiverWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      confidence: 1,
    };
    const bad = await routePayoutAction.validate(
      {} as never,
      {} as never,
      { values: { sendflow: { intent } }, text: "", data: {} }
    );
    expect(bad).toBe(false);

    const ok = await routePayoutAction.validate(
      {} as never,
      {} as never,
      {
        values: { sendflow: { intent, usdc: { amountLocked: 1 } } },
        text: "",
        data: {},
      }
    );
    expect(ok).toBe(true);
  });
});
