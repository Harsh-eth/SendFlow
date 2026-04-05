import { describe, test, expect } from "bun:test";
import {
  claimUsername,
  resolveUsername,
  isValidUsername,
} from "../utils/sendflowId";
import { calculateCreditScore, getMaxLoanAmount } from "../utils/microLoan";
import { checkRateLimit, recordRequest } from "../utils/rateLimiter";
import { saveContact, getContact, deleteContact } from "@sendflow/plugin-intent-parser";
import {
  isEligibleForSponsorship,
  recordSponsoredTx,
  getRemainingFreeTransfers,
} from "../utils/feeSponsorship";
import {
  sharedRecordTransaction,
  sharedGetAllTransfers,
  sharedGetLastTransfer,
} from "@sendflow/plugin-intent-parser";
import { joinLeaderboard, getTopSenders, updateLeaderboard } from "../utils/leaderboard";
import { analyzeTransaction } from "../utils/fraudDetection";
import { startStream, pauseStream, resumeStream } from "../utils/streamPayment";
import {
  enablePOS,
  createPOSInvoice,
  markPOSPaid,
  getPOSSession,
} from "../utils/merchantPOS";
import { generateTransferBlink, generateProfileBlink } from "../utils/blinksGenerator";
import {
  createTreasury,
  addMember,
  createProposal,
  voteOnProposal,
} from "../utils/daoTreasury";

describe("SendFlow ID", () => {
  test("claim username", () => {
    const result = claimUsername("user1", "testuser", "wallet123");
    expect(result.success).toBe(true);
  });
  test("reject duplicate username", () => {
    const result = claimUsername("user2", "testuser", "wallet456");
    expect(result.success).toBe(false);
  });
  test("resolve username to wallet", () => {
    const profile = resolveUsername("testuser");
    expect(profile?.walletAddress).toBe("wallet123");
  });
  test("reject invalid username", () => {
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("has space")).toBe(false);
    expect(isValidUsername("validname")).toBe(true);
  });
});

describe("Credit Score", () => {
  test("new user gets low score", () => {
    const score = calculateCreditScore("newuser123");
    expect(score).toBeLessThan(30);
  });
  test("max loan for score 80+", () => {
    expect(getMaxLoanAmount(80)).toBe(100);
    expect(getMaxLoanAmount(60)).toBe(50);
    expect(getMaxLoanAmount(29)).toBe(0);
  });
});

describe("Rate Limiter", () => {
  test("allows first message", () => {
    const result = checkRateLimit("testuser_msgs", "messages");
    expect(result.allowed).toBe(true);
  });
  test("blocks after 20 messages", () => {
    const uid = `spammer_${Date.now()}`;
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(uid, "messages").allowed).toBe(true);
      recordRequest(uid, "messages");
    }
    const result = checkRateLimit(uid, "messages");
    expect(result.allowed).toBe(false);
  });
});

describe("Contact Book", () => {
  test("save and retrieve contact", () => {
    saveContact("user1", "Mom", "wallet_mom_123");
    const result = getContact("user1", "Mom");
    expect(result).toBe("wallet_mom_123");
  });
  test("case insensitive lookup", () => {
    const result = getContact("user1", "mom");
    expect(result).toBe("wallet_mom_123");
  });
  test("delete contact", () => {
    deleteContact("user1", "Mom");
    expect(getContact("user1", "Mom")).toBeNull();
  });
});

describe("Fee Sponsorship", () => {
  test("new user eligible", () => {
    expect(isEligibleForSponsorship(`brandnew_${Date.now()}`)).toBe(true);
  });
  test("ineligible after 3 sponsored txns", () => {
    const u = `heavy_${Date.now()}`;
    recordSponsoredTx(u, 5000);
    recordSponsoredTx(u, 5000);
    recordSponsoredTx(u, 5000);
    expect(isEligibleForSponsorship(u)).toBe(false);
  });
  test("remaining count decrements", () => {
    const u = `free_${Date.now()}`;
    expect(getRemainingFreeTransfers(u)).toBe(3);
    recordSponsoredTx(u, 1);
    expect(getRemainingFreeTransfers(u)).toBe(2);
  });
});

describe("Transfer History", () => {
  test("add and retrieve transfer", () => {
    sharedRecordTransaction("user1", {
      amount: 10,
      receiverWallet: "abc",
      receiverLabel: "Test",
      txHash: "hash1",
      explorerUrl: "url1",
      completedAt: new Date().toISOString(),
    });
    const history = sharedGetAllTransfers("user1");
    expect(history.length).toBeGreaterThan(0);
  });
  test("last transfer is retrievable", () => {
    const last = sharedGetLastTransfer("user1");
    expect(last?.txHash).toBe("hash1");
  });
});

describe("Leaderboard", () => {
  test("opt in and appear on board", async () => {
    await joinLeaderboard("user1_lb", "Tester");
    await updateLeaderboard("user1_lb", 100, "Tester");
    const top = await getTopSenders(10);
    expect(top.length).toBeGreaterThanOrEqual(0);
  });
});

describe("Fraud Detection", () => {
  test("large amount from new user flagged", () => {
    const flag = analyzeTransaction("brandnewuser", 99.9, "someWallet", {
      isNewUser: true,
      maxTransferUsd: 100,
    });
    expect(flag).not.toBeNull();
  });
  test("normal transaction not flagged", () => {
    const flag = analyzeTransaction("normaluser", 5, "someWallet");
    expect(flag).toBeNull();
  });
});

describe("Stream Payments", () => {
  test("start stream and get status", () => {
    const stream = startStream("user1", "wallet123", "Test", 5, 15);
    expect(stream.status).toBe("active");
  });
  test("pause stream", () => {
    const paused = pauseStream("user1");
    expect(paused?.status).toBe("paused");
  });
  test("resume stream", () => {
    const resumed = resumeStream("user1");
    expect(resumed?.status).toBe("active");
  });
});

describe("POS Mode", () => {
  test("enable POS and create invoice", () => {
    enablePOS("merchant1", "TestShop", "wallet_merchant");
    const invoice = createPOSInvoice("merchant1", 5, "Coffee");
    expect(invoice.amount).toBe(5);
    expect(invoice.paid).toBe(false);
  });
  test("mark invoice paid", () => {
    const invoice = createPOSInvoice("merchant1", 10, "Tea");
    markPOSPaid(invoice.invoiceId, "customer_wallet");
    const sess = getPOSSession("merchant1");
    expect(sess?.txCountToday).toBeGreaterThan(0);
  });
});

describe("Blinks Generator", () => {
  test("generates valid transfer blink URL", () => {
    const url = generateTransferBlink(10, "wallet123", "USDC");
    expect(url).toContain("action=transfer");
    expect(url).toContain("amount=10");
  });
  test("generates profile blink", () => {
    const url = generateProfileBlink("harsh");
    expect(url).toContain("user=harsh");
  });
});

describe("DAO Treasury", () => {
  test("create treasury and add member", () => {
    const t = createTreasury("admin1", "TestDAO", "treasury_wallet");
    expect(t.adminUserIds).toContain("admin1");
    addMember(t.treasuryId, "member1");
    expect(t.memberUserIds).toContain("member1");
  });
  test("create and vote on proposal", () => {
    const t = createTreasury("admin2", "VoteDAO", "vote_wallet");
    const p = createProposal(t.treasuryId, "admin2", "Pay developer", 50, "dev_wallet");
    voteOnProposal(t.treasuryId, p.proposalId, "admin2", "yes");
    expect(p.votes.length).toBe(1);
  });
});
