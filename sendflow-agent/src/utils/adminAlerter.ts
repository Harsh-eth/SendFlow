import { log } from "./structuredLogger";

export type AlertLevel = "info" | "warn" | "critical";

const CRITICAL_RING_MAX = 10;
const WARN_FLUSH_MS = 5 * 60 * 1000;
const WARN_MAX_PER_DIGEST = 20;

export interface CriticalAlertRecord {
  ts: string;
  event: string;
  data: object;
}

const criticalRing: CriticalAlertRecord[] = [];

let warnBuffer: Array<{ ts: string; event: string; data: object }> = [];
let warnFlushTimer: ReturnType<typeof setTimeout> | null = null;

function pushCritical(event: string, data: object): void {
  const rec: CriticalAlertRecord = { ts: new Date().toISOString(), event, data };
  criticalRing.push(rec);
  if (criticalRing.length > CRITICAL_RING_MAX) criticalRing.shift();
}

export function getLastCriticalAlerts(n = 10): CriticalAlertRecord[] {
  return criticalRing.slice(-n);
}

async function sendTelegramCritical(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!token || !admin) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: admin,
      text: text.slice(0, 4000),
      parse_mode: "HTML",
    }),
  }).catch(() => {});
}

function scheduleWarnFlush(): void {
  if (warnFlushTimer) return;
  warnFlushTimer = setTimeout(() => {
    warnFlushTimer = null;
    void flushWarnDigest();
  }, WARN_FLUSH_MS);
}

async function flushWarnDigest(): Promise<void> {
  if (warnBuffer.length === 0) return;
  const batch = warnBuffer.slice(0, WARN_MAX_PER_DIGEST);
  warnBuffer = warnBuffer.slice(WARN_MAX_PER_DIGEST);
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  const lines = batch.map(
    (w, i) => `${i + 1}. <b>${escapeHtml(w.event)}</b>\n<code>${escapeHtml(JSON.stringify(w.data).slice(0, 500))}</code>`
  );
  const text = `⚠️ <b>SendFlow warn digest</b> (${batch.length})\n\n${lines.join("\n\n")}`;
  if (token && admin) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: admin, text: text.slice(0, 4000), parse_mode: "HTML" }),
    }).catch(() => {});
  }
  log.warn("admin.alert.warn_digest", { count: batch.length });
  if (warnBuffer.length > 0) scheduleWarnFlush();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Route admin notifications: critical → immediate Telegram; warn → 5‑min batched digest (max 20); info → structured log only.
 */
export async function alert(level: AlertLevel, event: string, data: object): Promise<void> {
  if (level === "info") {
    log.info("admin.alert.info", { alertEvent: event, ...data });
    return;
  }
  if (level === "critical") {
    pushCritical(event, data);
    const body = `🚨 <b>CRITICAL: ${escapeHtml(event)}</b>\n<pre>${escapeHtml(JSON.stringify(data, null, 2)).slice(0, 3500)}</pre>`;
    await sendTelegramCritical(body);
    log.error("admin.alert.critical", { alertEvent: event, ...data });
    return;
  }
  if (warnBuffer.length >= WARN_MAX_PER_DIGEST) {
    warnBuffer.shift();
  }
  warnBuffer.push({ ts: new Date().toISOString(), event, data });
  log.warn("admin.alert.warn_queued", { alertEvent: event, queueLen: warnBuffer.length });
  scheduleWarnFlush();
}

/** Test hook: flush pending warns without waiting. */
export async function __flushWarnsForTests(): Promise<void> {
  if (warnFlushTimer) {
    clearTimeout(warnFlushTimer);
    warnFlushTimer = null;
  }
  await flushWarnDigest();
}

export function __resetAlerterForTests(): void {
  criticalRing.length = 0;
  warnBuffer = [];
  if (warnFlushTimer) {
    clearTimeout(warnFlushTimer);
    warnFlushTimer = null;
  }
}
