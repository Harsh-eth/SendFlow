import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join as pathJoin } from "node:path";

const dataRoot = () => process.env.SENDFLOW_DATA_DIR?.trim() || pathJoin(process.cwd(), "data");

export type AuditLevel = "info" | "warn" | "error";

export interface AuditLogLine {
  ts: string;
  level: AuditLevel;
  userId?: string;
  action: string;
  result: string;
  /** Optional sub-reason (e.g. threat category). */
  category?: string;
  amountUsdc?: number;
  recipientHash?: string;
  txSig?: string;
  riskScore?: number;
  ip?: string;
  /** Integrity checkpoint (every 100 lines). */
  checkpointHash?: string;
  lineCount?: number;
}

const CHECKPOINT_EVERY = 100;

/** Raw lines as written (including trailing newline), for rolling hash window. */
let windowLines: string[] = [];
let writeChain = Promise.resolve();

function todayFile(): string {
  const d = new Date().toISOString().slice(0, 10);
  return pathJoin(dataRoot(), "audit", `sendflow-${d}.jsonl`);
}

export function hashRecipientAddress(address: string): string {
  return createHash("sha256").update(address.trim(), "utf8").digest("hex");
}

/** SHA-256 (hex) of concatenation of previous N raw line strings (each line should end with \\n). */
export function computeCheckpointHash(lines: string[]): string {
  const payload = lines.join("");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function enqueueWrite(fn: () => Promise<void>): void {
  writeChain = writeChain.then(fn).catch(() => {});
}

async function appendRawLine(line: string): Promise<void> {
  const dir = pathJoin(dataRoot(), "audit");
  await mkdir(dir, { recursive: true });
  await appendFile(todayFile(), line, "utf8");
  try {
    process.stdout.write(line);
  } catch {
    /* ignore */
  }
}

function buildCheckpointLine(hash: string, count: number): string {
  const ts = new Date().toISOString();
  const o: AuditLogLine & { checkpointHash: string; lineCount: number } = {
    ts,
    level: "info",
    action: "audit.checkpoint",
    result: "ok",
    checkpointHash: hash,
    lineCount: count,
  };
  return `${JSON.stringify(o)}\n`;
}

/**
 * Append one audit JSON line to data/audit/sendflow-YYYY-MM-DD.jsonl and stdout.
 * Every CHECKPOINT_EVERY lines, appends a checkpoint line with SHA-256 of the prior window.
 */
export function appendAuditEntry(entry: AuditLogLine): void {
  const line = `${JSON.stringify(entry)}\n`;
  enqueueWrite(async () => {
    await appendRawLine(line);
    windowLines.push(line);
    if (windowLines.length >= CHECKPOINT_EVERY) {
      const hash = computeCheckpointHash(windowLines);
      const ck = buildCheckpointLine(hash, windowLines.length);
      windowLines = [];
      await appendRawLine(ck);
    }
  });
}

/** Test hook: reset in-memory window (does not delete files). */
export function __resetAuditWindowForTests(): void {
  windowLines = [];
  writeChain = Promise.resolve();
}

/** Wait until pending audit writes finish (tests). */
export function __flushAuditForTests(): Promise<void> {
  return writeChain;
}
