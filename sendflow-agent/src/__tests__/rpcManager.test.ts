import { describe, expect, test, beforeEach } from "bun:test";
import { Connection } from "@solana/web3.js";
import {
  pickQuorumSignature,
  clampSwapSlippageForStable,
  __resetRpcManagerTestState,
  __recordWriteFailureForTest,
  isRpcCircuitOpen,
  type QuorumRow,
} from "../utils/rpcManager";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("pickQuorumSignature", () => {
  test("two matching signatures win (quorum agreement)", () => {
    const rows: QuorumRow[] = [
      { url: "a", sig: "SAME" },
      { url: "b", sig: "SAME" },
      { url: "c", err: "x" },
    ];
    const r = pickQuorumSignature(rows);
    expect(r?.signature).toBe("SAME");
    expect(r?.singleRpcWarning).toBe(false);
  });

  test("quorum disagreement — two different sigs yields first with single_rpc warning", () => {
    const rows: QuorumRow[] = [
      { url: "a", sig: "SIG_A" },
      { url: "b", sig: "SIG_B" },
    ];
    const r = pickQuorumSignature(rows);
    expect(["SIG_A", "SIG_B"]).toContain(r?.signature);
    expect(r?.singleRpcWarning).toBe(true);
  });

  test("all fail returns null", () => {
    expect(pickQuorumSignature([{ url: "a", err: "e" }])).toBeNull();
  });
});

describe("clampSwapSlippageForStable", () => {
  test("caps USDC leg at 50 bps (0.5%)", () => {
    expect(clampSwapSlippageForStable(USDC, "So11111111111111111111111111111111111111112", 200)).toBe(50);
  });

  test("leaves non-USDC pair unchanged", () => {
    expect(
      clampSwapSlippageForStable(
        "So11111111111111111111111111111111111111112",
        "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        150
      )
    ).toBe(150);
  });
});

describe("circuit breaker", () => {
  beforeEach(() => {
    __resetRpcManagerTestState();
  });

  test("opens after 4 consecutive write failures", () => {
    expect(isRpcCircuitOpen()).toBe(false);
    __recordWriteFailureForTest();
    __recordWriteFailureForTest();
    __recordWriteFailureForTest();
    expect(isRpcCircuitOpen()).toBe(false);
    __recordWriteFailureForTest();
    expect(isRpcCircuitOpen()).toBe(true);
  });
});

describe("getPriorityFeeMicroLamports (mock RPC)", () => {
  test("returns positive micro-lamports from mocked prioritization fees", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("getRecentPrioritizationFees")) {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            result: Array.from({ length: 20 }, (_, i) => ({
              slot: 1000 + i,
              prioritizationFee: 10_000 + i * 500,
            })),
            id: 1,
          }),
          { status: 200 }
        );
      }
      return orig(input as string, init);
    };
    try {
      const { getPriorityFeeMicroLamports } = await import("../utils/rpcManager");
      const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const fee = await getPriorityFeeMicroLamports(conn);
      expect(typeof fee).toBe("number");
      expect(fee).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
