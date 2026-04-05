import { persistLoad, persistSave } from "./persistence";

function loadContactStore(): Map<string, Map<string, string>> {
  const raw = persistLoad<Record<string, Record<string, string>>>("contacts.json", {});
  const m = new Map<string, Map<string, string>>();
  for (const [entityId, inner] of Object.entries(raw)) {
    m.set(entityId, new Map(Object.entries(inner)));
  }
  return m;
}

const contactStore = loadContactStore();

function persistContacts(): void {
  const obj: Record<string, Record<string, string>> = {};
  for (const [entityId, inner] of contactStore) {
    obj[entityId] = Object.fromEntries(inner);
  }
  persistSave("contacts.json", obj);
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export function saveContact(entityId: string, name: string, wallet: string): void {
  let userMap = contactStore.get(entityId);
  if (!userMap) {
    userMap = new Map();
    contactStore.set(entityId, userMap);
  }
  userMap.set(normalize(name), wallet);
  persistContacts();
}

export function getContact(entityId: string, name: string): string | null {
  return contactStore.get(entityId)?.get(normalize(name)) ?? null;
}

export function listContacts(entityId: string): Record<string, string> {
  const userMap = contactStore.get(entityId);
  if (!userMap || userMap.size === 0) return {};
  const result: Record<string, string> = {};
  for (const [n, wallet] of userMap) result[n] = wallet;
  return result;
}

export function deleteContact(entityId: string, name: string): boolean {
  const ok = contactStore.get(entityId)?.delete(normalize(name)) ?? false;
  if (ok) persistContacts();
  return ok;
}
