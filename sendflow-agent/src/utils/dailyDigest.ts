import { loggerCompat as logger } from "./structuredLogger";

interface DigestConfig {
  userId: string;
  chatId: string;
  enabled: boolean;
  hour: number;
  lastSent?: string;
}

const digestStore = new Map<string, DigestConfig>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let digestCb: ((chatId: string, text: string) => Promise<void>) | null = null;

export function enableDigest(userId: string, chatId: string, hour = 8): void {
  digestStore.set(userId, { userId, chatId, enabled: true, hour });
  logger.info(`Daily digest enabled for ${userId} at ${hour}:00`);
}

export function disableDigest(userId: string): void {
  const config = digestStore.get(userId);
  if (config) config.enabled = false;
}

export function isDigestEnabled(userId: string): boolean {
  return digestStore.get(userId)?.enabled ?? false;
}

async function tick(): Promise<void> {
  if (!digestCb) return;
  const now = new Date();
  const currentHour = now.getUTCHours();
  const today = now.toISOString().slice(0, 10);

  for (const config of digestStore.values()) {
    if (!config.enabled) continue;
    if (config.lastSent === today) continue;
    if (currentHour !== config.hour) continue;

    config.lastSent = today;
    const msg = [
      `🌅 <b>Good morning!</b>`,
      ``,
      `📊 <b>Daily Summary</b>`,
      `Your SendFlow wallet is ready for today.`,
      ``,
      `Type <code>balance</code> to see your funds`,
      `Type <code>stats</code> to see your analytics`,
      `Type <code>market</code> for crypto prices`,
      ``,
      `⚡ Have a great day!`,
    ].join("\n");

    await digestCb(config.chatId, msg).catch(() => {});
  }
}

export function startDigestScheduler(cb: (chatId: string, text: string) => Promise<void>): void {
  digestCb = cb;
  if (intervalId) return;
  intervalId = setInterval(() => { tick().catch(() => {}); }, 60_000);
  logger.info("Daily digest scheduler started (60s check interval)");
}
