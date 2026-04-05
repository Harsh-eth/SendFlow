import { persistLoad, persistSave } from "@sendflow/plugin-intent-parser";

const FILE = "telegram-entity-chats.json";

let cache: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cache) return cache;
  cache = persistLoad<Record<string, string>>(FILE, {});
  return cache;
}

/** Map Eliza entity UUID → Telegram chat id (private: same as user id). */
export function rememberTelegramChat(entityId: string, telegramChatId: string): void {
  if (!entityId || !telegramChatId) return;
  const m = { ...load() };
  m[entityId] = telegramChatId;
  cache = m;
  persistSave(FILE, m);
}

export function getTelegramChatForEntity(entityId: string): string | undefined {
  return load()[entityId];
}

/** Prefer mapped chat id; fallback to entityId if numeric (legacy callbacks). */
export function resolveTelegramChatId(entityId: string): string {
  const mapped = getTelegramChatForEntity(entityId);
  if (mapped) return mapped;
  if (/^\d+$/.test(entityId)) return entityId;
  return entityId;
}

export function __resetTelegramChatRegistryForTests(): void {
  cache = {};
}
