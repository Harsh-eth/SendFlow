import { persistLoad, persistSave } from "./persistence";

export interface SendFlowId {
  username: string;
  userId: string;
  walletAddress: string;
  createdAt: string;
  profileEmoji: string;
  bio: string;
  totalReceived: number;
  publicProfile: boolean;
}

const MAX_ENTRIES = 10_000;
const usernameStore = new Map<string, SendFlowId>();
const userIdToUsername = new Map<string, string>();

function loadSendflowIds(): void {
  const p = persistLoad<{ profiles: Record<string, SendFlowId>; userIdToUsername: Record<string, string> }>(
    "sendflow-ids.json",
    { profiles: {}, userIdToUsername: {} }
  );
  usernameStore.clear();
  userIdToUsername.clear();
  for (const [u, prof] of Object.entries(p.profiles ?? {})) {
    usernameStore.set(u, prof);
  }
  for (const [uid, u] of Object.entries(p.userIdToUsername ?? {})) {
    userIdToUsername.set(uid, u);
  }
}

function persistSendflowIds(): void {
  persistSave("sendflow-ids.json", {
    profiles: Object.fromEntries(usernameStore),
    userIdToUsername: Object.fromEntries(userIdToUsername),
  });
}

loadSendflowIds();

function trimMap<T>(map: Map<string, T>): void {
  while (map.size >= MAX_ENTRIES) {
    const first = map.keys().next().value as string | undefined;
    if (first) map.delete(first);
    else break;
  }
}

export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

export function claimUsername(
  userId: string,
  username: string,
  wallet: string
): { success: boolean; error?: string } {
  const u = username.trim().toLowerCase();
  if (!isValidUsername(u)) {
    return { success: false, error: "Username must be 3–20 characters (letters, numbers, underscore only)." };
  }
  const existing = usernameStore.get(u);
  if (existing && existing.userId !== userId) {
    return { success: false, error: "That username is already taken." };
  }
  trimMap(usernameStore);
  trimMap(userIdToUsername);
  const prev = userIdToUsername.get(userId);
  if (prev && prev !== u) {
    usernameStore.delete(prev);
  }
  const profile: SendFlowId = {
    username: u,
    userId,
    walletAddress: wallet,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    profileEmoji: existing?.profileEmoji ?? "⚡",
    bio: existing?.bio ?? "",
    totalReceived: existing?.totalReceived ?? 0,
    publicProfile: existing?.publicProfile ?? true,
  };
  usernameStore.set(u, profile);
  userIdToUsername.set(userId, u);
  persistSendflowIds();
  return { success: true };
}

export function resolveUsername(username: string): SendFlowId | null {
  const u = username.trim().toLowerCase();
  return usernameStore.get(u) ?? null;
}

export function getProfile(userId: string): SendFlowId | null {
  const u = userIdToUsername.get(userId);
  return u ? usernameStore.get(u) ?? null : null;
}

export function updateProfile(userId: string, updates: Partial<SendFlowId>): void {
  const p = getProfile(userId);
  if (!p) return;
  const next = { ...p, ...updates, username: p.username, userId: p.userId };
  usernameStore.set(p.username.toLowerCase(), next);
  persistSendflowIds();
}

export function addTotalReceived(userId: string, amount: number): void {
  const p = getProfile(userId);
  if (!p) return;
  updateProfile(userId, { totalReceived: p.totalReceived + amount });
}
