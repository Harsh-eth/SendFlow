export interface PaymentPage {
  pageId: string;
  creatorUserId: string;
  title: string;
  description: string;
  amount?: number;
  recipientWallet: string;
  acceptedTokens: string[];
  theme: "dark" | "light" | "solana";
  totalCollected: number;
  paymentCount: number;
  active: boolean;
}

import { randomBytes } from "node:crypto";

const MAX_PAGES = 10_000;
const pages = new Map<string, PaymentPage>();

function trim(): void {
  while (pages.size >= MAX_PAGES) {
    const first = pages.keys().next().value as string | undefined;
    if (first) pages.delete(first);
    else break;
  }
}

export function createPaymentPage(
  userId: string,
  title: string,
  description: string,
  recipientWallet: string,
  amount?: number
): PaymentPage {
  trim();
  const pageId = `pg_${randomBytes(6).toString("hex")}`;
  const p: PaymentPage = {
    pageId,
    creatorUserId: userId,
    title,
    description,
    amount,
    recipientWallet,
    acceptedTokens: ["USDC"],
    theme: "dark",
    totalCollected: 0,
    paymentCount: 0,
    active: true,
  };
  pages.set(pageId, p);
  return p;
}

export function getPaymentPage(pageId: string): PaymentPage | null {
  return pages.get(pageId) ?? null;
}

export function listPaymentPages(userId: string): PaymentPage[] {
  return [...pages.values()].filter((p) => p.creatorUserId === userId && p.active);
}

export function disablePaymentPage(pageId: string, userId: string): boolean {
  const p = pages.get(pageId);
  if (!p || p.creatorUserId !== userId) return false;
  p.active = false;
  return true;
}

export function generatePageHTML(page: PaymentPage): string {
  const amt = page.amount != null ? String(page.amount) : "Any";
  const bot = process.env.TELEGRAM_BOT_USERNAME ?? "SendFlowSol_bot";
  const base = (process.env.PUBLIC_BASE_URL ?? process.env.WEBAPP_PUBLIC_URL ?? "http://localhost:3000").replace(
    /\/$/,
    ""
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Pay ${escapeHtml(page.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; }
    body { font-family: system-ui, sans-serif; background: #0f0c29; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a2e; border-radius: 16px; padding: 32px; max-width: 400px; width: 90%; text-align: center; }
    h1 { color: #00ff88; font-size: 24px; margin-bottom: 8px; }
    .amount { font-size: 48px; font-weight: bold; margin: 24px 0; }
    .btn { background: #9945ff; color: white; border: none; padding: 16px 32px; border-radius: 8px; font-size: 18px; cursor: pointer; width: 100%; margin-top: 16px; }
    .wallet { font-family: monospace; font-size: 12px; color: #666; margin-top: 16px; word-break: break-all; }
    .powered { color: #444; font-size: 11px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(page.title)}</h1>
    <p style="color:#aaa">${escapeHtml(page.description)}</p>
    <div class="amount">${escapeHtml(amt)} USDC</div>
    <button class="btn" type="button" onclick="window.open('https://t.me/${bot}?start=page_${escapeHtml(page.pageId)}')">
      Pay with SendFlow
    </button>
    <p class="wallet">Wallet: ${escapeHtml(page.recipientWallet)}</p>
    <p class="powered">Powered by SendFlow on Solana + Nosana · ${escapeHtml(base)}/pay/${escapeHtml(page.pageId)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function getPaymentPageHtml(pageId: string): string | null {
  const p = pages.get(pageId);
  if (!p || !p.active) return null;
  return generatePageHTML(p);
}
