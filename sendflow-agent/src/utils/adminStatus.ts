import { getLastCriticalAlerts } from "./adminAlerter";
import { getRpcPoolHealth, isRpcCircuitOpen } from "./rpcManager";
import {
  getActiveUsers24h,
  getVolumeUsdc24h,
  getTransferCounts,
  getTopThreatCategoriesToday,
  getOfframpSummary,
} from "./metricsState";

export function formatAdminStatusMessage(): string {
  const crit = getLastCriticalAlerts(10);
  const critLines =
    crit.length === 0
      ? "—"
      : crit
          .map((c) => `• ${c.ts.slice(11, 19)} <code>${escapeHtml(c.event)}</code>`)
          .join("\n");

  const circuit = isRpcCircuitOpen() ? "🔴 OPEN" : "🟢 closed";
  const tc = getTransferCounts();
  const vol = getVolumeUsdc24h();
  const active = getActiveUsers24h();
  const topThreats = getTopThreatCategoriesToday(3);
  const threatLines =
    topThreats.length === 0
      ? "—"
      : topThreats.map((t) => `• ${escapeHtml(t.category)}: <b>${t.count}</b>`).join("\n");

  const rpc = getRpcPoolHealth();
  const rpcLines = rpc
    .map((r) => {
      const lat = r.lastLatencyMs != null ? `${r.lastLatencyMs}ms` : "—";
      const st = r.healthy ? "healthy" : "unhealthy";
      return `• ${r.label}: <b>${st}</b> · latency ${lat}`;
    })
    .join("\n");

  const off = getOfframpSummary();
  let offAttempts = 0;
  let offDenied = 0;
  const tierBreak: string[] = [];
  for (let t = 0; t <= 3; t++) {
    const o = off[String(t)] ?? { allowed: 0, denied: 0 };
    offAttempts += o.allowed + o.denied;
    offDenied += o.denied;
    tierBreak.push(`T${t}: ${o.allowed}✓ / ${o.denied}✗`);
  }

  return [
    `<b>SendFlow status</b>`,
    ``,
    `<b>Last critical alerts</b> (10)`,
    critLines,
    ``,
    `<b>Circuit breaker</b>: ${circuit}`,
    ``,
    `<b>24h</b>: volume <b>${vol.toFixed(2)}</b> USDC · transfers ${tc.success} ok / ${tc.failed} fail / ${tc.blocked} blocked · active users ~<b>${active}</b>`,
    ``,
    `<b>Top threats today</b>`,
    threatLines,
    ``,
    `<b>RPC pool</b>`,
    rpcLines || "—",
    ``,
    `<b>Off-ramp</b>: attempts ~${offAttempts}, denied ${offDenied}`,
    tierBreak.join(" · "),
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
