const usernameToWallet = new Map<string, string>();
const usernameToUserId = new Map<string, string>();

export function isGroupMessage(metadata: unknown): boolean {
  const meta = metadata as { telegram?: { chat?: { type?: string } } } | undefined;
  const chatType = meta?.telegram?.chat?.type;
  return chatType === "group" || chatType === "supergroup";
}

export function isBotMentioned(text: string, botUsername: string): boolean {
  return text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
}

export function stripBotMention(text: string, botUsername: string): string {
  return text.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();
}

export function extractMentionedUsernames(text: string): string[] {
  const matches = text.match(/@([a-zA-Z0-9_]{5,32})/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(1));
}

export function registerUsername(username: string, wallet: string, userId: string): void {
  usernameToWallet.set(username.toLowerCase(), wallet);
  usernameToUserId.set(username.toLowerCase(), userId);
}

export function resolveUsernameToWallet(username: string): string | null {
  return usernameToWallet.get(username.toLowerCase()) ?? null;
}

export function getUserIdForUsername(username: string): string | undefined {
  return usernameToUserId.get(username.toLowerCase());
}
