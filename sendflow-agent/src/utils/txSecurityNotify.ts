import { log } from "./structuredLogger";

export async function notifyAdminBlockedTx(payload: {
  userId: string;
  reason?: string;
  txBase64: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!token || !admin) {
    log.warn("tx.blocked_no_admin", { userId: payload.userId, reason: payload.reason });
    return;
  }
  const text = [
    `🛑 Transaction blocked`,
    `userId: ${payload.userId}`,
    payload.reason ? `reason: ${payload.reason}` : "",
    `tx (base64): ${payload.txBase64.slice(0, 200)}${payload.txBase64.length > 200 ? "…" : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: admin, text }),
  }).catch(() => {});
}
