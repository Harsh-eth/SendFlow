import { describe, expect, it } from "bun:test";
import { lockUsdcEscrowAction } from "../src/actions/lockUsdcEscrow";

describe("plugin-usdc-handler", () => {
  it("validate requires confirmed flow + intent", async () => {
    const intent = {
      amount: 1,
      sourceMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      targetMint: "So11111111111111111111111111111111111111112",
      targetRail: "SPL_TRANSFER" as const,
      receiverLabel: "x",
      receiverWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      confidence: 1,
    };

    const noConfirm = await lockUsdcEscrowAction.validate(
      {} as never,
      {} as never,
      { values: { sendflow: { intent } }, text: "", data: {} }
    );
    expect(noConfirm).toBe(false);

    const ok = await lockUsdcEscrowAction.validate(
      {} as never,
      {} as never,
      { values: { sendflow: { intent, flow: { confirmed: true } } }, text: "", data: {} }
    );
    expect(ok).toBe(true);
  });
});
