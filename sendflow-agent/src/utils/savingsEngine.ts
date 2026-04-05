/**
 * Western Union / MoneyGram comparison + lifetime savings ledger.
 * Core implementation lives in @sendflow/plugin-intent-parser (shared with NOTIFY_PARTIES).
 */
export {
  updateCachedSolPriceUsd,
  getCachedSolPriceUsd,
  calculateSavings,
  formatSavingsShareMessage,
  formatLifetimeSavingsReply,
  appendSavingsLedgerEntry,
  getLifetimeSavings,
  getLifetimeSavingsAsync,
  getPlatformSavings,
  getPlatformSavingsSync,
  initSavingsPlatformAggregates,
  consumeSavingsMilestones,
  buildReferralLink,
  __resetSavingsEngineForTests,
  type SavingsResult,
  type SavingsLedgerEntry,
  type SavingsCalculateOptions,
  type SavingsRegion,
} from "@sendflow/plugin-intent-parser";
