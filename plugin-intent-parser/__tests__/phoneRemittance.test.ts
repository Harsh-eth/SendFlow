import { describe, expect, test } from "bun:test";
import { tryExtractPhoneRemittance, normalizePhoneNumber } from "../src/utils/phoneRemittance";

describe("phoneRemittance", () => {
  test("normalizePhoneNumber adds +1 for 10-digit US", () => {
    expect(normalizePhoneNumber("555 123 4567")).toBe("+15551234567");
  });

  test("tryExtractPhoneRemittance finds amount and phone", () => {
    const r = tryExtractPhoneRemittance("Send 12.5 USDC to +44 20 7946 0958");
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(12.5);
    expect(r!.normalizedPhone).toMatch(/^\+/);
  });

  test("skips when Solana address present", () => {
    const r = tryExtractPhoneRemittance(
      "Send 5 USDC to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
    );
    expect(r).toBeNull();
  });
});
