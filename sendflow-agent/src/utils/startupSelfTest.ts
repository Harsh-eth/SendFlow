import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Connection } from "@solana/web3.js";
import { encryptPrivateKey, decryptPrivateKeyBytes, getMasterKey } from "./encryption";
import { classifyMessage } from "./threatClassifier";
import { computeCheckpointHash, __resetAuditWindowForTests, __flushAuditForTests } from "./auditLog";
import { auditLog } from "./structuredLogger";
import { alert } from "./adminAlerter";
import { getRpcPoolUrls } from "./rpcManager";

export interface SelfTestResult {
  ok: boolean;
  reasons: string[];
}

async function rpcConnectivityCheck(connection: Connection): Promise<boolean> {
  const urls = getRpcPoolUrls();
  if (urls.length === 0) return false;
  let okAny = false;
  for (const url of urls) {
    try {
      const { Connection: Conn } = await import("@solana/web3.js");
      const c = new Conn(url, "confirmed");
      await Promise.race([
        c.getVersion(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 8_000)),
      ]);
      okAny = true;
    } catch {
      /* try next */
    }
  }
  if (!okAny) {
    try {
      await connection.getVersion();
      okAny = true;
    } catch {
      return false;
    }
  }
  return okAny;
}

async function encryptionRoundTrip(): Promise<boolean> {
  const master = getMasterKey();
  const uid = "selftest-encrypt";
  const sk = randomBytes(32);
  try {
    const ct = await encryptPrivateKey(sk, uid, master);
    const out = await decryptPrivateKeyBytes(ct, uid, master);
    const match = sk.length === out.length && sk.every((b, i) => b === out[i]!);
    sk.fill(0);
    out.fill(0);
    return match;
  } catch {
    return false;
  }
}

async function classifierPing(): Promise<boolean> {
  if (!process.env.NOSANA_LLM_ENDPOINT?.trim()) {
    return true;
  }
  const r = await classifyMessage("startup-selftest", "Hello.", {
    recentTransferCount: 0,
    accountAgeDays: 30,
  });
  return r.label !== "block";
}

async function auditCheckpointVerify(): Promise<boolean> {
  const prev = process.env.SENDFLOW_DATA_DIR;
  const tmp = join(process.cwd(), "data", `.audit-selftest-${Date.now()}`);
  process.env.SENDFLOW_DATA_DIR = tmp;
  __resetAuditWindowForTests();
  try {
    await rm(tmp, { recursive: true }).catch(() => {});
    await mkdir(join(tmp, "audit"), { recursive: true });
    for (let i = 0; i < 100; i++) {
      auditLog({
        level: "info",
        action: "selftest.audit_line",
        result: "ok",
        userId: `line-${i}`,
      });
    }
    await __flushAuditForTests();
    const day = new Date().toISOString().slice(0, 10);
    const p = join(tmp, "audit", `sendflow-${day}.jsonl`);
    const raw = await readFile(p, "utf8");
    const lines = raw.trim().split("\n");
    if (lines.length < 101) return false;
    const last = JSON.parse(lines[lines.length - 1]!) as {
      action?: string;
      checkpointHash?: string;
      lineCount?: number;
    };
    if (last.action !== "audit.checkpoint" || !last.checkpointHash) return false;
    const expected = computeCheckpointHash(
      lines.slice(0, 100).map((l) => l + "\n")
    );
    return last.checkpointHash === expected && last.lineCount === 100;
  } finally {
    process.env.SENDFLOW_DATA_DIR = prev;
    __resetAuditWindowForTests();
    await rm(tmp, { recursive: true }).catch(() => {});
  }
}

export async function runStartupSelfTest(connection: Connection): Promise<SelfTestResult> {
  const reasons: string[] = [];
  const rpcOk = await rpcConnectivityCheck(connection);
  if (!rpcOk) reasons.push("rpc_connectivity");

  const encOk = await encryptionRoundTrip();
  if (!encOk) reasons.push("encryption_roundtrip");

  const clsOk = await classifierPing();
  if (!clsOk) reasons.push("classifier_ping");

  const auditOk = await auditCheckpointVerify();
  if (!auditOk) reasons.push("audit_checkpoint");

  const ok = reasons.length === 0;
  if (!ok) {
    await alert("critical", "startup.selftest_failed", { reasons, ts: new Date().toISOString() });
  }
  return { ok, reasons };
}
