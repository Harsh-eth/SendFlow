export interface FeedEvent {
  type: "transfer" | "achievement" | "stake" | "referral" | "challenge_win";
  displayText: string;
  timestamp: string;
  emoji: string;
}

const feedEvents: FeedEvent[] = [];
const MAX_FEED_SIZE = 100;

let transfersLastHour = 0;
let volumeToday = 0;
let hourBucket = "";

function rollHour(): void {
  const h = new Date().toISOString().slice(0, 13);
  if (h !== hourBucket) {
    hourBucket = h;
    transfersLastHour = 0;
  }
}

export function addFeedEvent(event: FeedEvent): void {
  feedEvents.unshift(event);
  if (feedEvents.length > MAX_FEED_SIZE) feedEvents.length = MAX_FEED_SIZE;
}

export function recordHourlyTransfer(volumeUsd: number): void {
  rollHour();
  transfersLastHour += 1;
  volumeToday += volumeUsd;
}

export function getRecentFeed(limit: number): FeedEvent[] {
  return feedEvents.slice(0, limit);
}

export function formatFeedMessage(events: FeedEvent[]): string {
  const lines = [`<b>SendFlow Live Activity</b>`, ``];
  for (const e of events) {
    lines.push(`${e.emoji} ${e.displayText} — ${formatAgo(e.timestamp)}`);
  }
  lines.push(``);
  lines.push(`${transfersLastHour} transfers in the last hour`);
  lines.push(`Total volume today: <b>${Math.round(volumeToday)} USDC</b>`);
  return lines.join("\n");
}

function formatAgo(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.floor(sec)} sec ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  return `${Math.floor(sec / 3600)} hr ago`;
}
