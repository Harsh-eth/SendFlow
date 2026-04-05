import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getOfframpTierLimits,
  getDailyOfframpTotal,
  addDailyOfframpUsage,
  checkTierLimit,
  logOnRamp,
  checkCooling,
  buildKycLink,
  recordOffRampVelocityAttempt,
  isOfframpVelocityFrozen,
  checkAddressRisk,
  shouldBlockOffRampForChainRisk,
  appendOfframpAudit,
} from "../utils/offrampOracle";

let testDir: string;

beforeEach(async () => {
  testDir = join(process.cwd(), "data", `test_offramp_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  process.env.SENDFLOW_DATA_DIR = testDir;
  delete process.env.OFFRAMP_TIER0_LIMIT;
  delete process.env.OFFRAMP_TIER1_LIMIT;
  delete process.env.OFFRAMP_TIER2_LIMIT;
  delete process.env.CHAINALYSIS_API_KEY;
});

afterEach(async () => {
  delete process.env.SENDFLOW_DATA_DIR;
  delete process.env.CHAINALYSIS_API_KEY;
  await rm(testDir, { recursive: true, force: true });
});

describe("tier limits", () => {
  test("defaults 100 / 500 / 2000", () => {
    const l = getOfframpTierLimits();
    expect(l.tier0).toBe(100);
    expect(l.tier1).toBe(500);
    expect(l.tier2).toBe(2000);
  });

  test("env overrides", () => {
    process.env.OFFRAMP_TIER0_LIMIT = "50";
    process.env.OFFRAMP_TIER1_LIMIT = "200";
    process.env.OFFRAMP_TIER2_LIMIT = "900";
    const l = getOfframpTierLimits();
    expect(l.tier0).toBe(50);
    expect(l.tier1).toBe(200);
    expect(l.tier2).toBe(900);
  });

  test("tier 0: blocks when daily + amount exceeds cap", async () => {
    const uid = "u_t0";
    await addDailyOfframpUsage(uid, 80);
    const r = await checkTierLimit(uid, 30, 0);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("daily_tier_limit");
  });

  test("tier 0: allows under cap", async () => {
    const uid = "u_t0b";
    const r = await checkTierLimit(uid, 50, 0);
    expect(r.allowed).toBe(true);
    expect(r.limitUsd).toBe(100);
  });

  test("tier 1: daily ledger crosses 500", async () => {
    const uid = "u_t1";
    await addDailyOfframpUsage(uid, 400);
    const r = await checkTierLimit(uid, 150, 1);
    expect(r.allowed).toBe(false);
  });

  test("tier 2: allows within 2000", async () => {
    const uid = "u_t2";
    const r = await checkTierLimit(uid, 1999, 2);
    expect(r.allowed).toBe(true);
  });

  test("tier 3: always blocked (manual review)", async () => {
    const r = await checkTierLimit("u_t3", 100, 3);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("tier3_manual_review");
  });
});

describe("cooling window", () => {
  test("blocks when recent on-ramp covers amount within 2h", async () => {
    const uid = "u_cool";
    const recent = Date.now() - 30 * 60 * 1000;
    const path = join(testDir, "onramp-ledger", `${uid}.json`);
    await mkdir(join(testDir, "onramp-ledger"), { recursive: true });
    await writeFile(path, JSON.stringify({ events: [{ ts: recent, amountUsdc: 100 }] }), "utf8");
    const r = await checkCooling(uid, 100);
    expect(r.allowed).toBe(false);
    expect(r.minutesLeft).toBeDefined();
    expect((r.minutesLeft ?? 0) > 0).toBe(true);
  });

  test("allows when on-ramp older than 2h", async () => {
    const uid = "u_cool2";
    const old = Date.now() - 3 * 60 * 60 * 1000;
    const path = join(testDir, "onramp-ledger", `${uid}.json`);
    await mkdir(join(testDir, "onramp-ledger"), { recursive: true });
    await writeFile(path, JSON.stringify({ events: [{ ts: old, amountUsdc: 100 }] }), "utf8");
    const r = await checkCooling(uid, 100);
    expect(r.allowed).toBe(true);
  });

  test("logOnRamp then cooling blocks", async () => {
    const uid = "u_cool3";
    await logOnRamp(uid, 50);
    const r = await checkCooling(uid, 50);
    expect(r.allowed).toBe(false);
  });
});

describe("buildKycLink", () => {
  test("transak includes required query keys", () => {
    process.env.TRANSAK_API_KEY = "pk_test_abc";
    const url = buildKycLink("transak", 1, "user1", 25, "So11111111111111111111111111111111111111112");
    expect(url.startsWith("https://global.transak.com/")).toBe(true);
    expect(url).toContain("apiKey=pk_test_abc");
    expect(url).toContain("network=solana");
    expect(url).toContain("cryptoCurrencyCode=USDC");
    expect(url).toContain("partnerOrderId=user1-");
    expect(url).toContain("isFeeCalculationHidden=true");
  });

  test("moonpay uses MOONPAY_URL and wallet", () => {
    process.env.MOONPAY_URL = "https://buy.moonpay.com";
    const url = buildKycLink("moonpay", 2, "u2", 10, "WALLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL");
    expect(url).toContain("buy.moonpay.com");
    expect(url).toContain("walletAddress=WALLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL");
  });
});

describe("velocity breaker", () => {
  test("attempts 1–5 allowed; 6th trips freeze", async () => {
    const uid = "u_vel";
    for (let i = 0; i < 5; i++) {
      const r = await recordOffRampVelocityAttempt(uid);
      expect(r.allowed).toBe(true);
      expect(r.frozenJustNow).toBe(false);
    }
    const sixth = await recordOffRampVelocityAttempt(uid);
    expect(sixth.allowed).toBe(false);
    expect(sixth.frozenJustNow).toBe(true);
    expect(await isOfframpVelocityFrozen(uid)).toBe(true);
  });

  test("while frozen, new attempts rejected without incrementing trip", async () => {
    const uid = "u_vel2";
    for (let i = 0; i < 6; i++) await recordOffRampVelocityAttempt(uid);
    const again = await recordOffRampVelocityAttempt(uid);
    expect(again.allowed).toBe(false);
    expect(again.frozenJustNow).toBe(false);
  });
});

describe("Chainalysis", () => {
  test("no API key returns low stub", async () => {
    const r = await checkAddressRisk("So11111111111111111111111111111111111111112");
    expect(r.risk).toBe("low");
    expect(r.source).toBe("stub");
  });

  test("shouldBlockOffRampForChainRisk returns true when API returns high", async () => {
    process.env.CHAINALYSIS_API_KEY = "test_key";
    const orig = global.fetch;
    global.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ risk: "high" }),
      }) as Response;
    try {
      const block = await shouldBlockOffRampForChainRisk("u1", "Addr1111111111111111111111111111111111111111");
      expect(block).toBe(true);
    } finally {
      global.fetch = orig;
    }
  });
});

describe("audit ledger", () => {
  test("appends jsonl line", async () => {
    await appendOfframpAudit({
      ts: new Date().toISOString(),
      userId: "a1",
      amountUsdc: 10,
      tier: 1,
      kycStatus: "phone",
      allowed: true,
      reason: "ok",
      chainRisk: "low",
    });
    const p = join(testDir, "audit", "offramp-audit.jsonl");
    const raw = await readFile(p, "utf8");
    const line = raw.trim().split("\n").pop()!;
    const j = JSON.parse(line) as { userId: string; allowed: boolean };
    expect(j.userId).toBe("a1");
    expect(j.allowed).toBe(true);
  });
});

describe("daily ledger path", () => {
  test("getDailyOfframpTotal reads YYYY-MM-DD file", async () => {
    const uid = "ledger_u";
    const d = "2026-04-05";
    await mkdir(join(testDir, "offramp-ledger", uid), { recursive: true });
    await writeFile(join(testDir, "offramp-ledger", uid, `${d}.json`), JSON.stringify({ cumulativeUsdc: 42 }));
    const t = await getDailyOfframpTotal(uid, d);
    expect(t).toBe(42);
  });
});
