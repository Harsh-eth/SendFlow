import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const seenUsers = new Set<string>();
const lastSeenMs = new Map<string, number>();

function dataRoot(): string {
  return process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
}

function welcomeOnboardedPath(): string {
  return join(dataRoot(), "welcome-onboarded.json");
}

let welcomeOnboardedCache: Set<string> | null = null;

function loadWelcomeOnboardedSet(): Set<string> {
  if (welcomeOnboardedCache) return welcomeOnboardedCache;
  welcomeOnboardedCache = new Set<string>();
  const p = welcomeOnboardedPath();
  try {
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as { users?: string[] };
      for (const u of j.users ?? []) {
        if (typeof u === "string") welcomeOnboardedCache.add(u);
      }
    }
  } catch {
    /* fresh */
  }
  return welcomeOnboardedCache;
}

/** Product onboarding (welcome + CTA keyboard) finished — persisted across restarts. */
export function hasCompletedWelcomeOnboarding(entityId: string): boolean {
  return loadWelcomeOnboardedSet().has(entityId);
}

export function markWelcomeOnboardingComplete(entityId: string): void {
  const s = loadWelcomeOnboardedSet();
  if (s.has(entityId)) return;
  s.add(entityId);
  try {
    const p = welcomeOnboardedPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ users: [...s] }, null, 2), "utf8");
  } catch {
    /* best-effort */
  }
}

/** @internal tests */
export function __resetWelcomeOnboardingForTests(): void {
  welcomeOnboardedCache = null;
}

export function getAllSeenUserIds(): string[] {
  return [...seenUsers];
}

export function isNewUser(entityId: string): boolean {
  return !seenUsers.has(entityId);
}

export function markSeen(entityId: string): void {
  seenUsers.add(entityId);
  lastSeenMs.set(entityId, Date.now());
}

export function updateLastSeen(entityId: string): void {
  lastSeenMs.set(entityId, Date.now());
}

export function getLastSeen(entityId: string): number {
  return lastSeenMs.get(entityId) ?? Date.now();
}

/** Non-crypto-friendly welcome; use {@link buildWelcomeMessage} with the user's wallet address. */
export const WELCOME_MESSAGE_TEMPLATE = `
👋 <b>Welcome to SendFlow!</b>

Send money anywhere in the world for almost no fee.
No bank account needed. No complicated setup.

I just created your personal wallet:
💳 <code>{walletAddress}</code>

<b>To get started, fund your wallet:</b>
1. Ask a friend to send USDC to your wallet above
2. Use the <b>P2P marketplace</b> (tap <b>Buy USDC</b>) — buy from locals with UPI, bank, GCash, M-Pesa; USDC stays in escrow until release
3. Withdraw USDC from any exchange to your wallet

<b>Then just type what you want to do:</b>
• <i>"Send $20 to Mom"</i>
• <i>"Pay my freelancer 100 USDC"</i>
• <i>"Charge my customer 50 USDC"</i>

That's it. No jargon. No seed phrases. Just money.
`.trim();

export function buildWelcomeMessage(walletAddress: string): string {
  return WELCOME_MESSAGE_TEMPLATE.replace(/\{walletAddress\}/g, walletAddress);
}

export const HELP_MESSAGE = [
  `<b>SendFlow</b> — money for real life, not crypto Twitter.`,
  `Workers sending home · freelancers getting paid · shops taking USDC.`,
  ``,
  `⚡ <b>Quick shortcuts (instant)</b>`,
  `<code>/b</code> balance · <code>/h</code> history · <code>/s</code> stats`,
  `<code>/c</code> contacts · <code>/m</code> market · <code>/l</code> leaderboard`,
  `<code>/r</code> referral · <code>/streak</code> · <code>/earn</code>`,
  ``,
  `<b>P2P add / cash out</b>`,
  `• <code>buy USDC</code> / <code>sell USDC</code> / <code>show offers</code> — peer-to-peer, escrow on Solana`,
  ``,
  `<b>💸 Send &amp; get paid</b>`,
  `• <code>Send $50 to Mom</code> or <code>Send 10 USDC to raj.sol</code>`,
  `• <code>Create invoice for 50 USDC</code> · payment links for clients`,
  `• <code>Enable POS</code> — QR for your shop`,
  ``,
  `<b>📇 Contacts &amp; splits</b>`,
  `• <code>Save Mom: wallet…</code> · <code>Split 90 USDC between …</code>`,
].join("\n");
