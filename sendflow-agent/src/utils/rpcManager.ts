import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { log } from "./structuredLogger";
import { alert } from "./adminAlerter";
import { recordRpcCall, rpcUrlToLabel } from "./metricsState";

const MEMO_PROGRAM_V2 = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcEo");

const DEFAULT_FALLBACK = "https://api.mainnet-beta.solana.com";

/** Max cache age before forcing refresh (signing). */
const BLOCKHASH_STALE_MS = 25_000;
/** Absolute max cache age. */
const BLOCKHASH_TTL_MS = 30_000;

const QUORUM_COLLECT_MS = 2_000;
const CONFIRM_TIMEOUT_MS = 90_000;

const HEALTH_RECHECK_MS = 30_000;
const CIRCUIT_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const CIRCUIT_OPEN_MIN_MS = 3 * 60 * 1000;
/** Open circuit after this many consecutive failed write rounds (i.e. >3 means 4th failure trips). */
const CONSECUTIVE_WRITE_FAIL_THRESHOLD = 4;

/** All configured RPC URLs (pool order). */
export function getRpcPoolUrls(): string[] {
  return parseRpcPool();
}

function parseRpcPool(): string[] {
  const raw = process.env.RPC_POOL?.trim();
  if (raw) {
    const urls = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return [
    process.env.HELIUS_RPC_URL,
    process.env.QUICKNODE_RPC_URL,
    process.env.SOLANA_RPC_URL,
    DEFAULT_FALLBACK,
  ].filter((x): x is string => Boolean(x && x.trim()));
}

type HealthEntry = {
  url: string;
  healthy: boolean;
  lastFailAt: number;
  nextProbeAt: number;
};

const healthByUrl = new Map<string, HealthEntry>();
const connectionByUrl = new Map<string, Connection>();
const lastLatencyMs = new Map<string, number>();

export function getRpcPoolHealth(): Array<{
  url: string;
  label: "helius" | "quicknode" | "default";
  healthy: boolean;
  lastLatencyMs: number | null;
}> {
  return parseRpcPool().map((url) => {
    const h = healthEntry(url);
    return {
      url: redactUrl(url),
      label: rpcUrlToLabel(url),
      healthy: h.healthy,
      lastLatencyMs: lastLatencyMs.get(url) ?? null,
    };
  });
}

function healthEntry(url: string): HealthEntry {
  let h = healthByUrl.get(url);
  if (!h) {
    h = { url, healthy: true, lastFailAt: 0, nextProbeAt: 0 };
    healthByUrl.set(url, h);
  }
  return h;
}

function getConn(url: string): Connection {
  let c = connectionByUrl.get(url);
  if (!c) {
    c = new Connection(url, "confirmed");
    connectionByUrl.set(url, c);
  }
  return c;
}

function markUnhealthy(url: string): void {
  const h = healthEntry(url);
  h.healthy = false;
  h.lastFailAt = Date.now();
  h.nextProbeAt = Date.now() + HEALTH_RECHECK_MS;
  log.warn("rpc.endpoint_unhealthy", { url: redactUrl(url) });
}

function markHealthy(url: string): void {
  const h = healthEntry(url);
  h.healthy = true;
  h.nextProbeAt = 0;
}

function redactUrl(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@").replace(/api-key=[^&]+/i, "api-key=***");
}

/** URLs considered healthy (or not yet probed as dead). */
export function getHealthyRpcUrls(): string[] {
  const now = Date.now();
  const pool = parseRpcPool();
  const out: string[] = [];
  for (const url of pool) {
    const h = healthEntry(url);
    if (h.healthy) {
      out.push(url);
      continue;
    }
    if (now >= h.nextProbeAt) {
      out.push(url);
    }
  }
  return out.length > 0 ? out : [pool[pool.length - 1] ?? DEFAULT_FALLBACK];
}

async function probeHealth(url: string): Promise<boolean> {
  const t0 = Date.now();
  try {
    const c = getConn(url);
    await Promise.race([
      c.getVersion(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5_000)),
    ]);
    markHealthy(url);
    lastLatencyMs.set(url, Date.now() - t0);
    recordRpcCall(rpcUrlToLabel(url), "ok");
    return true;
  } catch {
    markUnhealthy(url);
    recordRpcCall(rpcUrlToLabel(url), "error");
    return false;
  }
}

let healthIntervalStarted = false;
function ensureHealthSweep(): void {
  if (healthIntervalStarted) return;
  healthIntervalStarted = true;
  setInterval(() => {
    void (async () => {
      const now = Date.now();
      for (const url of parseRpcPool()) {
        const h = healthEntry(url);
        if (h.healthy) continue;
        if (now < h.nextProbeAt) continue;
        await probeHealth(url);
      }
      if (circuitState.open && now >= circuitState.openedAt + CIRCUIT_OPEN_MIN_MS) {
        for (const url of getHealthyRpcUrls().slice(0, 1)) {
          if (await probeHealth(url)) {
            tryCloseCircuitAfterSuccessfulProbe();
            break;
          }
        }
      }
    })();
  }, 10_000).unref?.();
}

// —— Circuit breaker ——

type CircuitState = {
  open: boolean;
  openedAt: number;
  consecutiveWriteFails: number;
  recentFailTimestamps: number[];
};

const circuitState: CircuitState = {
  open: false,
  openedAt: 0,
  consecutiveWriteFails: 0,
  recentFailTimestamps: [],
};

function notifyAdminCircuit(event: "open" | "close"): void {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const admin = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!token || !admin) return;
  const text =
    event === "open"
      ? `🔴 RPC circuit OPEN — write path paused (${CONSECUTIVE_WRITE_FAIL_THRESHOLD} consecutive write failures).`
      : `🟢 RPC circuit CLOSED — writes re-enabled after health check.`;
  void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: admin, text }),
  }).catch(() => {});
}

function recordWriteFailure(): void {
  const now = Date.now();
  circuitState.consecutiveWriteFails += 1;
  circuitState.recentFailTimestamps.push(now);
  circuitState.recentFailTimestamps = circuitState.recentFailTimestamps.filter((t) => now - t < CIRCUIT_FAILURE_WINDOW_MS);

  if (circuitState.consecutiveWriteFails >= CONSECUTIVE_WRITE_FAIL_THRESHOLD && !circuitState.open) {
    circuitState.open = true;
    circuitState.openedAt = now;
    log.error("rpc.circuit_open", { consecutiveFails: circuitState.consecutiveWriteFails });
    void alert("critical", "rpc.circuit_breaker_open", {
      consecutiveFails: circuitState.consecutiveWriteFails,
      threshold: CONSECUTIVE_WRITE_FAIL_THRESHOLD,
    });
  }
}

function recordWriteSuccess(): void {
  circuitState.consecutiveWriteFails = 0;
}

function tryCloseCircuitAfterSuccessfulProbe(): void {
  if (!circuitState.open) return;
  const now = Date.now();
  if (now < circuitState.openedAt + CIRCUIT_OPEN_MIN_MS) return;
  circuitState.open = false;
  recordWriteSuccess();
  notifyAdminCircuit("close");
  log.info("rpc.circuit_closed", {});
}

export function isRpcCircuitOpen(): boolean {
  return circuitState.open;
}

export const RPC_CIRCUIT_USER_MESSAGE = "Network maintenance. Please try again shortly.";

export function assertRpcCircuitClosed(): void {
  if (circuitState.open) {
    throw new Error("rpc_circuit_open");
  }
}

let cachedPrimary: Connection | null = null;
let cachedPrimaryUrl = "";

/**
 * Primary Connection for legacy call sites (first healthy URL in pool).
 */
export async function getHealthyConnection(): Promise<Connection> {
  ensureHealthSweep();
  const urls = parseRpcPool();
  for (const url of urls) {
    const h = healthEntry(url);
    if (!h.healthy && Date.now() < h.nextProbeAt) continue;
    try {
      const ok = await probeHealth(url);
      if (ok) {
        cachedPrimary = getConn(url);
        cachedPrimaryUrl = url;
        log.info("rpc.primary", { url: redactUrl(url) });
        return cachedPrimary;
      }
    } catch {
      markUnhealthy(url);
    }
  }
  const fallbackUrl = urls[urls.length - 1] ?? DEFAULT_FALLBACK;
  cachedPrimary = getConn(fallbackUrl);
  cachedPrimaryUrl = fallbackUrl;
  return cachedPrimary;
}

export function getCurrentRpcUrl(): string {
  return cachedPrimaryUrl || parseRpcPool()[0] || DEFAULT_FALLBACK;
}

/**
 * Fan-out read: first successful response wins; failures mark endpoint unhealthy.
 */
export async function rpcRead<T>(method: string, params: unknown[]): Promise<T> {
  ensureHealthSweep();
  const urls = getHealthyRpcUrls();
  if (urls.length === 0) {
    throw new Error("rpc_no_endpoints");
  }

  const errors: Error[] = [];
  const attempt = async (url: string): Promise<T> => {
    const c = getConn(url);
    const fn = (c as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
    if (typeof fn !== "function") {
      throw new Error(`rpc_unknown_method:${method}`);
    }
    const t0 = Date.now();
    try {
      const out = await fn.apply(c, params);
      markHealthy(url);
      lastLatencyMs.set(url, Date.now() - t0);
      recordRpcCall(rpcUrlToLabel(url), "ok");
      return out as T;
    } catch (e) {
      markUnhealthy(url);
      recordRpcCall(rpcUrlToLabel(url), "error");
      throw e instanceof Error ? e : new Error(String(e));
    }
  };

  try {
    return await Promise.any(urls.map((url) => attempt(url)));
  } catch (e) {
    const agg = e as AggregateError;
    const err = agg?.errors?.[0] ?? (e instanceof Error ? e : new Error(String(e)));
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type QuorumRow = { url: string; sig?: string; err?: string };

/** Pure quorum rule: ≥2 same sig wins; else first lone sig with single_rpc warning. */
export function pickQuorumSignature(rows: QuorumRow[]): { signature: string; singleRpcWarning: boolean } | null {
  const sigCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.sig) sigCounts.set(r.sig, (sigCounts.get(r.sig) ?? 0) + 1);
  }
  for (const [sig, n] of sigCounts) {
    if (n >= 2) return { signature: sig, singleRpcWarning: false };
  }
  const one = rows.find((r) => r.sig);
  if (one?.sig) return { signature: one.sig, singleRpcWarning: true };
  return null;
}

/**
 * Broadcast raw tx to all healthy RPCs; 2s per-endpoint budget; quorum on signature match.
 */
export async function rpcSendWithQuorum(rawTx: Buffer): Promise<string> {
  assertRpcCircuitClosed();
  ensureHealthSweep();
  const urls = getHealthyRpcUrls();
  if (urls.length === 0) throw new Error("rpc_quorum_failure");

  const rows: QuorumRow[] = await Promise.all(
    urls.map(async (url) => {
      const c = getConn(url);
      const t0 = Date.now();
      try {
        const sig = await Promise.race([
          c.sendRawTransaction(rawTx, { maxRetries: 2, skipPreflight: false }),
          sleep(QUORUM_COLLECT_MS).then(() => {
            throw new Error("send_timeout");
          }),
        ]);
        markHealthy(url);
        lastLatencyMs.set(url, Date.now() - t0);
        recordRpcCall(rpcUrlToLabel(url), "ok");
        return { url, sig };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markUnhealthy(url);
        recordRpcCall(rpcUrlToLabel(url), "error");
        return { url, err: msg };
      }
    })
  );

  const picked = pickQuorumSignature(rows);
  if (picked) {
    if (picked.singleRpcWarning) {
      log.warn("rpc.single_rpc", { signature: picked.signature, endpoints: rows.length });
      void alert("warn", "rpc.single_provider_fallback", {
        signature: picked.signature.slice(0, 16),
        endpoints: rows.length,
      });
    }
    recordWriteSuccess();
    return picked.signature;
  }

  recordWriteFailure();
  throw new Error("rpc_quorum_failure");
}

/** Test-only reset for circuit + blockhash cache. */
export function __resetRpcManagerTestState(): void {
  circuitState.open = false;
  circuitState.openedAt = 0;
  circuitState.consecutiveWriteFails = 0;
  circuitState.recentFailTimestamps = [];
  blockhashCache = null;
}

/** Test hook: one failed write round (maps to `recordWriteFailure`). */
export function __recordWriteFailureForTest(): void {
  recordWriteFailure();
}

// —— Blockhash cache ——

let blockhashCache: {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAt: number;
} | null = null;

export async function getFreshBlockhashForSigning(): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> {
  const now = Date.now();
  if (blockhashCache && now - blockhashCache.fetchedAt < BLOCKHASH_STALE_MS) {
    return {
      blockhash: blockhashCache.blockhash,
      lastValidBlockHeight: blockhashCache.lastValidBlockHeight,
    };
  }
  const bh = await rpcRead<{ blockhash: string; lastValidBlockHeight: number }>("getLatestBlockhash", [
    "confirmed",
  ]);
  blockhashCache = { ...bh, fetchedAt: Date.now() };
  return bh;
}

/** Drop cache when older than TTL (optional hygiene). */
export function pruneBlockhashCacheIfStale(): void {
  if (!blockhashCache) return;
  if (Date.now() - blockhashCache.fetchedAt > BLOCKHASH_TTL_MS) blockhashCache = null;
}

export const TX_CONFIRM_TIMEOUT_USER_MESSAGE =
  "Transfer pending. Check /history in 2 minutes.";

export async function confirmTransactionWithTimeout(
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  connection?: Connection
): Promise<{ ok: true } | { ok: false; timeout: true; userMessage: string }> {
  const c = connection ?? (await getHealthyConnection());
  try {
    await Promise.race([
      c.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed"),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tx_timeout")), CONFIRM_TIMEOUT_MS)),
    ]);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "tx_timeout" || msg.includes("tx_timeout")) {
      log.warn("tx_timeout", { signature, ms: CONFIRM_TIMEOUT_MS });
      return { ok: false, timeout: true, userMessage: TX_CONFIRM_TIMEOUT_USER_MESSAGE };
    }
    throw e;
  }
}

// —— MEV / priority fee ——

function percentile75(values: number[]): number {
  if (values.length === 0) return 50_000;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(0.75 * s.length) - 1));
  return Math.max(s[idx] ?? 50_000, 1);
}

/** 75th percentile prioritization fee from recent slots (up to 20), micro-lamports per CU. */
export async function getPriorityFeeMicroLamports(connection?: Connection): Promise<number> {
  try {
    const c = connection ?? (await getHealthyConnection());
    const fees = await c.getRecentPrioritizationFees();
    const bySlot = [...fees].sort((a, b) => b.slot - a.slot).slice(0, 20);
    const vals = bySlot.map((f) => f.prioritizationFee).filter((n) => Number.isFinite(n) && n >= 0);
    return percentile75(vals.length ? vals : [50_000]);
  } catch {
    try {
      const fees = await rpcRead<Array<{ slot: number; prioritizationFee: number }>>("getRecentPrioritizationFees", []);
      const bySlot = [...fees].sort((a, b) => b.slot - a.slot).slice(0, 20);
      const vals = bySlot.map((f) => f.prioritizationFee).filter((n) => Number.isFinite(n) && n >= 0);
      return percentile75(vals.length ? vals : [50_000]);
    } catch {
      return 50_000;
    }
  }
}

function userIdMemoPayload(userId: string): Buffer {
  const h = createHash("sha256").update(userId, "utf8").digest().subarray(0, 8);
  return Buffer.from(`sf:${h.toString("hex")}`, "utf8");
}

/**
 * Prepend compute unit price + memo (hashed user id) to a Jupiter versioned transaction.
 */
export async function applySwapMevShield(
  vtx: VersionedTransaction,
  userId: string,
  connection: Connection
): Promise<VersionedTransaction> {
  try {
    const microLamports = await getPriorityFeeMicroLamports(connection);
    const cuIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_V2,
      keys: [],
      data: userIdMemoPayload(userId),
    });

    const msg = TransactionMessage.decompile(vtx.message);
    const newInstructions = [cuIx, memoIx, ...msg.instructions];

    const luts = await loadLookupTableAccounts(connection, vtx);

    const rebuilt = new TransactionMessage({
      payerKey: msg.payerKey,
      recentBlockhash: msg.recentBlockhash,
      instructions: newInstructions,
    }).compileToV0Message(luts);

    return new VersionedTransaction(rebuilt);
  } catch (e) {
    log.warn("swap.mev_shield_skipped", { error: e instanceof Error ? e.message : String(e) });
    return vtx;
  }
}

/** USDC-involved Jupiter swaps: cap slippage at 0.5% (50 bps). */
export function clampSwapSlippageForStable(inputMint: string, outputMint: string, requestedBps: number): number {
  const usdc = (process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").trim();
  const involvesUsdc = inputMint === usdc || outputMint === usdc;
  if (!involvesUsdc) return requestedBps;
  return Math.min(requestedBps, 50);
}

async function loadLookupTableAccounts(
  connection: Connection,
  vtx: VersionedTransaction
): Promise<AddressLookupTableAccount[] | undefined> {
  if (vtx.message.version !== 0 || vtx.message.addressTableLookups.length === 0) return undefined;
  const loaded: AddressLookupTableAccount[] = [];
  for (const l of vtx.message.addressTableLookups) {
    const res = await connection.getAddressLookupTable(l.accountKey);
    if (res.value) loaded.push(res.value);
  }
  return loaded.length > 0 ? loaded : undefined;
}

/** Rebuild versioned tx with a fresh blockhash (call after quote + shield, before sign). */
export async function versionedTxWithFreshBlockhash(
  vtx: VersionedTransaction,
  connection: Connection
): Promise<{ tx: VersionedTransaction; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await getFreshBlockhashForSigning();
  const msg = TransactionMessage.decompile(vtx.message);
  const luts = await loadLookupTableAccounts(connection, vtx);
  const rebuilt = new TransactionMessage({
    payerKey: msg.payerKey,
    recentBlockhash: blockhash,
    instructions: msg.instructions,
  }).compileToV0Message(luts);
  return { tx: new VersionedTransaction(rebuilt), blockhash, lastValidBlockHeight };
}

export async function withFallback<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
  const c = cachedPrimary ?? (await getHealthyConnection());
  try {
    return await fn(c);
  } catch (e) {
    log.warn("rpc.with_fallback_retry", { error: e instanceof Error ? e.message : String(e) });
    cachedPrimary = null;
    cachedPrimaryUrl = "";
    const next = await getHealthyConnection();
    return fn(next);
  }
}
