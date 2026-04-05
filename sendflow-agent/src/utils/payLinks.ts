const userPayLinks = new Map<string, string>();

export function registerPayUsername(userId: string, username: string): void {
  userPayLinks.set(username.toLowerCase(), userId);
}

export function createPayLink(userId: string, username: string, botName: string, amount?: number): string {
  registerPayUsername(userId, username);
  const param = amount ? `pay_${username}_${amount}` : `pay_${username}`;
  return `https://t.me/${botName}?start=${param}`;
}

export function parsePayLink(startParam: string): { username: string; amount?: number } | null {
  const match = startParam.match(/^pay_([a-zA-Z0-9_]+)(?:_(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  return {
    username: match[1],
    amount: match[2] ? Number(match[2]) : undefined,
  };
}

export function getUserIdForPayUsername(username: string): string | undefined {
  return userPayLinks.get(username.toLowerCase());
}
