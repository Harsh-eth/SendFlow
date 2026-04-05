import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Connection } from "@solana/web3.js";
import {
  runWelcomeOnboarding,
  hasTransferIntentKeywords,
  __resetOnboardingFlowForTests,
} from "../utils/onboardingFlow";
import { hasCompletedWelcomeOnboarding, __resetWelcomeOnboardingForTests } from "../utils/userRegistry";
import { detectOnboardingLocale, onboardingWelcomeBody } from "../utils/i18n";
import { getReferrerOf } from "../utils/referralSystem";
import { __resetMetricsStateForTests } from "../utils/metricsState";

describe("onboardingFlow", () => {
  let testDir: string;
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  beforeEach(() => {
    testDir = join(tmpdir(), `sf-ob-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.SENDFLOW_DATA_DIR = testDir;
    process.env.DEMO_ESCROW_WALLET_PRIVATE_KEY = "";
    __resetWelcomeOnboardingForTests();
    __resetOnboardingFlowForTests();
    __resetMetricsStateForTests();
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("hasTransferIntentKeywords detects send/pay/transfer/request/invoice", () => {
    expect(hasTransferIntentKeywords("Send 5 USDC to raj.sol")).toBe(true);
    expect(hasTransferIntentKeywords("please pay 10 usdc")).toBe(true);
    expect(hasTransferIntentKeywords("invoice for 20")).toBe(true);
    expect(hasTransferIntentKeywords("hi there")).toBe(false);
  });

  test('new user "hi" gets welcome and keyboard', async () => {
    const html: string[] = [];
    const keyboards: string[] = [];
    let reprocessCalls = 0;
    await runWelcomeOnboarding({
      userId: "u_hi_1",
      chatId: "1",
      originalText: "hi",
      metadata: {},
      sendHtml: async (_c, h) => {
        html.push(h);
      },
      sendKeyboard: async (_c, h) => {
        keyboards.push(h);
      },
      connection,
      reprocess: async () => {
        reprocessCalls++;
        return { success: true, text: "x" };
      },
    });
    expect(reprocessCalls).toBe(0);
    expect(html.length).toBe(1);
    expect(html[0]).toContain("Welcome to SendFlow");
    expect(html[0]).toMatch(/<code>.+<\/code>/);
    await new Promise((r) => setTimeout(r, 1300));
    expect(keyboards.length).toBe(1);
    expect(keyboards[0]).toContain("What do you want to do");
    expect(hasCompletedWelcomeOnboarding("u_hi_1")).toBe(true);
  });

  test("first message with transfer intent skips keyboard and reprocesses", async () => {
    let reprocessCalls = 0;
    await runWelcomeOnboarding({
      userId: "u_intent_1",
      chatId: "1",
      originalText: "Send 5 USDC to raj.sol",
      metadata: {},
      sendHtml: async () => {},
      sendKeyboard: async () => {},
      connection,
      reprocess: async () => {
        reprocessCalls++;
        return { success: true, text: "parsed" };
      },
    });
    expect(reprocessCalls).toBe(1);
    expect(hasCompletedWelcomeOnboarding("u_intent_1")).toBe(true);
  });

  test("referral start param persists file and tracks referrer", async () => {
    await runWelcomeOnboarding({
      userId: "u_ref_child",
      chatId: "1",
      originalText: "/start ref_refparent99",
      metadata: {},
      sendHtml: async () => {},
      sendKeyboard: async () => {},
      connection,
      reprocess: async () => ({ success: true, text: "x" }),
    });
    const raw = await readFile(join(testDir, "referrals", "u_ref_child.json"), "utf8");
    const j = JSON.parse(raw) as { referredBy?: string };
    expect(j.referredBy).toBe("refparent99");
    expect(getReferrerOf("u_ref_child")).toBe("refparent99");
  });

  test("language detection picks localized welcome", () => {
    expect(detectOnboardingLocale("hola quiero enviar dinero", undefined)).toBe("ES");
    expect(detectOnboardingLocale("नमस्ते", "hi")).toBe("HI");
    const body = onboardingWelcomeBody("ES", "Abcd…Wxyz", undefined);
    expect(body).toContain("Bienvenido");
  });

  test("onboarding guard does not run twice for same userId", async () => {
    const html: string[] = [];
    await runWelcomeOnboarding({
      userId: "u_twice",
      chatId: "1",
      originalText: "yo",
      metadata: {},
      sendHtml: async (_c, h) => {
        html.push(h);
      },
      sendKeyboard: async () => {},
      connection,
      reprocess: async () => ({ success: true, text: "x" }),
    });
    const second = await runWelcomeOnboarding({
      userId: "u_twice",
      chatId: "1",
      originalText: "yo again",
      metadata: {},
      sendHtml: async (_c, h) => {
        html.push(h);
      },
      sendKeyboard: async () => {},
      connection,
      reprocess: async () => ({ success: true, text: "x" }),
    });
    expect(second).toBeUndefined();
    expect(html.length).toBe(1);
  });

});
