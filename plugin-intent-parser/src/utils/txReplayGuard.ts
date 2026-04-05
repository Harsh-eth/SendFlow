import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const MAX_SIGS = 100;
const TTL_MS = 24 * 60 * 60 * 1000;

function sigDir(): string {
  const root = process.env.SENDFLOW_DATA_DIR?.trim() || join(process.cwd(), "data");
  return join(root, "tx-signatures");
}

interface Entry {
  sig: string;
  ts: number;
}

function pathFor(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(sigDir(), `${safe}-recent.json`);
}

async function load(userId: string): Promise<Entry[]> {
  try {
    const raw = await readFile(pathFor(userId), "utf8");
    const arr = JSON.parse(raw) as Entry[];
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.filter((e) => e && typeof e.sig === "string" && now - e.ts < TTL_MS);
  } catch {
    return [];
  }
}

async function save(userId: string, entries: Entry[]): Promise<void> {
  await mkdir(sigDir(), { recursive: true });
  const trimmed = entries.slice(-MAX_SIGS);
  await writeFile(pathFor(userId), JSON.stringify(trimmed, null, 0), "utf8");
}

/** Throws if this signature was already submitted for this user within TTL. */
export async function assertSignatureNotReplay(userId: string, signatureBase58: string): Promise<void> {
  const cur = await load(userId);
  if (cur.some((e) => e.sig === signatureBase58)) {
    throw new Error("Transaction blocked: replay_signature");
  }
}

/** Record a signature after successful submit (rolling window, TTL 24h). */
export async function recordSubmittedSignature(userId: string, signatureBase58: string): Promise<void> {
  const cur = await load(userId);
  cur.push({ sig: signatureBase58, ts: Date.now() });
  await save(userId, cur);
}
