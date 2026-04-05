import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join as pathJoin } from "node:path";
import { getPlatformSavingsSync } from "@sendflow/plugin-intent-parser";

const dataRoot = () => process.env.SENDFLOW_DATA_DIR?.trim() || pathJoin(process.cwd(), "data");

const STATE_PATH = () => pathJoin(dataRoot(), "metrics-state.json");

const DAY_MS = 86_400_000;

export interface PersistedMetrics {
  version: 1;
  transfers: { success: number; failed: number; blocked: number };
  threatsByCategory: Record<string, number>;
  threatsDayUtc: string;
  offramp: Record<string, { allowed: number; denied: number }>;
  rpc: Record<string, { ok: number; error: number }>;
  /** Rolling: userId -> last activity ts */
  activityTs: Record<string, number>;
  /** Rolling: { ts, amount } */
  volumeEvents: Array<{ ts: number; amount: number }>;
}

let state: PersistedMetrics = {
  version: 1,
  transfers: { success: 0, failed: 0, blocked: 0 },
  threatsByCategory: {},
  threatsDayUtc: new Date().toISOString().slice(0, 10),
  offramp: {},
  rpc: {},
  activityTs: {},
  volumeEvents: [],
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 400;

const onboardingPaths: Record<string, number> = {};
const onboardingFirstAction: Record<string, number> = {};

export function recordOnboardingPath(path: "direct" | "referral" | "intent_first"): void {
  onboardingPaths[path] = (onboardingPaths[path] ?? 0) + 1;
}

export function recordOnboardingFirstAction(action: "send" | "request" | "addfunds" | "wallet"): void {
  onboardingFirstAction[action] = (onboardingFirstAction[action] ?? 0) + 1;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetThreatsIfNewDay(): void {
  const d = todayUtc();
  if (state.threatsDayUtc !== d) {
    state.threatsByCategory = {};
    state.threatsDayUtc = d;
  }
}

function pruneRolling(): void {
  const cutoff = Date.now() - DAY_MS;
  for (const [uid, ts] of Object.entries(state.activityTs)) {
    if (ts < cutoff) delete state.activityTs[uid];
  }
  state.volumeEvents = state.volumeEvents.filter((e) => e.ts >= cutoff);
}

export async function loadMetricsState(): Promise<void> {
  try {
    const raw = await readFile(STATE_PATH(), "utf8");
    const j = JSON.parse(raw) as PersistedMetrics;
    if (j?.version === 1 && j.transfers) {
      state = {
        ...state,
        ...j,
        activityTs: j.activityTs && typeof j.activityTs === "object" ? j.activityTs : {},
        volumeEvents: Array.isArray(j.volumeEvents) ? j.volumeEvents : [],
      };
      resetThreatsIfNewDay();
      pruneRolling();
    }
  } catch {
    /* fresh */
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, PERSIST_DEBOUNCE_MS);
}

async function persistNow(): Promise<void> {
  pruneRolling();
  try {
    await mkdir(dataRoot(), { recursive: true });
    await writeFile(STATE_PATH(), JSON.stringify(state, null, 0), "utf8");
  } catch {
    /* ignore */
  }
}

export function recordTransferResult(result: "success" | "failed" | "blocked"): void {
  state.transfers[result] += 1;
  schedulePersist();
}

export function recordThreatCategory(category: string): void {
  resetThreatsIfNewDay();
  const k = normalizeThreatCategory(category);
  state.threatsByCategory[k] = (state.threatsByCategory[k] ?? 0) + 1;
  schedulePersist();
}

function normalizeThreatCategory(c: string): string {
  const s = c.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!s) return "unknown";
  if (s.includes("inject")) return "injection";
  if (s.includes("scam") || s.includes("phish") || s.includes("pig") || s.includes("romance")) return "scam";
  if (s.includes("bot") || s.includes("rate")) return "bot";
  return s.slice(0, 48);
}

export function recordOfframpAttempt(tier: number, allowed: boolean): void {
  const key = String(Math.min(3, Math.max(0, tier)));
  if (!state.offramp[key]) state.offramp[key] = { allowed: 0, denied: 0 };
  if (allowed) state.offramp[key]!.allowed += 1;
  else state.offramp[key]!.denied += 1;
  schedulePersist();
}

export function rpcUrlToLabel(url: string): "helius" | "quicknode" | "default" {
  const u = url.toLowerCase();
  if (u.includes("helius")) return "helius";
  if (u.includes("quicknode")) return "quicknode";
  return "default";
}

export function recordRpcCall(label: "helius" | "quicknode" | "default", result: "ok" | "error"): void {
  if (!state.rpc[label]) state.rpc[label] = { ok: 0, error: 0 };
  state.rpc[label]![result] += 1;
  schedulePersist();
}

export function noteUserActive24h(userId: string): void {
  state.activityTs[userId] = Date.now();
  schedulePersist();
}

export function recordVolume24h(amountUsdc: number): void {
  state.volumeEvents.push({ ts: Date.now(), amount: amountUsdc });
  schedulePersist();
}

export function getActiveUsers24h(): number {
  pruneRolling();
  return Object.keys(state.activityTs).length;
}

export function getVolumeUsdc24h(): number {
  pruneRolling();
  let s = 0;
  for (const e of state.volumeEvents) s += e.amount;
  return Math.round(s * 1e6) / 1e6;
}

export function getTransferCounts(): { success: number; failed: number; blocked: number } {
  return { ...state.transfers };
}

export function getTopThreatCategoriesToday(n: number): Array<{ category: string; count: number }> {
  resetThreatsIfNewDay();
  return Object.entries(state.threatsByCategory)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

export function getOfframpSummary(): Record<string, { allowed: number; denied: number }> {
  return { ...state.offramp };
}

export function getRpcTotals(): Record<string, { ok: number; error: number }> {
  return { ...state.rpc };
}

/** Prometheus text exposition (OpenMetrics-style). */
export function renderPrometheusMetrics(): string {
  pruneRolling();
  const lines: string[] = [];
  const t = state.transfers;
  lines.push("# HELP sendflow_transfers_total Total transfer outcomes.");
  lines.push("# TYPE sendflow_transfers_total counter");
  for (const r of ["success", "failed", "blocked"] as const) {
    lines.push(`sendflow_transfers_total{result="${r}"} ${t[r]}`);
  }

  lines.push("# HELP sendflow_threats_detected_total Threat classifications (by category).");
  lines.push("# TYPE sendflow_threats_detected_total counter");
  for (const [cat, n] of Object.entries(state.threatsByCategory)) {
    const esc = cat.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    lines.push(`sendflow_threats_detected_total{category="${esc}"} ${n}`);
  }

  lines.push("# HELP sendflow_offramp_attempts_total Off-ramp policy checks.");
  lines.push("# TYPE sendflow_offramp_attempts_total counter");
  for (let tier = 0; tier <= 3; tier++) {
    const o = state.offramp[String(tier)] ?? { allowed: 0, denied: 0 };
    lines.push(`sendflow_offramp_attempts_total{tier="${tier}",result="allowed"} ${o.allowed}`);
    lines.push(`sendflow_offramp_attempts_total{tier="${tier}",result="denied"} ${o.denied}`);
  }

  lines.push("# HELP sendflow_rpc_calls_total RPC calls by provider.");
  lines.push("# TYPE sendflow_rpc_calls_total counter");
  for (const label of ["helius", "quicknode", "default"] as const) {
    const r = state.rpc[label] ?? { ok: 0, error: 0 };
    lines.push(`sendflow_rpc_calls_total{rpc="${label}",result="ok"} ${r.ok}`);
    lines.push(`sendflow_rpc_calls_total{rpc="${label}",result="error"} ${r.error}`);
  }

  const au = getActiveUsers24h();
  const vol = getVolumeUsdc24h();
  lines.push("# HELP sendflow_active_users_24h Unique users active in rolling 24h window.");
  lines.push("# TYPE sendflow_active_users_24h gauge");
  lines.push(`sendflow_active_users_24h ${au}`);
  lines.push("# HELP sendflow_volume_usdc_24h USDC volume in rolling 24h window.");
  lines.push("# TYPE sendflow_volume_usdc_24h gauge");
  lines.push(`sendflow_volume_usdc_24h ${vol}`);

  lines.push("# HELP sendflow_onboardings_total First-time welcome onboarding completions by path.");
  lines.push("# TYPE sendflow_onboardings_total counter");
  for (const [path, n] of Object.entries(onboardingPaths)) {
    lines.push(`sendflow_onboardings_total{path="${path}"} ${n}`);
  }

  lines.push("# HELP sendflow_onboarding_first_action_total First button tapped after welcome.");
  lines.push("# TYPE sendflow_onboarding_first_action_total counter");
  for (const [action, n] of Object.entries(onboardingFirstAction)) {
    lines.push(`sendflow_onboarding_first_action_total{action="${action}"} ${n}`);
  }

  const plat = getPlatformSavingsSync();
  lines.push("# HELP sendflow_platform_savings_usd_total Cumulative estimated savings vs Western Union (all users, ledger).");
  lines.push("# TYPE sendflow_platform_savings_usd_total gauge");
  lines.push(`sendflow_platform_savings_usd_total ${plat.totalSavedUsd}`);
  lines.push("# HELP sendflow_platform_volume_usdc_total Cumulative USDC volume recorded in savings ledger.");
  lines.push("# TYPE sendflow_platform_volume_usdc_total gauge");
  lines.push(`sendflow_platform_volume_usdc_total ${plat.totalVolumeUsdc}`);

  const feeLamports = Number(process.env.SENDFLOW_ESTIMATE_FEE_LAMPORTS ?? 5000);
  lines.push("# HELP sendflow_estimate_tx_fee_lamports Typical Solana network fee (lamports) for public dashboard fee estimates.");
  lines.push("# TYPE sendflow_estimate_tx_fee_lamports gauge");
  lines.push(`sendflow_estimate_tx_fee_lamports ${Number.isFinite(feeLamports) && feeLamports > 0 ? feeLamports : 5000}`);

  lines.push("");
  return lines.join("\n");
}

/** Test-only reset of in-memory state. */
export function __resetMetricsStateForTests(): void {
  state = {
    version: 1,
    transfers: { success: 0, failed: 0, blocked: 0 },
    threatsByCategory: {},
    threatsDayUtc: todayUtc(),
    offramp: {},
    rpc: {},
    activityTs: {},
    volumeEvents: [],
  };
  for (const k of Object.keys(onboardingPaths)) delete onboardingPaths[k];
  for (const k of Object.keys(onboardingFirstAction)) delete onboardingFirstAction[k];
}
