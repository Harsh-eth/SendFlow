import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  parseSplTransfers,
  buildAllowedPrograms,
  assertSignatureNotReplay,
  recordSubmittedSignature,
} from "@sendflow/plugin-intent-parser";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function transferData(amountRaw: bigint): string {
  const b = Buffer.alloc(9);
  b.writeUInt8(3, 0);
  b.writeBigUInt64LE(amountRaw, 1);
  return b.toString("base64");
}

describe("parseSplTransfers", () => {
  test("parses token transfer from simulation-shaped instructions", () => {
    const a = Keypair.generate().publicKey;
    const srcAta = Keypair.generate().publicKey;
    const dstAta = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const tokenProg = new PublicKey(TOKEN);
    const keys = [a, srcAta, dstAta, owner, tokenProg];
    const ix = {
      programIdIndex: 4,
      accounts: [1, 2, 3],
      data: transferData(1_500_000n),
    };
    const raw = parseSplTransfers(keys, [ix]);
    expect(raw.length).toBe(1);
    expect(raw[0]!.from).toBe(srcAta.toBase58());
    expect(raw[0]!.to).toBe(dstAta.toBase58());
    expect(raw[0]!.amountRaw).toBe(1_500_000n);
  });
});

describe("buildAllowedPrograms", () => {
  test("includes Jupiter id when provided", () => {
    const j = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    const s = buildAllowedPrograms(j);
    expect(s.has(j)).toBe(true);
    expect(s.has(TOKEN)).toBe(true);
  });
});

describe("replay guard", () => {
  const orig = process.env.SENDFLOW_DATA_DIR;
  beforeEach(() => {
    process.env.SENDFLOW_DATA_DIR = `/tmp/sendflow-tx-test-${Date.now()}`;
  });
  afterEach(() => {
    process.env.SENDFLOW_DATA_DIR = orig;
  });

  test("replay attempt fails", async () => {
    const uid = "u_replay_test";
    const sig = "5".repeat(80);
    await recordSubmittedSignature(uid, sig);
    await expect(assertSignatureNotReplay(uid, sig)).rejects.toThrow(/replay/);
  });
});
