import { loggerCompat as logger } from "./structuredLogger";

export interface PriceAlert {
  alertId: string;
  userId: string;
  token: string;
  condition: "above" | "below" | "change_percent";
  threshold: number;
  basePrice: number;
  createdAt: string;
  triggered: boolean;
}

const alertStore = new Map<string, PriceAlert[]>();
const MAX_ALERTS_PER_USER = 5;
let alertCounter = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let notifyCb: ((userId: string, text: string) => Promise<void>) | null = null;

function generateId(): string {
  alertCounter += 1;
  return `pa_${Date.now().toString(36)}_${alertCounter}`;
}

export function addPriceAlert(alert: Omit<PriceAlert, "alertId" | "triggered" | "createdAt">): { success: boolean; alert?: PriceAlert; error?: string } {
  const existing = alertStore.get(alert.userId) ?? [];
  const active = existing.filter((a) => !a.triggered);
  if (active.length >= MAX_ALERTS_PER_USER) {
    return { success: false, error: `Maximum ${MAX_ALERTS_PER_USER} active alerts allowed.` };
  }
  const newAlert: PriceAlert = {
    ...alert,
    alertId: generateId(),
    triggered: false,
    createdAt: new Date().toISOString(),
  };
  existing.push(newAlert);
  alertStore.set(alert.userId, existing);
  return { success: true, alert: newAlert };
}

export function listAlerts(userId: string): PriceAlert[] {
  return (alertStore.get(userId) ?? []).filter((a) => !a.triggered);
}

export function cancelAlert(userId: string, alertId: string): boolean {
  const list = alertStore.get(userId);
  if (!list) return false;
  const idx = list.findIndex((a) => a.alertId === alertId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

async function fetchPrice(token: string): Promise<number | null> {
  const tokenMints: Record<string, string> = {
    SOL: "So11111111111111111111111111111111111111112",
    USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
    BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  };
  const mint = tokenMints[token.toUpperCase()];
  if (!mint) return null;
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Record<string, { price?: string }> };
    const priceStr = data.data?.[mint]?.price;
    return priceStr ? Number(priceStr) : null;
  } catch {
    return null;
  }
}

async function tick(): Promise<void> {
  const allAlerts: PriceAlert[] = [];
  for (const list of alertStore.values()) {
    for (const a of list) {
      if (!a.triggered) allAlerts.push(a);
    }
  }
  if (allAlerts.length === 0) return;

  const tokens = [...new Set(allAlerts.map((a) => a.token.toUpperCase()))];
  const prices = new Map<string, number>();
  for (const t of tokens) {
    const p = await fetchPrice(t);
    if (p != null) prices.set(t, p);
  }

  for (const alert of allAlerts) {
    const price = prices.get(alert.token.toUpperCase());
    if (price == null) continue;

    let triggered = false;
    if (alert.condition === "above" && price >= alert.threshold) triggered = true;
    if (alert.condition === "below" && price <= alert.threshold) triggered = true;
    if (alert.condition === "change_percent") {
      const changePct = ((price - alert.basePrice) / alert.basePrice) * 100;
      if (Math.abs(changePct) >= alert.threshold) triggered = true;
    }

    if (triggered) {
      alert.triggered = true;
      const emoji = price >= alert.basePrice ? "🚀" : "📉";
      if (notifyCb) {
        await notifyCb(alert.userId, [
          `🚨 <b>Price Alert!</b>`,
          `${alert.token} just hit <b>$${price.toFixed(2)}</b> ${emoji}`,
          `Your target was: $${alert.threshold}`,
        ].join("\n")).catch(() => {});
      }
    }
  }
}

export function startPriceAlertMonitor(cb: (userId: string, text: string) => Promise<void>): void {
  notifyCb = cb;
  if (intervalId) return;
  intervalId = setInterval(() => { tick().catch(() => {}); }, 30_000);
  logger.info("Price alert monitor started (30s interval)");
}

export function parsePriceAlertCommand(text: string): { token: string; condition: "above" | "below" | "change_percent"; threshold: number } | null {
  const above = text.match(/\balert\s+(?:me\s+)?when\s+(\w+)\s+(?:hits?|reaches?|is\s+above|goes?\s+above)\s+\$?(\d+(?:\.\d+)?)/i);
  if (above) return { token: above[1].toUpperCase(), condition: "above", threshold: Number(above[2]) };

  const below = text.match(/\balert\s+(?:me\s+)?when\s+(\w+)\s+(?:drops?\s+(?:below|under)|is\s+below|goes?\s+below|depegs?)\s+\$?(\d+(?:\.\d+)?)/i);
  if (below) return { token: below[1].toUpperCase(), condition: "below", threshold: Number(below[2]) };

  const pct = text.match(/\balert\s+(?:me\s+)?when\s+(\w+)\s+(?:pumps?|dumps?|moves?|changes?)\s+(\d+)%/i);
  if (pct) return { token: pct[1].toUpperCase(), condition: "change_percent", threshold: Number(pct[2]) };

  return null;
}
