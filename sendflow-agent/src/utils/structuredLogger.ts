import { appendAuditEntry, type AuditLevel, type AuditLogLine, hashRecipientAddress } from "./auditLog";

export { hashRecipientAddress, appendAuditEntry, computeCheckpointHash } from "./auditLog";

type Level = "info" | "warn" | "error";

/** Append-only audit: dual sink (jsonl + stdout JSON). See auditLog.ts for checkpoint integrity. */
export function auditLog(
  partial: Omit<AuditLogLine, "ts"> & { ts?: string; level?: AuditLevel }
): void {
  const ts = partial.ts ?? new Date().toISOString();
  const { ts: _t, level: lev = "info", ...rest } = partial;
  appendAuditEntry({ ts, level: lev, ...rest } as AuditLogLine);
}

function structuredLog(level: Level, event: string, data?: Record<string, unknown>): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(data ?? {}),
  };
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch {
    /* ignore */
  }
}

export const log = {
  info: (event: string, data?: object) =>
    structuredLog("info", event, data as Record<string, unknown> | undefined),
  warn: (event: string, data?: object) =>
    structuredLog("warn", event, data as Record<string, unknown> | undefined),
  error: (event: string, data?: object, err?: Error) =>
    structuredLog("error", event, {
      ...(data as Record<string, unknown>),
      error: err?.message,
      stack: err?.stack,
    }),
  transfer: (phase: string, userId: string, data: object) =>
    structuredLog("info", `transfer.${phase}`, { userId, ...(data as Record<string, unknown>) }),
  security: (event: string, userId: string, severity: string, data?: object) =>
    structuredLog("warn", `security.${event}`, {
      userId,
      severity,
      ...(data as Record<string, unknown>),
    }),
  perf: (op: string, ms: number, data?: object) =>
    structuredLog("info", `perf.${op}`, { durationMs: ms, ...(data as Record<string, unknown>) }),
};

/** Drop-in for legacy `logger` from @elizaos/core (string messages → structured JSON lines). */
export const loggerCompat = {
  info: (message: string) => log.info("legacy", { message }),
  warn: (message: string) => log.warn("legacy", { message }),
  error: (message: string) => log.error("legacy", { message }),
};

export function logTransfer(
  ev: "initiated" | "confirmed" | "completed" | "failed",
  data: Record<string, unknown>
): void {
  structuredLog("info", `transfer.${ev}`, data);
}

export function logSecurity(event: string, userId: string, severity: string, data: object): void {
  log.security(event, userId, severity, data);
}

export function logPerformance(operation: string, durationMs: number, data: object): void {
  log.perf(operation, durationMs, data);
}
