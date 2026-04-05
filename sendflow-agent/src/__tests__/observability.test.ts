import { describe, expect, test, beforeEach } from "bun:test";
import { computeCheckpointHash } from "../utils/auditLog";
import {
  renderPrometheusMetrics,
  __resetMetricsStateForTests,
  recordThreatCategory,
  recordTransferResult,
} from "../utils/metricsState";
import { alert, __flushWarnsForTests, __resetAlerterForTests } from "../utils/adminAlerter";
import { Connection } from "@solana/web3.js";

describe("observability", () => {
  beforeEach(() => {
    __resetMetricsStateForTests();
    __resetAlerterForTests();
  });

  test("checkpoint hash matches concatenation of 100 lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `{"n":${i}}\n`);
    const h1 = computeCheckpointHash(lines);
    const h2 = computeCheckpointHash(lines);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
    lines[0] = '{"n":999}\n';
    const h3 = computeCheckpointHash(lines);
    expect(h3).not.toBe(h1);
  });

  test("Prometheus metrics text includes expected series", () => {
    recordTransferResult("success");
    recordTransferResult("failed");
    recordThreatCategory("injection");
    const body = renderPrometheusMetrics();
    expect(body).toContain("sendflow_transfers_total{result=\"success\"}");
    expect(body).toContain("sendflow_transfers_total{result=\"failed\"}");
    expect(body).toContain("sendflow_threats_detected_total");
    expect(body).toContain("sendflow_offramp_attempts_total");
    expect(body).toContain("sendflow_rpc_calls_total");
    expect(body).toContain("sendflow_active_users_24h");
    expect(body).toContain("sendflow_volume_usdc_24h");
    expect(body).toContain("sendflow_platform_savings_usd_total");
    expect(body).toContain("sendflow_platform_volume_usdc_total");
  });

  test("alert: critical does not batch; warn batches until flush", async () => {
    let sent = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => {
      sent += 1;
      return new Response("{}");
    }) as typeof fetch;
    process.env.TELEGRAM_BOT_TOKEN = "t";
    process.env.ADMIN_TELEGRAM_ID = "1";
    try {
      await alert("critical", "e1", { a: 1 });
      expect(sent).toBe(1);
      await alert("warn", "w1", { b: 2 });
      await alert("warn", "w2", { c: 3 });
      expect(sent).toBe(1);
      await __flushWarnsForTests();
      expect(sent).toBeGreaterThanOrEqual(2);
    } finally {
      globalThis.fetch = orig;
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.ADMIN_TELEGRAM_ID;
    }
  });

  test("startup self-test fail path when RPC unreachable", async () => {
    const prevPool = process.env.RPC_POOL;
    process.env.RPC_POOL = "http://127.0.0.1:9";
    try {
      const { runStartupSelfTest: run } = await import("../utils/startupSelfTest");
      const c = new Connection("http://127.0.0.1:9", "confirmed");
      const r = await run(c);
      expect(r.ok).toBe(false);
      expect(r.reasons).toContain("rpc_connectivity");
    } finally {
      process.env.RPC_POOL = prevPool;
    }
  });

  test("transfer counters accumulate in memory", () => {
    recordTransferResult("success");
    recordTransferResult("success");
    const body = renderPrometheusMetrics();
    expect(body).toMatch(/sendflow_transfers_total\{result="success"\} 2/);
  });
});
