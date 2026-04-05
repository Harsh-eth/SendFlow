import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateSavings,
  appendSavingsLedgerEntry,
  getLifetimeSavingsAsync,
  initSavingsPlatformAggregates,
  getPlatformSavingsSync,
  consumeSavingsMilestones,
  __resetSavingsEngineForTests,
  updateCachedSolPriceUsd,
} from "../src/utils/savingsEngine";
import { setUserLanguage } from "../src/utils/i18n";

describe("savingsEngine", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    __resetSavingsEngineForTests();
    tmpRoot = await mkdtemp(join(tmpdir(), "sf-save-"));
    process.env.SENDFLOW_DATA_DIR = tmpRoot;
    delete process.env.SOL_PRICE_USD;
    updateCachedSolPriceUsd(150);
  });

  afterEach(async () => {
    __resetSavingsEngineForTests();
    delete process.env.SENDFLOW_DATA_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("calculateSavings $10 with 5000 lamports @ SOL 150", () => {
    const r = calculateSavings(10, 5000, { language: "en" });
    expect(r.sendflowFeeUsd).toBe(0.0008);
    expect(r.westernUnionFeeUsd).toBeCloseTo(0.65, 4);
    expect(r.moneygramFeeUsd).toBeCloseTo(0.55, 4);
    expect(r.savingVsWU).toBeCloseTo(0.65, 2);
    expect(r.savingPercent).toBeGreaterThan(99);
  });

  test("calculateSavings $100 with 10000 lamports", () => {
    const r = calculateSavings(100, 10_000, { language: "en" });
    expect(r.westernUnionFeeUsd).toBe(6.5);
    expect(r.moneygramFeeUsd).toBe(5.5);
    expect(r.sendflowFeeUsd).toBeCloseTo(0.0015, 6);
  });

  test("calculateSavings $500 with 20000 lamports", () => {
    const r = calculateSavings(500, 20_000, { language: "en" });
    expect(r.westernUnionFeeUsd).toBe(32.5);
    expect(r.moneygramFeeUsd).toBe(27.5);
  });

  test("humanMessage tier by savingVsWU (mocked via amount)", () => {
    const low = calculateSavings(0.5, 1, { language: "en" });
    expect(low.humanMessage).toContain("chai");
    const mid = calculateSavings(300, 5000, { language: "en" });
    expect(mid.humanMessage).toContain("school lunches");
    const high = calculateSavings(5000, 5000, { language: "en" });
    expect(high.humanMessage).toContain("life-changing");
  });

  test("PH region uses Manila line for mid tier", () => {
    const r = calculateSavings(200, 5000, {
      language: "en",
      recipientLabel: "cousin in Manila",
    });
    expect(r.humanMessage).toContain("Manila");
  });

  test("lifetime aggregation and platform sync", async () => {
    await appendSavingsLedgerEntry("u1", {
      ts: new Date().toISOString(),
      amountUsdc: 10,
      savedVsWU: 0.5,
      txSig: "a",
    });
    await appendSavingsLedgerEntry("u2", {
      ts: new Date().toISOString(),
      amountUsdc: 20,
      savedVsWU: 1.2,
      txSig: "b",
    });
    await initSavingsPlatformAggregates();
    const p = getPlatformSavingsSync();
    expect(p.totalSavedUsd).toBeCloseTo(1.7, 2);
    expect(p.totalTransfers).toBe(2);
    expect(p.totalVolumeUsdc).toBe(30);
    const l1 = await getLifetimeSavingsAsync("u1");
    expect(l1.transferCount).toBe(1);
    expect(l1.totalSavedUsd).toBe(0.5);
  });

  test("milestone fires once per threshold", async () => {
    setUserLanguage("u9", "en");
    await appendSavingsLedgerEntry("u9", {
      ts: new Date().toISOString(),
      amountUsdc: 100,
      savedVsWU: 12,
      txSig: "s1",
    });
    const first = await consumeSavingsMilestones("u9", "TestBot");
    expect(first.length).toBe(1);
    expect(first[0]).toContain("$10");
    const second = await consumeSavingsMilestones("u9", "TestBot");
    expect(second.length).toBe(0);
  });

  test("single transfer can unlock multiple milestones in one consume", async () => {
    setUserLanguage("u8", "en");
    await appendSavingsLedgerEntry("u8", {
      ts: new Date().toISOString(),
      amountUsdc: 2000,
      savedVsWU: 75,
      txSig: "big",
    });
    const ms = await consumeSavingsMilestones("u8", "BotX");
    expect(ms.length).toBe(2);
    expect(ms[0]).toContain("$10");
    expect(ms[1]).toContain("$50");
    const again = await consumeSavingsMilestones("u8", "BotX");
    expect(again.length).toBe(0);
  });
});
