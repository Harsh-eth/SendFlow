import type { Plugin } from "@elizaos/core";
import { parseRemittanceIntentAction } from "./actions/parseRemittanceIntent";
import { manageContactsAction } from "./actions/manageContacts";
import { parseSplitIntentAction } from "./actions/parseSplitIntent";
import { parseConditionalIntentAction } from "./actions/parseConditionalIntent";
import { requestPaymentAction } from "./actions/requestPayment";
import { createInvoiceAction } from "./actions/createInvoice";
import { scheduleTransferAction } from "./actions/scheduleTransfer";

export const sendflowIntentParserPlugin: Plugin = {
  name: "sendflow-intent-parser",
  description:
    "SendFlow: parse natural-language remittance intent (Solana USDC, SPL rails).",
  actions: [parseRemittanceIntentAction, manageContactsAction, parseSplitIntentAction, parseConditionalIntentAction, requestPaymentAction, createInvoiceAction, scheduleTransferAction],
  providers: [],
  services: [],
};

export default sendflowIntentParserPlugin;
export { parseRemittanceIntentAction, extractAmountFromText } from "./actions/parseRemittanceIntent";
export {
  tryExtractPhoneRemittance,
  normalizePhoneNumber,
  type PhoneRemittanceDetect,
} from "./utils/phoneRemittance";
export { lookupLinkedWalletForPhone, linkPhoneWallet } from "./utils/phoneWalletLinks";
export { manageContactsAction };
export { parseSplitIntentAction };
export { parseConditionalIntentAction };
export { requestPaymentAction };
export { createInvoiceAction };
export { scheduleTransferAction };
export {
  startScheduler,
  stopScheduler,
  addSchedule,
  cancelSchedule,
  cancelScheduleByLabel,
  listSchedules,
  deactivateAllSchedulesForUser,
  type RecurringTransfer,
} from "./utils/scheduler";
export {
  createInvoice,
  getInvoice,
  getLatestInvoiceForCreator,
  markInvoicePaid,
  type Invoice,
} from "./utils/invoiceStore";
export {
  createRequest,
  getRequest,
  getPendingForTarget,
  getPendingForEntity,
  markPaid,
  markDeclined,
  registerWalletEntity,
  getEntityForWallet,
  type PaymentRequest,
} from "./utils/paymentRequests";
export {
  startPriceMonitor,
  stopPriceMonitor,
  addConditionalTransfer,
  cancelConditionalTransfer,
  getConditionalTransfer,
  type ConditionalTransfer,
} from "./utils/priceMonitor";
export { saveContact, getContact, listContacts, deleteContact } from "./utils/contactBook";
export * from "./types";
export { isValidReceiverWallet, extractSolanaAddress } from "./utils/solanaAddress";
export { resolveSolDomain, extractSolDomain } from "./utils/resolveDomain";
export { shortWallet, htmlWallet, solscanTxLink, solscanAddrLink } from "./utils/format";
export {
  type TokenInfo,
  TOKEN_REGISTRY,
  lookupToken,
  detectTokenFromText,
  tokenEmoji,
} from "./utils/tokenRegistry";
export {
  type SpeedMode,
  PRIORITY_FEES,
  detectSpeedMode,
  speedLabel,
  priorityFeeIx,
  estimatedExtraFee,
} from "./utils/priorityFee";
export { simulateTransaction, type SimulationResult } from "./utils/simulateTx";
export {
  type Language,
  detectLanguage,
  t,
  setUserLanguage,
  getUserLanguage,
} from "./utils/i18n";
export {
  type TxRecord as SharedTxRecord,
  recordTransaction as sharedRecordTransaction,
  getTransactions as sharedGetTransactions,
  getLastTransfer as sharedGetLastTransfer,
  getLastTransferTo as sharedGetLastTransferTo,
  getAllTransfers as sharedGetAllTransfers,
  getAllTransferUserIds as sharedGetAllTransferUserIds,
} from "./utils/txStore";
export {
  type PendingRateSnapshot,
  type PendingEntry,
  pendingKey,
  setPending,
  getPending,
  clearPending,
  clearAllPendingForEntity,
  isExpired,
  isProcessing,
  setProcessing,
  clearProcessing,
  getLastRequestTime,
  setLastRequestTime,
} from "./pendingFlow";
export {
  verifyTransactionIntegrity,
  type VerifyTxParams,
  simulateAndVerifyCore,
  simulateAndVerifyVersionedCore,
  buildAllowedPrograms,
  parseSplTransfers,
  type TokenTransfer,
  type SimResult,
  type SimulateAndVerifyParams,
  type SimulateVerifyMode,
  type RawTokenTransfer,
} from "./utils/txVerifier";
export { assertSignatureNotReplay, recordSubmittedSignature } from "./utils/txReplayGuard";
export {
  isBlocklistedWallet,
  __resetWalletBlocklistForTests,
  __setWalletBlocklistForTests,
} from "./utils/walletBlocklist";
export { TRANSFER_LIMITS, validateTransferAmount } from "./utils/transferLimits";
export {
  enqueueRpcRetry,
  getDueRetries,
  scheduleRetry,
  removeRetry,
  getRpcQueueSize,
  type RpcRetryItem,
} from "./utils/rpcRetryQueue";
export {
  log,
  logTransfer,
  logSecurity,
  logPerformance,
  loggerCompat,
} from "./utils/structuredLogger";
export {
  updateCachedSolPriceUsd,
  getCachedSolPriceUsd,
  calculateSavings,
  formatSavingsShareMessage,
  formatLifetimeSavingsReply,
  appendSavingsLedgerEntry,
  getLifetimeSavings,
  getTotalSaved,
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
} from "./utils/savingsEngine";
export { classifyTransferFailure } from "./utils/transferFailureClassify";
export { persistLoad, persistSave } from "./utils/persistence";
export {
  type SendFlowId,
  claimUsername,
  resolveUsername,
  getProfile,
  updateProfile,
  isValidUsername,
  addTotalReceived,
} from "./utils/sendflowId";
export {
  type SponsorshipRecord,
  isEligibleForSponsorship,
  recordSponsoredTx,
  getRemainingFreeTransfers,
  getSponsorshipMessage,
} from "./utils/feeSponsorship";
