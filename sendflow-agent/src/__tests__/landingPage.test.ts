import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import { Connection } from "@solana/web3.js";
import { landingPage, parsePrometheusMetricsForLanding } from "../api/landingPage";
import { __resetMetricsStateForTests } from "../utils/metricsState";
import { startHealthServer } from "../api/health";

describe("landingPage", () => {
  test("parsePrometheusMetricsForLanding reads counters from Prometheus text", () => {
    const text = `
sendflow_transfers_total{result="success"} 12
sendflow_transfers_total{result="failed"} 1
sendflow_transfers_total{result="blocked"} 2
sendflow_threats_detected_total{category="injection"} 3
sendflow_threats_detected_total{category="spam"} 1
sendflow_offramp_attempts_total{tier="0",result="denied"} 5
sendflow_offramp_attempts_total{tier="0",result="allowed"} 9
sendflow_rpc_calls_total{rpc="main",result="error"} 2
sendflow_rpc_calls_total{rpc="main",result="ok"} 100
sendflow_active_users_24h 7
sendflow_volume_usdc_24h 1234.56
sendflow_platform_savings_usd_total 99
sendflow_estimate_tx_fee_lamports 8000
`.trim();
    const m = parsePrometheusMetricsForLanding(text);
    expect(m.transfersSuccess).toBe(12);
    expect(m.transfersFailed).toBe(1);
    expect(m.transfersBlocked).toBe(2);
    expect(m.threatsTotal).toBe(4);
    expect(m.offrampDenied).toBe(5);
    expect(m.offrampAllowed).toBe(9);
    expect(m.rpcErrors).toBe(2);
    expect(m.rpcOk).toBe(100);
    expect(m.activeUsers24h).toBe(7);
    expect(m.volumeUsdc24h).toBe(1234.56);
    expect(m.estimateFeeLamports).toBe(8000);
  });

  test("parsePrometheusMetricsForLanding handles all-zero exposition", () => {
    const text = `
sendflow_transfers_total{result="success"} 0
sendflow_transfers_total{result="failed"} 0
sendflow_transfers_total{result="blocked"} 0
sendflow_active_users_24h 0
sendflow_volume_usdc_24h 0
sendflow_estimate_tx_fee_lamports 5000
`.trim();
    const m = parsePrometheusMetricsForLanding(text);
    expect(m.transfersSuccess).toBe(0);
    expect(m.threatsTotal).toBe(0);
    expect(m.estimateFeeLamports).toBe(5000);
  });

  test("landingPage renders when metrics state is reset (zeros)", () => {
    __resetMetricsStateForTests();
    const html = landingPage();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Send money anywhere");
    expect(html).toContain("Security status — live");
    expect(html).toContain("no threats today");
  });
});

describe("health GET /", () => {
  const prevPort = process.env.PORT;
  let server: ReturnType<typeof startHealthServer> | null = null;
  let port = 0;

  beforeAll(async () => {
    process.env.PORT = "0";
    __resetMetricsStateForTests();
    const conn = new Connection("http://127.0.0.1:8899", "confirmed");
    server = startHealthServer({ connection: conn });
    if (!server) throw new Error("startHealthServer returned null");
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.once("listening", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    port = addr.port;
  });

  afterAll(() => {
    process.env.PORT = prevPort;
    server?.close();
  });

  test("GET / returns 200 text/html", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toMatch(/text\/html/i);
  });
});
