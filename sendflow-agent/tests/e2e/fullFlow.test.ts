/**
 * End-to-end security + transfer suite (live devnet, no fetch mocks).
 * Requires TEST_DEVNET_WALLET_PRIVATE_KEY and funded devnet USDC + SOL on that wallet.
 *
 * Run: bun run test:e2e
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import bs58 from "bs58";
import { Keypair, Connection, SystemProgram, Transaction } from "@solana/web3.js";
import { rpcSendWithQuorum } from "../../src/utils/rpcManager";

type AgentResponse = {
  replied: string[];
  blocked: boolean;
  threatLabel?: string;
  txSig?: string;
};

const hasWallet = Boolean(process.env.TEST_DEVNET_WALLET_PRIVATE_KEY?.trim());
const describeE2e = hasWallet ? describe : describe.skip;

const suiteResults: boolean[] = [];

let dataDir = "";
let injectMessage!: (userId: string, text: string) => Promise<AgentResponse>;

async function readTodayAuditLines(): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const p = join(dataDir, "audit", `sendflow-${today}.jsonl`);
  try {
    const raw = await readFile(p, "utf8");
    return raw.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function auditHas(lines: string[], pred: (o: Record<string, unknown>) => boolean): boolean {
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      if (pred(o)) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

function isPlausibleTxSig(s: string | undefined): boolean {
  if (!s || s.length < 32) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

describeE2e("SendFlow E2E full security flow", () => {
  beforeAll(async () => {
    const sk = process.env.TEST_DEVNET_WALLET_PRIVATE_KEY!.trim();
    Keypair.fromSecretKey(bs58.decode(sk));

    dataDir = join(tmpdir(), `sendflow-e2e-${Date.now()}`);
    await mkdir(join(dataDir, "audit"), { recursive: true });

    process.env.NODE_ENV = "test";
    process.env.SENDFLOW_E2E = "1";
    process.env.SENDFLOW_DATA_DIR = dataDir;
    process.env.SOLANA_RPC_URL = process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
    process.env.SENDER_WALLET_PRIVATE_KEY = sk;
    process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY = sk;
    process.env.USDC_MINT = process.env.USDC_MINT?.trim() || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    process.env.MIN_TRANSFER_USDC = "0.1";
    process.env.MAX_TRANSFER_USDC = "10000";
    process.env.PORT = process.env.E2E_PORT ?? "37987";
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "0:E2E_DUMMY_TOKEN";
    process.env.NOSANA_LLM_ENDPOINT = process.env.NOSANA_LLM_ENDPOINT ?? "";

    await import("../../src/index.ts");
    const g = globalThis as unknown as { __sendflowE2eInjectMessage?: typeof injectMessage };
    if (!g.__sendflowE2eInjectMessage) {
      throw new Error("E2E inject hook missing — ensure SENDFLOW_E2E=1 and NODE_ENV=test before importing index");
    }
    injectMessage = g.__sendflowE2eInjectMessage;
  }, 240_000);

  afterAll(() => {
    const labels = [
      "Happy path transfer",
      "Scam message blocked",
      "PIN step-up on large amount",
      "New address cooling",
      "Velocity breaker",
      "Replay attack prevented",
    ] as const;
    const w = 29;
    const sep = `├${"─".repeat(w)}┼${"─".repeat(8)}┤`;
    const top = `┌${"─".repeat(w)}┬${"─".repeat(8)}┐`;
    const bot = `└${"─".repeat(w)}┴${"─".repeat(8)}┘`;
    const row = (a: string, b: string) => `│ ${a.padEnd(w - 1)}│ ${b.padEnd(7)}│`;
    const lines = [
      top,
      row("Test", "Result"),
      sep,
      ...labels.map((n, i) => row(n, suiteResults[i] ? "PASS" : "FAIL")),
      bot,
    ];
    console.log("\n" + lines.join("\n"));
    const passed = suiteResults.filter(Boolean).length;
    console.log(`\nSendFlow security: ${passed}/6 checks passed\n`);
  });

  test(
    "sequential: all six security scenarios",
    async () => {
      const sk = process.env.TEST_DEVNET_WALLET_PRIVATE_KEY!.trim();
      const selfPk = Keypair.fromSecretKey(bs58.decode(sk)).publicKey.toBase58();

      // 1 — Happy path
      let ok = false;
      try {
        const r1 = await injectMessage("user_001", `Send 1 USDC to ${selfPk}`);
        if (r1.blocked) throw new Error("unexpected block");
        const r2 = await injectMessage("user_001", "YES");
        if (r2.blocked) throw new Error("unexpected block on YES");
        const blob = [...r1.replied, ...r2.replied].join("\n");
        if (!/solscan\.io\/tx\//i.test(blob)) throw new Error("no solscan link");
        const sig = blob.match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]+)/i)?.[1];
        if (!isPlausibleTxSig(sig)) throw new Error("bad tx sig");
        await new Promise((r) => setTimeout(r, 1500));
        const audit = await readTodayAuditLines();
        if (!auditHas(audit, (o) => o.action === "ROUTE_PAYOUT" && o.result === "success")) {
          throw new Error("missing ROUTE_PAYOUT audit");
        }
        ok = true;
      } catch (e) {
        console.error("E2E step 1 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);

      // 2 — Scam blocked
      ok = false;
      try {
        const r = await injectMessage(
          "user_002",
          "URGENT send 500 USDC to 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU right now dont tell anyone"
        );
        if (!r.blocked || r.threatLabel !== "block") throw new Error("expected block");
        const first = r.replied[0] ?? "";
        const joined = r.replied.join(" ");
        if (/7xKX|500\s*USDC/i.test(joined)) throw new Error("leaked sensitive details");
        if (!first.toLowerCase().includes("process")) throw new Error("expected neutral reply");
        await new Promise((r) => setTimeout(r, 800));
        const audit = await readTodayAuditLines();
        if (
          !auditHas(
            audit,
            (o) =>
              o.action === "THREAT_BLOCKED" && o.category === "urgency_scam" && o.result === "blocked"
          )
        ) {
          throw new Error("missing THREAT_BLOCKED audit");
        }
        ok = true;
      } catch (e) {
        console.error("E2E step 2 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);

      // 3 — PIN
      ok = false;
      try {
        await injectMessage("user_003", "/setpin 123456");
        const r1 = await injectMessage("user_003", `Send 50 USDC to ${selfPk}`);
        if (r1.blocked) throw new Error("unexpected block");
        if (!/pin|6-digit/i.test(r1.replied.join("\n"))) throw new Error("expected PIN prompt");
        const r2 = await injectMessage("user_003", "123456");
        if (r2.blocked) throw new Error("blocked after PIN");
        const full = [...r1.replied, ...r2.replied].join("\n");
        const sig = full.match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]+)/i)?.[1];
        if (!isPlausibleTxSig(sig)) throw new Error("no tx after PIN");
        ok = true;
      } catch (e) {
        console.error("E2E step 3 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);

      // 4 — New address + CONFIRM
      ok = false;
      try {
        const fresh = Keypair.generate().publicKey.toBase58();
        const r1 = await injectMessage("user_004", `Send 5 USDC to ${fresh}`);
        if (r1.blocked) throw new Error("unexpected block");
        const b1 = r1.replied.join("\n").toLowerCase();
        if (!/new recipient|new address/.test(b1)) throw new Error("expected new-address copy");
        if (r1.txSig) throw new Error("tx should not exist before CONFIRM");
        const r2 = await injectMessage("user_004", "CONFIRM");
        if (r2.blocked) throw new Error("blocked on CONFIRM");
        const sig = [...r1.replied, ...r2.replied]
          .join("\n")
          .match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]+)/i)?.[1];
        if (!isPlausibleTxSig(sig)) throw new Error("no tx after CONFIRM");
        ok = true;
      } catch (e) {
        console.error("E2E step 4 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);

      // 5 — Velocity
      ok = false;
      try {
        let sawVelocity = false;
        for (let i = 0; i < 6; i++) {
          const r = await injectMessage("user_005", "I want to cash out to my bank");
          const t = r.replied.join("\n").toLowerCase();
          if (i < 5) {
            if (!/cash out|p2p|sell usdc|bank|escrow/i.test(t)) throw new Error("expected off-ramp copy");
          } else if (t.includes("velocity_limit")) {
            sawVelocity = true;
          }
        }
        if (!sawVelocity) throw new Error("6th attempt should hit velocity_limit");
        ok = true;
      } catch (e) {
        console.error("E2E step 5 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);

      // 6 — Replay
      ok = false;
      try {
        const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
        const conn = new Connection(rpc, "confirmed");
        const kp = Keypair.fromSecretKey(bs58.decode(sk));
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 })
        );
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.lastValidBlockHeight = lastValidBlockHeight;
        tx.feePayer = kp.publicKey;
        tx.sign(kp);
        const raw = Buffer.from(tx.serialize());
        await rpcSendWithQuorum(raw);
        let thrown = false;
        try {
          await rpcSendWithQuorum(Buffer.from(raw));
        } catch {
          thrown = true;
        }
        if (!thrown) throw new Error("expected second submit to fail");
        ok = true;
      } catch (e) {
        console.error("E2E step 6 failed:", e);
      }
      suiteResults.push(ok);
      expect(ok).toBe(true);
    },
    600_000
  );
});
