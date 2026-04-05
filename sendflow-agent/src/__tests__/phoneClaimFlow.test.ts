import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowPhoneClaimStartAttempt,
  __resetPhoneClaimRateLimitForTests,
  buildPhoneClaimDeepLink,
  maskPhone,
  writePhoneClaimRecord,
  loadPhoneClaim,
  archivePhoneClaimRecord,
  sendPhoneClaimSms,
  handlePhoneClaimDeepLinkStart,
  sweepExpiredPhoneClaims,
  type PhoneClaimRecord,
} from "../utils/phoneClaimFlow";
import { Connection } from "@solana/web3.js";

describe("phoneClaimFlow", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    __resetPhoneClaimRateLimitForTests();
    tmpRoot = await mkdtemp(join(tmpdir(), "sf-phone-"));
    process.env.SENDFLOW_DATA_DIR = tmpRoot;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY;
  });

  afterEach(async () => {
    __resetPhoneClaimRateLimitForTests();
    delete process.env.SENDFLOW_DATA_DIR;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  test("deep link contains claim code only, not amount", () => {
    process.env.TELEGRAM_BOT_USERNAME = "MyBot";
    const link = buildPhoneClaimDeepLink("a1b2c3d4");
    expect(link).toBe("https://t.me/MyBot?start=claim_a1b2c3d4");
    expect(link).not.toMatch(/12|USDC|usdc/);
  });

  test("maskPhone hides digits", () => {
    expect(maskPhone("+15551234567")).toBe("••••4567");
  });

  test("rate limit blocks fourth claim start in one hour", () => {
    expect(allowPhoneClaimStartAttempt("u1")).toBe(true);
    expect(allowPhoneClaimStartAttempt("u1")).toBe(true);
    expect(allowPhoneClaimStartAttempt("u1")).toBe(true);
    expect(allowPhoneClaimStartAttempt("u1")).toBe(false);
    expect(allowPhoneClaimStartAttempt("u2")).toBe(true);
  });

  test("no Twilio: sendPhoneClaimSms returns false", async () => {
    const ok = await sendPhoneClaimSms(10, "abcd1234", "+15550001111");
    expect(ok).toBe(false);
  });

  test("Twilio path uses mocked fetch", async () => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+10000000000";
    process.env.TELEGRAM_BOT_USERNAME = "TBot";
    const orig = global.fetch;
    global.fetch = (async (url: RequestInfo) => {
      const u = String(url);
      if (u.includes("twilio.com")) {
        return new Response("{}", { status: 201 });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    const ok = await sendPhoneClaimSms(25, "beefcafe", "+15551230000");
    expect(ok).toBe(true);
    global.fetch = orig;
  });

  test("sweep does not touch pending non-expired claims", async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const rec: PhoneClaimRecord = {
      senderUserId: "sender99",
      amountUsdc: 3,
      phoneNumber: "+19998887777",
      claimCode: "deadbeef",
      createdAt: new Date().toISOString(),
      expiresAt: future,
      status: "pending",
    };
    await writePhoneClaimRecord(rec);
    const connection = new Connection("https://api.mainnet-beta.solana.com");
    const n = await sweepExpiredPhoneClaims(connection, async () => {});
    expect(n).toBe(0);
    expect(await loadPhoneClaim("deadbeef")).not.toBeNull();
  });

  test("missing claim file shows expired copy", async () => {
    const out: string[] = [];
    await handlePhoneClaimDeepLinkStart({
      userId: "recv1",
      chatId: "9",
      claimCode: "ffffffff",
      connection: new Connection("https://api.mainnet-beta.solana.com"),
      sendHtml: async (_c, h) => {
        out.push(h);
      },
      sendKeyboard: async (_c, _h, _k) => {},
    });
    expect(out.some((s) => s.includes("expired"))).toBe(true);
  });

  test("archive moves claim out of active dir", async () => {
    const rec: PhoneClaimRecord = {
      senderUserId: "a",
      amountUsdc: 1,
      phoneNumber: "+1",
      claimCode: "aaaabbbb",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: "claimed",
    };
    await writePhoneClaimRecord(rec);
    await archivePhoneClaimRecord(rec, "test");
    expect(await loadPhoneClaim("aaaabbbb")).toBeNull();
  });
});
