const BLINKS_BASE = (process.env.SENDFLOW_BASE_URL ?? process.env.WEBAPP_PUBLIC_URL ?? "https://sendflow.app").replace(/\/$/, "");

function enc(s: string): string {
  return encodeURIComponent(s);
}

export function generateTransferBlink(amount: number, recipientWallet: string, token: string, memo?: string): string {
  const m = memo ? `&memo=${enc(memo)}` : "";
  return `${BLINKS_BASE}/blink?action=transfer&to=${enc(recipientWallet)}&amount=${amount}&token=${enc(token)}${m}`;
}

export function generateInvoiceBlink(invoiceId: string, amount: number, merchantWallet: string): string {
  return `${BLINKS_BASE}/blink?action=invoice&id=${enc(invoiceId)}&to=${enc(merchantWallet)}&amount=${amount}`;
}

export function generateProfileBlink(username: string): string {
  return `${BLINKS_BASE}/blink?action=pay&user=${enc(username)}`;
}

export function formatBlinkMessage(url: string, description: string): string {
  return [
    `🔗 <b>Your Solana Blink</b>`,
    ``,
    `${description}`,
    ``,
    `<code>${url}</code>`,
    ``,
    `Share on Twitter, Discord, anywhere — one click payment ⚡`,
  ].join("\n");
}
