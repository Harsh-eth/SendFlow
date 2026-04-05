#!/usr/bin/env bun
/**
 * Stress harness: concurrent simulated users with bounded classifier concurrency.
 * Run from repo root: bun run stress-test
 *
 * Default: clears NOSANA_LLM_ENDPOINT for fast, deterministic runs (fail-safe classifier path).
 * Set STRESS_USE_LLM=1 to measure real Nosana/Qwen latency (needs NOSANA_LLM_ENDPOINT).
 */

const USERS = 20;
const INTENTS_PER_USER = 5;
/** Max parallel in-flight classifier calls (avoids thundering the LLM endpoint). */
const CLASSIFY_CONCURRENCY = 3;
const P95_MAX_MS = 3000;
const MIN_SUCCESS_RATE = 0.95;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

async function runWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  const q = [...items];
  async function worker(): Promise<void> {
    for (;;) {
      const item = q.shift();
      if (item === undefined) break;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function main(): Promise<void> {
  if (process.env.STRESS_USE_LLM !== "1" && process.env.STRESS_USE_LLM !== "true") {
    process.env.NOSANA_LLM_ENDPOINT = "";
  }

  const { classifyMessage } = await import("../sendflow-agent/src/utils/threatClassifier.ts");
  const { getRpcTotals } = await import("../sendflow-agent/src/utils/metricsState.ts");

  const latencies: number[] = [];
  let blocks = 0;
  let total = 0;

  const tasks = Array.from({ length: USERS * INTENTS_PER_USER }, (_, k) => {
    const u = Math.floor(k / INTENTS_PER_USER);
    const i = k % INTENTS_PER_USER;
    return { u, i };
  });

  await runWithConcurrency(tasks, CLASSIFY_CONCURRENCY, async ({ u, i }) => {
    const uid = `stress_${u}_${Date.now()}`;
    const text = `Send ${(Math.random() * 50 + 1).toFixed(2)} USDC to demo${i}.sol for invoice #${u}-${i}`;
    const t0 = performance.now();
    const r = await classifyMessage(uid, text, {
      recentTransferCount: i,
      accountAgeDays: 3,
    });
    latencies.push(performance.now() - t0);
    total += 1;
    if (r.label === "block") blocks += 1;
  });

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const pathSuccess = total ? (total - blocks) / total : 1;

  const rpc = getRpcTotals();
  let rpcErr = 0;
  let rpcOk = 0;
  for (const v of Object.values(rpc)) {
    rpcErr += v.error;
    rpcOk += v.ok;
  }
  const rpcDenom = rpcErr + rpcOk;
  const rpcErrRate = rpcDenom ? rpcErr / rpcDenom : 0;

  console.log("");
  console.log("┌──────────────────────────────────┬──────────────┐");
  console.log("│ Metric                           │ Value        │");
  console.log("├──────────────────────────────────┼──────────────┤");
  console.log(`│ Classifier latency p50 (ms)       │ ${p50.toFixed(1).padStart(12)} │`);
  console.log(`│ Classifier latency p95 (ms)       │ ${p95.toFixed(1).padStart(12)} │`);
  console.log(`│ Non-block rate (proxy success)    │ ${(pathSuccess * 100).toFixed(2).padStart(11)}% │`);
  console.log(
    `│ RPC error rate (process metrics)  │ ${rpcDenom ? `${(rpcErrRate * 100).toFixed(2).padStart(10)}%` : "           —"} │`
  );
  console.log(`│ Classify concurrency cap          │ ${String(CLASSIFY_CONCURRENCY).padStart(12)} │`);
  console.log(`│ Total classifications             │ ${String(total).padStart(12)} │`);
  console.log(`│ LLM mode                          │ ${process.env.STRESS_USE_LLM === "1" || process.env.STRESS_USE_LLM === "true" ? "live (STRESS_USE_LLM)" : "fast (no endpoint)"} │`);
  console.log("└──────────────────────────────────┴──────────────┘");
  console.log("");

  const failP95 = p95 > P95_MAX_MS;
  const failPath = pathSuccess < MIN_SUCCESS_RATE;
  if (failP95 || failPath) {
    console.error(
      `FAIL: ${failP95 ? `p95>${P95_MAX_MS}ms ` : ""}${failPath ? `non-block rate <${MIN_SUCCESS_RATE * 100}%` : ""}`
    );
    process.exit(1);
  }
  console.log("OK — within thresholds (p95 ≤ 3000ms, non-block rate ≥ 95%).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
