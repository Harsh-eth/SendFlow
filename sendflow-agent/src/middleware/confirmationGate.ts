/**
 * Confirmation gate (orchestration contract)
 *
 * After `CHECK_REMITTANCE_RATE`, `setPending()` stores intent+rate for 60s (see `@sendflow/plugin-intent-parser` pendingFlow).
 * Users reply `YES` or `NO`. Action `CONFIRM_SENDFLOW` consumes the pending entry and either:
 * - sets `state.values.sendflow.flow.confirmed = true` (YES), allowing `LOCK_USDC_ESCROW`, or
 * - cancels with "❌ Transfer cancelled. No funds moved." (NO / expiry).
 *
 * `PARSE_REMITTANCE_INTENT` is suppressed while a non-expired pending entry exists so unrelated text does not restart the flow.
 */

export {
  getPending,
  setPending,
  clearPending,
  isExpired,
  pendingKey,
} from "@sendflow/plugin-intent-parser";
