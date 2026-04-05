import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  computeAnomalyScore,
  stepUpIfNeededWithKeyboard,
  freezeAccount,
  unfreezeAccount,
  isFrozen,
  loadProfile,
  type BehaviorProfile,
  type TransferEvent,
} from "../utils/behavioralAuth";
import { behavioralConfirmKeyboard } from "../utils/keyboards";

const baseProfile = (): BehaviorProfile => ({
  avgMessageIntervalMs: 60_000,
  typicalActiveHoursUTC: [10, 11, 12],
  typicalAmounts: [10, 20],
  typicalRecipients: ["Known1111111111111111111111111111111111"],
  sessionCount: 10,
  lastSeenAt: Date.now(),
  lastMessageAt: Date.now(),
  recentHoursUTC: [],
  pendingDormantResume: false,
  lastMessageIntervalMs: 50_000,
});

let testDir: string;

beforeEach(async () => {
  testDir = join(process.cwd(), "data", `test_behavior_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
  process.env.SENDFLOW_DATA_DIR = testDir;
});

afterEach(async () => {
  delete process.env.SENDFLOW_DATA_DIR;
  await rm(testDir, { recursive: true, force: true });
});

describe("computeAnomalyScore triggers", () => {
  test("amount_spike: >3× max typical and >50 USDC", () => {
    const p = baseProfile();
    const ev: TransferEvent = {
      amountUsdc: 200,
      recipientAddress: p.typicalRecipients[0]!,
      utcHour: 10,
      messageIntervalMs: 50_000,
    };
    const r = computeAnomalyScore(p, ev);
    expect(r.triggers).toContain("amount_spike");
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  test("new_recipient: not in list and amount > 20", () => {
    const p = baseProfile();
    const ev: TransferEvent = {
      amountUsdc: 25,
      recipientAddress: "Newwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
      utcHour: 10,
      messageIntervalMs: 50_000,
    };
    const r = computeAnomalyScore(p, ev);
    expect(r.triggers).toContain("new_recipient");
    expect(r.score).toBeGreaterThanOrEqual(25);
  });

  test("off_hours: hour outside typical ±1 with sessionCount > 5", () => {
    const p = baseProfile();
    p.sessionCount = 10;
    p.typicalActiveHoursUTC = [8, 9];
    const ev: TransferEvent = {
      amountUsdc: 5,
      recipientAddress: p.typicalRecipients[0]!,
      utcHour: 15,
      messageIntervalMs: 50_000,
    };
    const r = computeAnomalyScore(p, ev);
    expect(r.triggers).toContain("off_hours");
    expect(r.score).toBeGreaterThanOrEqual(20);
  });

  test("fast_messages: interval < 0.3 × avgMessageIntervalMs", () => {
    const p = baseProfile();
    p.avgMessageIntervalMs = 100_000;
    const ev: TransferEvent = {
      amountUsdc: 5,
      recipientAddress: p.typicalRecipients[0]!,
      utcHour: 10,
      messageIntervalMs: 20_000,
    };
    const r = computeAnomalyScore(p, ev);
    expect(r.triggers).toContain("fast_messages");
    expect(r.score).toBeGreaterThanOrEqual(30);
  });

  test("dormant_resume + amount > 30 reaches high score (≥60 combined)", () => {
    const p = baseProfile();
    p.pendingDormantResume = true;
    p.typicalAmounts = [5, 8];
    p.typicalRecipients = ["R1"];
    const ev: TransferEvent = {
      amountUsdc: 100,
      recipientAddress: "R2",
      utcHour: 3,
      messageIntervalMs: 500,
    };
    const r = computeAnomalyScore(p, ev);
    expect(r.triggers).toContain("dormant_resume");
    expect(r.score).toBeGreaterThanOrEqual(60);
  });
});

describe("stepUpIfNeeded thresholds", () => {
  test("score < 30: proceed", async () => {
    const sent: string[] = [];
    const ctx = {
      chatId: "1",
      sendHtml: async (h: string) => {
        sent.push(h);
      },
      sendKeyboard: async (h: string, _k: unknown) => {
        sent.push(h);
      },
    };
    const r = await stepUpIfNeededWithKeyboard("u1", { score: 10, triggers: [] }, ctx, behavioralConfirmKeyboard);
    expect(r).toEqual({ proceed: true });
    expect(sent.length).toBe(0);
  });

  test("score 30–59: inline pending", async () => {
    const sent: string[] = [];
    const ctx = {
      chatId: "1",
      sendHtml: async (h: string) => {
        sent.push(h);
      },
      sendKeyboard: async (h: string, _k: unknown) => {
        sent.push(h);
      },
    };
    const r = await stepUpIfNeededWithKeyboard("u1", { score: 45, triggers: ["x"] }, ctx, behavioralConfirmKeyboard);
    expect(r.proceed).toBe(false);
    if (r.proceed === false && r.kind === "inline") {
      expect(r.pendingId.length).toBeGreaterThan(0);
      expect(r.expiresAt).toBeGreaterThan(Date.now());
    } else {
      expect(true).toBe(false);
    }
    expect(sent.length).toBe(1);
  });

  test("score ≥ 60: PIN step-up", async () => {
    const ctx = {
      chatId: "1",
      sendHtml: async () => {},
      sendKeyboard: async () => {},
    };
    const r = await stepUpIfNeededWithKeyboard("u1", { score: 60, triggers: ["dormant_resume"] }, ctx, behavioralConfirmKeyboard);
    expect(r).toEqual({ proceed: false, kind: "pin" });
  });
});

describe("freeze / unfreeze", () => {
  test("freeze then block path; unfreeze clears", async () => {
    const uid = "user_freeze_test";
    await freezeAccount(uid);
    expect(await isFrozen(uid)).toBe(true);
    await unfreezeAccount(uid);
    expect(await isFrozen(uid)).toBe(false);
  });
});

describe("loadProfile default", () => {
  test("missing file returns defaults with arrays", async () => {
    const p = await loadProfile("brand_new_user_xyz");
    expect(p.avgMessageIntervalMs).toBe(60_000);
    expect(Array.isArray(p.typicalActiveHoursUTC)).toBe(true);
  });
});
