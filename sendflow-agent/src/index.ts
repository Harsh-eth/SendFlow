import "./startupProductionGate";
import {
  AgentRuntime,
  InMemoryDatabaseAdapter,
  ModelType,
  type ActionResult,
  type IAgentRuntime,
  type Memory,
  type State,
  type HandlerCallback,
} from "@elizaos/core";
import { TelegramService } from "@elizaos/plugin-telegram";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sendflowCharacter } from "./character";
import {
  isNewUser,
  markSeen,
  hasCompletedWelcomeOnboarding,
  markWelcomeOnboardingComplete,
  HELP_MESSAGE,
  getLastSeen,
  updateLastSeen,
  getAllSeenUserIds,
} from "./utils/userRegistry";
import { loadMemory, saveMemory, updateStats, checkBudget } from "./utils/userMemory";
import { mintTransferReceipt, type ReceiptMetadata } from "./utils/mintReceipt";
import { trackTransactionStatus } from "./utils/txTracker";
import {
  createCustodialWallet,
  getCustodialWallet,
  exportPrivateKeyBase58OneShot,
  ensureWalletDataDir,
} from "./utils/custodialWallet";
import {
  mainMenuKeyboard,
  afterTransferKeyboard,
  settingsKeyboard,
  amountKeyboard,
  contactsKeyboard,
  payLinkAmountKeyboard,
  approvalKeyboard,
  profileKeyboard,
  cryptoReplyKeyboard,
  rollbackKeyboard,
  loanKeyboard,
  helpKeyboard,
  streamKeyboard,
  posKeyboard,
  swapKeyboard,
  exportKeyboard,
  leaderboardKeyboard,
  marketKeyboard,
  savingsKeyboard,
  confirmKeyboard,
  behavioralConfirmKeyboard,
  challengeKeyboard,
  achievementUnlockedKeyboard,
  feedFooterKeyboard,
  type InlineKeyboard,
} from "./utils/keyboards";
import { generateWalletQR } from "./utils/qrGenerator";
import {
  startWizard,
  getWizard,
  updateWizard,
  clearWizard,
  isInWizard,
  setBehavioralWizardPending,
  clearBehavioralWizardPending,
} from "./utils/wizardState";
import { createPayLink, parsePayLink } from "./utils/payLinks";
import { depositToVault, withdrawFromVault, getVaultPosition, calculateEarnings, getBestYield } from "./utils/savingsVault";
import { addPriceAlert, listAlerts, startPriceAlertMonitor, parsePriceAlertCommand } from "./utils/priceAlerts";
import { getMarketPulse } from "./utils/marketPulse";
import {
  isGroupMessage,
  isBotMentioned,
  stripBotMention,
  registerUsername,
  extractMentionedUsernames,
  getUserIdForUsername,
} from "./utils/groupHandler";
import { enableDigest, disableDigest, isDigestEnabled, startDigestScheduler } from "./utils/dailyDigest";
import { enableBusiness, isBusinessMode, exportTransactionsCSV, setWebhook } from "./utils/businessMode";
import { transcribeVoice, downloadTelegramFile } from "./utils/voiceHandler";
import {
  checkRateLimit,
  recordRequest,
  recordViolation,
  isPermanentlyBlocked,
} from "./utils/rateLimiter";
import { analyzeMessage, analyzeTransaction, markTransferCompleted } from "./utils/fraudDetection";
import {
  recordUserMessage,
  loadProfile,
  scoreAnomaly,
  stepUpIfNeededWithKeyboard,
  recordTransferForProfile,
  isFrozen,
  freezeAccount,
  unfreezeAccount,
  notifyAdminFreeze,
  takeBehavioralPending,
  pruneExpiredBehavioralPending,
  type TelegramContext,
} from "./utils/behavioralAuth";
import {
  setupPin,
  verifyPin,
  hasPin,
  recordPinFailure,
  isPinBlocked,
  clearPinFailures,
} from "./utils/pinAuth";
import { getHealthyConnection, getCurrentRpcUrl } from "./utils/rpcManager";
import {
  logTransfer,
  logSecurity,
  loggerCompat as logger,
  log,
  auditLog,
  hashRecipientAddress,
} from "./utils/structuredLogger";
import {
  loadMetricsState,
  recordTransferResult,
  noteUserActive24h,
  recordVolume24h,
  recordOnboardingFirstAction,
} from "./utils/metricsState";
import { runStartupSelfTest } from "./utils/startupSelfTest";
import { setDegradedMode, degradedTransferSuffix } from "./utils/degradedMode";
import { alert } from "./utils/adminAlerter";
import { formatAdminStatusMessage } from "./utils/adminStatus";
import { startHealthServer, metrics } from "./api/health";
import { getCrossChainAdvice } from "./utils/crossChainAdvisor";
import { getSwapQuote, executeSwap, USDC_MAINNET, SOL_MINT } from "./utils/tokenSwap";
import { issueVirtualCard, freezeCard, cardProviderMode } from "./utils/virtualCard";
import { generateInsight, setInsightsDisabled, isInsightsDisabled } from "./utils/spendingCoach";
import { joinLeaderboard, getTopSenders, getUserRank, totalNetworkVolume, updateLeaderboard } from "./utils/leaderboard";
import {
  getQueueStatus as getTxQueueStatus,
  getAllQueued,
  processRpcRetryQueue,
} from "./utils/txQueue";
import {
  setApproverTelegramId,
  getApproverTelegramId,
  approveTransfer,
  rejectTransfer,
  requestApproval,
  storePendingExecution,
  getPendingExecution,
  removePendingExecution,
  executeAfterApproval,
  coerceRateSnapshot,
  getExpiredPendingExecutionIds,
  removeApprovalRequest,
  getApproval,
} from "./utils/multiSigApproval";
import {
  parseRemittanceIntentAction,
  clearProcessing,
  setProcessing,
  getPending,
  isExpired,
  sharedGetAllTransfers,
  type SharedTxRecord,
  manageContactsAction,
  parseSplitIntentAction,
  parseConditionalIntentAction,
  requestPaymentAction,
  createInvoiceAction,
  scheduleTransferAction,
  startPriceMonitor,
  startScheduler,
  getInvoice,
  detectLanguage,
  setUserLanguage,
  getUserLanguage,
  type ConditionalTransfer,
  type RecurringTransfer,
  getLatestInvoiceForCreator,
  extractSolanaAddress,
  resolveSolDomain,
  extractSolDomain,
  sharedGetLastTransfer,
  shortWallet,
  initSavingsPlatformAggregates,
  getLifetimeSavings,
  formatLifetimeSavingsReply,
  TRANSFER_LIMITS,
  sharedGetAllTransferUserIds,
  type RemittanceIntent,
} from "@sendflow/plugin-intent-parser";
import { categorizeTransfer, formatMonthlySpendingReport } from "./utils/spendingCategories";
import { emergencyFreeze, generateRecoveryCodes, useRecoveryCode } from "./utils/emergencyStop";
import { setDisplayCurrency, formatConversionLine, getExchangeRate } from "./utils/currencyDisplay";
import {
  checkRemittanceRateAction,
  confirmSendflowAction,
} from "@sendflow/plugin-rate-checker";
import {
  lockUsdcEscrowAction,
  checkBalanceAction,
  showStatsAction,
  watchWalletAction,
  setWatchNotifyCallback,
} from "@sendflow/plugin-usdc-handler";
import { routePayoutAction } from "@sendflow/plugin-payout-router";
import {
  notifyPartiesAction,
  transactionHistoryAction,
  recordTransaction,
} from "@sendflow/plugin-notifier";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  claimUsername,
  getProfile,
  updateProfile,
} from "./utils/sendflowId";
import {
  calculateCreditScore,
  getMaxLoanAmount,
  applyForLoan,
  disburseLoan,
  repayLoan,
  checkOverdueLoans,
  getActiveLoan,
  getLoanById,
  type LoanApplication,
} from "./utils/microLoan";
import {
  startStream,
  pauseStream,
  resumeStream,
  getStreamStatus,
  calculateStreamed,
  settleStream,
  endStream,
  getUserStreamsMap,
  getStreamsMap,
} from "./utils/streamPayment";
import {
  createTreasury,
  addMember,
  createProposal,
  voteOnProposal,
  executeProposal,
  getTreasuryStatus,
  findTreasuryByName,
  getUserTreasuryId,
  findTreasuryIdByProposalId,
} from "./utils/daoTreasury";
import {
  enablePOS,
  disablePOS,
  createPOSInvoice,
  getDailySummary,
  generatePOSQR,
  getPOSSession,
} from "./utils/merchantPOS";
import { scheduleWeeklyReports } from "./utils/financialAdvisor";
import {
  generateTransferBlink,
  generateInvoiceBlink,
  generateProfileBlink,
  formatBlinkMessage,
} from "./utils/blinksGenerator";
import { generateStatusCard } from "./utils/statusCard";
import { runDemo } from "./utils/demoMode";
import {
  stakeUsdc,
  getStakePosition,
  calculateEarned,
  isMatured,
  withdrawStake,
  getStakeKeyboard,
  getStakeStatusKeyboard,
  REWARD_RATES,
} from "./utils/earnProtocol";
import {
  openRollbackWindow,
  expireRollback,
  executeRollback,
  getRollbackWindow,
} from "./utils/rollbackManager";
import {
  createPaymentPage,
  getPaymentPage,
  listPaymentPages,
  disablePaymentPage,
} from "./utils/paymentPage";
import {
  createBillSplit,
  formatSplitMessage,
  getActiveSplitForGroup,
  recordPayment,
  getSplitStatus,
} from "./utils/groupBillSplit";
import { isCryptoQuestion, answerCryptoQuestion } from "./utils/cryptoAssistant";
import { rememberUserLocale, getUserLocale } from "./utils/countryDetector";
import { formatCompetitorBlock, formatLocalizedWuLine, recordTransferSavings } from "./utils/costComparison";
import { formatOnRampReply, getOnRampKeyboard } from "./utils/onRamp";
import { formatOffRampReply, getOffRampKeyboard } from "./utils/offRamp";
import { createPendingReceipt, getReceiptById, claimReceipt, expireOldReceipts } from "./utils/recipientOnboarding";
import { createGoal, getGoals, getProgress, depositToGoal, setAutoSavePercent } from "./utils/savingsGoal";
import {
  executePhoneClaimSend,
  executePhoneClaimPayout,
  handlePhoneClaimDeepLinkStart,
  sweepExpiredPhoneClaims,
} from "./utils/phoneClaimFlow";
import {
  startOnboarding,
  runWelcomeOnboarding,
  advanceOnboarding,
  completeOnboarding,
  isOnboardingComplete,
  getOnboardingStats,
  onboardingHookKeyboard,
  onboardingDemoKeyboard,
  onboardingCompleteKeyboard,
  scheduleOnboardingReminder,
  cancelOnboardingReminder,
  setOnboardingStep,
} from "./utils/onboardingFlow";
import { recordActivity, getStreak, checkStreakReward, payStreakReward } from "./utils/streakSystem";
import {
  assignUserNumber,
  getNewlyUnlocked,
  grantAchievement,
  generateAchievementCard,
  twitterShareUrl,
  recordDaoVote,
  ACHIEVEMENTS,
} from "./utils/achievements";
import {
  generateReferralLink,
  trackReferral,
  getReferralStats,
  getReferrerOf,
  markReferralPaid,
  hasCompletedFirstTransfer,
  getReferralEarnings,
  getReferralTree,
} from "./utils/referralSystem";
import {
  getCurrentChallenge,
  getChallengeLeaderboard,
  bumpChallengeForUser,
  rotateChallengeIfNeeded,
  topThreeForNotify,
} from "./utils/weeklyChallenge";
import { scheduleSmartNotifications, touchLastActive } from "./utils/notificationEngine";
import { addFeedEvent, getRecentFeed, formatFeedMessage, recordHourlyTransfer } from "./utils/activityFeed";
import { getContext, updateContext } from "./utils/conversationContext";
import { isShortcut, handleShortcut } from "./utils/commandShortcuts";
import { getErrorSuggestion, formatErrorMessage } from "./utils/errorRecovery";
import { trackFeatureDiscovery, getCohortReport } from "./utils/cohortTracker";
import {
  noteFirstTransfer,
  recordTransferVolume,
  incrementFeatureUsage,
  recordDailyActive,
  buildSendFlowMetrics,
  registerNewUser,
  getTotalSavedVsWu,
  getAccountAgeDays,
} from "./utils/growthMetrics";
import { classifyMessage } from "./utils/threatClassifier";
import { isE2eMode, pushE2eReply, resetE2eCapture, setE2eThreat, getE2eCaptureSnapshot } from "./e2e/capture";
import { recordOffRampVelocityAttempt } from "./utils/offrampOracle";
const __dirname = dirname(fileURLToPath(import.meta.url));

const pendingLoanApp = new Map<string, LoanApplication>();
const pendingStakeAmount = new Map<string, number>();
/** NL stake preview awaiting Confirm/Cancel */
const pendingStakePreview = new Map<string, { amount: number; lockDays: 7 | 30 | 90 }>();
/** Pending USDC→SOL swap amount after quote */
const pendingSwapAmount = new Map<string, number>();
/** Awaiting 6-digit PIN before wallet key export countdown */
const exportPinAwaiting = new Set<string>();
/** Active export countdown — call value to cancel timer and delete countdown message */
const exportCountdownCancel = new Map<string, () => void>();
let lastChallengeBroadcastId = "";
let lastTop3NotifyBucket = "";
let lastMonthlyReportMonth = "";

function escapeHtmlLite(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function getTimeBasedGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Ollama/Nosana can exceed default fetch timeouts on cold GPU; align with Telegraf handler timeout. */
const OLLAMA_FETCH_TIMEOUT_MS = 180_000;
/** Telegraf defaults `handlerTimeout` to 90s; LLM work inside a Telegram update must allow longer. */
const TELEGRAM_HANDLER_TIMEOUT_MS = 180_000;

const ollamaFetchSignal = (): AbortSignal => AbortSignal.timeout(OLLAMA_FETCH_TIMEOUT_MS);

/**
 * ElizaOS embeds three checkpoint UUIDs in its prompt:
 *   "initial code: <uuid>" / "middle code: <uuid>" / "end code: <uuid>"
 * The model must echo them back as <one_initial_code>, etc.
 * Qwen 9B doesn't follow this instruction, so we extract them from
 * the prompt and inject them into the response ourselves.
 */
function extractCheckpointUuids(prompt: string): { init?: string; mid?: string; end?: string } {
  const init = prompt.match(/initial code:\s*([0-9a-f-]{36})/i)?.[1];
  const mid = prompt.match(/middle code:\s*([0-9a-f-]{36})/i)?.[1];
  const end = prompt.match(/end code:\s*([0-9a-f-]{36})/i)?.[1];
  return { init, mid, end };
}

function injectCheckpointUuids(
  responseXml: string,
  uuids: { init?: string; mid?: string; end?: string }
): string {
  if (!uuids.init && !uuids.mid && !uuids.end) return responseXml;
  let xml = responseXml;
  if (uuids.init && !xml.includes("<one_initial_code>")) {
    xml = xml.replace(/<response>/i, `<response>\n<one_initial_code>${uuids.init}</one_initial_code>`);
  }
  if (uuids.mid && !xml.includes("<one_middle_code>")) {
    xml = xml.replace(/<\/response>/i, `<one_middle_code>${uuids.mid}</one_middle_code>\n</response>`);
  }
  if (uuids.end && !xml.includes("<one_end_code>")) {
    xml = xml.replace(/<\/response>/i, `<one_end_code>${uuids.end}</one_end_code>\n</response>`);
  }
  return xml;
}

/**
 * Qwen may emit thinking blocks and extra XML before `<response>`, which breaks Eliza's parser.
 * Keep only the Eliza `<response>...</response>` envelope expected by the runtime.
 */
function cleanElizaXmlTextContent(raw: string): string {
  let content = raw;
  content = content.replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "");
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  content = content.replace(/^[\s\S]*?(<response>)/i, "$1");
  content = content.replace(/<\/response>[\s\S]*$/i, "</response>");
  return content.trim();
}

/** Strip thinking noise and isolate JSON for OBJECT_SMALL when the model wraps output. */
function cleanJsonObjectStringFromLlm(raw: string): string {
  let s = raw;
  s = s.replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, "");
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  s = s.trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s.trim();
}

/** Assistant text from Ollama `POST /api/chat` (OBJECT_SMALL). Qwen may use `message.thinking` when `content` is empty. */
function extractOllamaChatContent(data: Record<string, unknown>): string {
  const msg = data.message;
  if (msg && typeof msg === "object" && msg !== null) {
    const m = msg as { content?: unknown; thinking?: unknown };
    if (typeof m.content === "string" && m.content.trim()) return m.content;
    if (typeof m.thinking === "string" && m.thinking.trim()) return m.thinking;
    if (typeof m.content === "string") return m.content;
  }
  const r = data.response;
  if (typeof r === "string" && r.trim()) return r;
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as { message?: { content?: string; thinking?: string } };
    const txt = first?.message?.content;
    if (typeof txt === "string" && txt.trim()) return txt;
    const th = first?.message?.thinking;
    if (typeof th === "string" && th.trim()) return th;
  }
  return "";
}

const SENDFLOW_SYSTEM_PROMPT = [
  "You are SendFlow, a Solana-native USDC remittance agent running inside ElizaOS, powered by Nosana GPU.",
  "CRITICAL action selection rules:",
  "- When the user wants to send USDC/money (mentions amount, wallet, send, transfer, swap), use <actions>PARSE_REMITTANCE_INTENT</actions>",
  "- When the user replies YES/Y or NO/N to confirm/decline a pending transfer, use <actions>CONFIRM_SENDFLOW</actions>",
  "- When the user asks about their balance/wallet/funds, use <actions>CHECK_BALANCE</actions>",
  "- When the user asks about history/transactions/past transfers/repeat last, use <actions>TRANSACTION_HISTORY</actions>",
  "- When the user wants to save/list/delete contacts, use <actions>MANAGE_CONTACTS</actions>",
  "- When the user wants to split a payment between multiple people, use <actions>PARSE_SPLIT_INTENT</actions>",
  "- When the user sets a conditional price-based transfer (when SOL hits X), use <actions>CONDITIONAL_TRANSFER</actions>",
  "- When the user requests money from someone, use <actions>REQUEST_PAYMENT</actions>",
  "- When the user asks for stats/analytics/spending, use <actions>SHOW_STATS</actions>",
  "- When the user wants to watch/monitor a wallet, use <actions>WATCH_WALLET</actions>",
  "- When the user wants to create an invoice/payment link, use <actions>CREATE_INVOICE</actions>",
  "- When the user wants to schedule recurring transfers, use <actions>SCHEDULE_TRANSFER</actions>",
  "- Only use <actions>REPLY</actions> for general conversation with no transaction intent",
].join("\n");

function overrideReplyAction(prompt: string, response: string): string {
  if (!/<actions>\s*REPLY\s*<\/actions>/i.test(response)) return response;

  const tail = prompt.slice(-400).trim();
  const lower = tail.toLowerCase();

  const replace = (action: string) => {
    logger.info(`ACTION OVERRIDE: REPLY → ${action}`);
    return response.replace(/<actions>\s*REPLY\s*<\/actions>/i, `<actions>${action}</actions>`);
  };

  if (/\b(?:balance|my\s*wallet|my\s*usdc|how\s*much\s+(?:do\s+i\s+have|usdc)|funds)\s*$/i.test(lower))
    return replace("CHECK_BALANCE");

  if (/\b(?:history|transactions?|past\s*transfers?|my\s*tx|repeat\s*last|last\s*transfer|send\s*again)\b/i.test(lower))
    return replace("TRANSACTION_HISTORY");

  if (/\b(?:save\s+(?:wallet|contact)|add\s+contact|show\s+(?:my\s+)?contacts|list\s+contacts|delete\s+contact|my\s+contacts)\b/i.test(lower))
    return replace("MANAGE_CONTACTS");

  if (/\b(?:split|each\s+to|equally\s+between|equally\s+among)\b/i.test(lower))
    return replace("PARSE_SPLIT_INTENT");

  if (/\b(?:when\s+\w+\s+(?:price\s+)?(?:is\s+)?(?:hits?|reaches?|above|below)|only\s+when|cancel\s+conditional)\b/i.test(lower))
    return replace("CONDITIONAL_TRANSFER");

  if (/\b(?:request\s+\d|ask\s+\S+\s+to\s+send)\b/i.test(lower))
    return replace("REQUEST_PAYMENT");

  if (/\b(?:stats|analytics|how\s+much\s+(?:have\s+i\s+)?sent|spending|my\s+stats)\b/i.test(lower))
    return replace("SHOW_STATS");

  if (/\b(?:watch|alert\s+me|notify\s+me|monitor|stop\s+watch|my\s+watches)\b/i.test(lower))
    return replace("WATCH_WALLET");

  if (/\b(?:create\s+invoice|generate\s+(?:invoice|payment\s+link)|payment\s+link)\b/i.test(lower))
    return replace("CREATE_INVOICE");

  if (/\b(?:every\s+\w+|recurring|schedule|weekly|monthly|daily|cancel\s+recurring|my\s+schedules)\b/i.test(lower))
    return replace("SCHEDULE_TRANSFER");

  if (prompt.includes("CONFIRM_SENDFLOW")) {
    const shortTail = prompt.slice(-100).trim();
    if (/\b(?:yes|y|no|n)\s*$/i.test(shortTail)) return replace("CONFIRM_SENDFLOW");
  }

  if (/\b(?:referral|my\s+referral|referral\s+link|referral\s+stats)\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:switch\s+to\s+(?:hindi|spanish|tagalog|swahili|english))\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:market|crypto\s+news|market\s+pulse|what's\s+happening)\b/i.test(lower))
    return replace("REPLY");

  if (/\balert\s+(?:me\s+)?when\s+\w+\s+(?:hits?|reaches?|drops?|pumps?|depegs?)/i.test(lower))
    return replace("REPLY");

  if (/\b(?:save|deposit)\s+\d+(?:\.\d+)?\s*usdc\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:withdraw|my\s+savings|vault\s+balance|how\s+much\s+am\s+i\s+earning)\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:enable\s+business|export\s+csv|my\s+pay\s*link|create\s+pay\s*link)\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:my\s+qr|qr\s+code|confirm\s+export|backup\s+wallet)\b/i.test(lower))
    return replace("REPLY");

  if (/\b(?:daily\s+digest|daily\s+updates?|stop\s+daily|enable\s+digest)\b/i.test(lower))
    return replace("REPLY");

  if (prompt.includes("PARSE_REMITTANCE_INTENT")) {
    const hasAmount = /\b\d+(?:\.\d+)?\s*(?:usdc|usd|sol|bonk|jup|wif|pyth)\b/i.test(lower);
    const hasWallet = /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(tail);
    const hasSolDomain = /\b\w+\.sol\b/.test(lower);
    if (hasAmount && (hasWallet || hasSolDomain)) return replace("PARSE_REMITTANCE_INTENT");
  }

  return response;
}

/** Eliza `getSetting()` does not read `process.env`; mirror env here so plugins (e.g. Telegram) see the same vars. */
function envAsRuntimeSettings(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== "")
  );
}

function loadEscrowPk(): Keypair | null {
  const s = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    try {
      const json = JSON.parse(s) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(json));
    } catch {
      return null;
    }
  }
}

function ollamaBaseFromNosanaEndpoint(endpoint: string): string {
  const u = new URL(endpoint.trim());
  return `${u.protocol}//${u.host}`;
}

function nosanaHeaders(apiKey: string | undefined): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    h.Authorization = `Bearer ${apiKey}`;
  }
  return h;
}

/** Prefer Qwen 3.5 9B–style tags when multiple models exist. */
function pickPreferredOllamaModel(names: string[]): string | null {
  if (!names.length) return null;
  const score = (name: string) => {
    const n = name.toLowerCase();
    let s = 0;
    if (n.includes("qwen")) s += 2;
    if (/3[._:]?5|3\.5/.test(n)) s += 3;
    if (n.includes("9b") || /\b9\b/.test(n)) s += 3;
    return s;
  };
  return [...names].sort((a, b) => score(b) - score(a))[0] ?? null;
}

async function fetchOllamaModelNameFromTags(
  ollamaBase: string,
  apiKey: string | undefined
): Promise<string | null> {
  const url = `${ollamaBase.replace(/\/$/, "")}/api/tags`;
  try {
    const res = await fetch(url, {
      headers: nosanaHeaders(apiKey),
      signal: ollamaFetchSignal(),
    });
    if (!res.ok) {
      logger.warn(`Ollama GET /api/tags failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    const picked = pickPreferredOllamaModel(names);
    if (picked) {
      logger.info(`Ollama models from /api/tags: ${names.join(", ")} → using ${picked}`);
    }
    return picked;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`Ollama /api/tags request failed: ${msg}`);
    return null;
  }
}

async function persistElizaModelToEnvFiles(model: string): Promise<void> {
  if (process.env.SENDFLOW_E2E === "1" && process.env.NODE_ENV === "test") return;
  const paths = [join(__dirname, "..", ".env"), join(__dirname, "..", "..", ".env")];
  for (const p of paths) {
    try {
      const text = await readFile(p, "utf8");
      const next = /^ELIZA_MODEL=/m.test(text)
        ? text.replace(/^ELIZA_MODEL=.*$/m, `ELIZA_MODEL=${model}`)
        : `${text.trimEnd()}\nELIZA_MODEL=${model}\n`;
      await writeFile(p, next, "utf8");
    } catch {
      /* missing or unreadable */
    }
  }
}

/** Telegraf wraps each update with `p-timeout` using `options.handlerTimeout` (default 90s). Use the instance from `TelegramService.start()` — `runtime.getService('telegram')` may not be ready immediately after start. */
function applyTelegramHandlerTimeout(
  svc: { bot?: { options?: { handlerTimeout?: number }; handlerTimeout?: number } } | null | undefined,
  ms: number
): void {
  if (svc?.bot?.options) {
    svc.bot.options.handlerTimeout = ms;
    logger.info(`Telegram handlerTimeout set to ${ms / 1000}s`);
  }
  if (svc?.bot) {
    (svc.bot as { handlerTimeout?: number }).handlerTimeout = ms;
  }
}

async function resolveOllamaModelAndSyncEnv(): Promise<{ ollamaBase: string; model: string } | null> {
  const raw = process.env.NOSANA_LLM_ENDPOINT?.trim();
  if (!raw) {
    return null;
  }
  const ollamaBase = ollamaBaseFromNosanaEndpoint(raw);
  const apiKey = process.env.NOSANA_API_KEY?.trim() || undefined;
  const discovered = await fetchOllamaModelNameFromTags(ollamaBase, apiKey);
  const fallback = process.env.ELIZA_MODEL?.trim() || "qwen3.5:9b";
  const model = discovered ?? fallback;
  if (discovered) {
    process.env.ELIZA_MODEL = model;
    await persistElizaModelToEnvFiles(model);
  }
  return { ollamaBase, model };
}

async function checkLlmHealth(): Promise<boolean> {
  const endpoint = process.env.NOSANA_LLM_ENDPOINT?.trim();
  if (!endpoint) {
    log.warn("llm.health", { status: "no endpoint configured" });
    return false;
  }
  try {
    const origin = new URL(endpoint).origin;
    const res = await fetch(`${origin}/api/tags`, {
      headers: nosanaHeaders(process.env.NOSANA_API_KEY?.trim() || undefined),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function registerNosanaModels(
  runtime: IAgentRuntime,
  ollamaBase: string,
  resolvedModel: string
): void {
  const chatUrl = `${ollamaBase.replace(/\/$/, "")}/api/chat`;
  const generateUrl = `${ollamaBase.replace(/\/$/, "")}/api/generate`;

  const headersFor = (rt: IAgentRuntime): Record<string, string> => {
    const key = rt.getSetting("NOSANA_API_KEY");
    return nosanaHeaders(typeof key === "string" && key ? key : undefined);
  };

  const modelFor = (rt: IAgentRuntime): string => {
    const s = rt.getSetting("ELIZA_MODEL");
    return typeof s === "string" && s.trim() ? s.trim() : resolvedModel;
  };

  const ollamaGenerateText = async (
    rt: IAgentRuntime,
    params: Record<string, unknown>
  ): Promise<string> => {
      if (!ollamaBase.trim()) {
        return "";
      }
      const prompt =
        typeof params.prompt === "string" ? params.prompt : String(params.prompt ?? "");
      const checkpoints = extractCheckpointUuids(prompt);
      const model = modelFor(rt);
      const body = {
        model,
        system: SENDFLOW_SYSTEM_PROMPT,
        prompt,
        stream: false,
        think: false,
        keep_alive: "10m",
        options: {
          temperature: 0.1,
          num_predict: 2000,
          top_p: 0.9,
        },
      };
      try {
        const res = await fetch(generateUrl, {
          method: "POST",
          headers: headersFor(rt),
          signal: ollamaFetchSignal(),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as Record<string, unknown>;
        logger.info(`RAW OLLAMA RESPONSE: ${JSON.stringify(data).substring(0, 1500)}`);
        const rawText = typeof data.response === "string" ? data.response : "";
        logger.info(`RAW response field (${rawText.length} chars): ${rawText.substring(0, 800)}`);
        logger.info(`done_reason: ${data.done_reason ?? "N/A"}`);
        if (!rawText.trim()) {
          logger.warn("Ollama TEXT: empty data.response from /api/generate (is think:false set?)");
          return "";
        }
        let processedContent = cleanElizaXmlTextContent(rawText);
        processedContent = injectCheckpointUuids(processedContent, checkpoints);
        processedContent = overrideReplyAction(prompt, processedContent);
        logger.info(`LLM final response (${processedContent.length} chars): ${processedContent.substring(0, 500)}`);
        return processedContent;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Ollama TEXT (/api/generate) failed: ${msg}`);
        return "";
      }
    };

  runtime.registerModel(
    ModelType.OBJECT_SMALL,
    async (rt, params) => {
      if (!ollamaBase) {
        return {};
      }
      const prompt = (params as { prompt?: string }).prompt ?? "";
      const schema = (params as { schema?: unknown }).schema;
      let content = prompt;
      if (schema !== undefined) {
        content = `${prompt}\n\nRespond with JSON only matching this schema:\n${JSON.stringify(schema)}`;
      }
      try {
        const res = await fetch(chatUrl, {
          method: "POST",
          headers: headersFor(rt),
          signal: ollamaFetchSignal(),
          body: JSON.stringify({
            model: modelFor(rt),
            messages: [{ role: "user", content }],
            stream: false,
            think: false,
            format: "json",
            keep_alive: "10m",
            options: {
              temperature: 0.1,
              num_predict: 1000,
              top_p: 0.9,
            },
          }),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const data = (await res.json()) as Record<string, unknown>;
        logger.info(`RAW OLLAMA OBJECT_SMALL: ${JSON.stringify(data).substring(0, 500)}`);
        const raw = extractOllamaChatContent(data);
        if (typeof raw !== "string" || !raw.trim()) {
          return {};
        }
        const jsonSlice = cleanJsonObjectStringFromLlm(raw);
        try {
          return JSON.parse(jsonSlice) as Record<string, unknown>;
        } catch {
          logger.warn("Ollama OBJECT_SMALL: response was not valid JSON");
          return {};
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Ollama OBJECT_SMALL failed: ${msg}`);
        return {};
      }
    },
    "nosana",
    100
  );

  runtime.registerModel(ModelType.TEXT_LARGE, ollamaGenerateText, "nosana", 100);
  runtime.registerModel(ModelType.TEXT_SMALL, ollamaGenerateText, "nosana", 100);

  /** Dummy embedding vector so `ensureEmbeddingDimension()` succeeds; length must match `EMBEDDING_DIMENSION` if you use real vectors later. */
  runtime.registerModel(
    ModelType.TEXT_EMBEDDING,
    async (rt) => {
      const raw = rt.getSetting("EMBEDDING_DIMENSION");
      const parsed =
        typeof raw === "string" || typeof raw === "number"
          ? parseInt(String(raw), 10)
          : NaN;
      const dim = Number.isFinite(parsed) && parsed > 0 ? parsed : 1536;
      return new Array<number>(dim).fill(0);
    },
    "nosana",
    100
  );
}

/* ── Action chaining ──────────────────────────────────────────────────────
 * ElizaOS fires ONE action per user message. We chain follow-up actions
 * so the full pipeline runs in a single conversational turn:
 *   PARSE_REMITTANCE_INTENT → CHECK_REMITTANCE_RATE
 *   CONFIRM_SENDFLOW (YES)  → LOCK_USDC_ESCROW → ROUTE_PAYOUT → NOTIFY_PARTIES
 * ────────────────────────────────────────────────────────────────────── */

/** User acknowledged CONFIRM for (userId:receiver) on first send to that wallet. */
const newRecipientConfirmed = new Set<string>();

function isFirstTimeSendTo(entityId: string, receiverWallet: string): boolean {
  const txs = sharedGetAllTransfers(entityId);
  return !txs.some((t) => t.receiverWallet === receiverWallet);
}

const _origParseHandler = parseRemittanceIntentAction.handler;
parseRemittanceIntentAction.handler = async (rt, msg, state, opts, cb) => {
  const result = await _origParseHandler.call(
    parseRemittanceIntentAction, rt, msg, state, opts, cb
  );
  const fallback = { success: false as const, text: "Parse failed" };
  const r = result ?? fallback;
  if (r.success) {
    const phoneClaim = (r.values?.sendflow as Record<string, unknown> | undefined)?.phoneClaim as
      | { normalizedPhone: string; amount: number }
      | undefined;
    if (phoneClaim) {
      logger.info(`CHAIN: PARSE phone claim → lock+notify (${phoneClaim.normalizedPhone}, ${phoneClaim.amount})`);
      return executePhoneClaimSend({
        runtime: rt,
        message: msg,
        normalizedPhone: phoneClaim.normalizedPhone,
        amount: phoneClaim.amount,
        state,
        opts,
        callback: cb,
        sendHtml: sendTgHtml,
      });
    }
  }
  logger.info(`CHAIN: PARSE result success=${r.success}, text=${r.text?.substring(0, 100)}`);
  if (!r.success) return r;
  const sfData = (r.values?.sendflow ?? {}) as Record<string, unknown>;
  if (!sfData.intent) {
    logger.warn("CHAIN: PARSE succeeded but no intent in values");
    return r;
  }
  logger.info(`CHAIN: intent parsed, chaining to CHECK_REMITTANCE_RATE`);

  const chainState = {
    ...(state ?? {}),
    values: {
      ...((state as Record<string, unknown>)?.values ?? {}),
      sendflow: {
        ...(((state as any)?.values?.sendflow ?? {}) as Record<string, unknown>),
        ...sfData,
      },
    },
  };

  try {
    logger.info("CHAIN: calling CHECK_REMITTANCE_RATE handler…");
    const rateResult = await checkRemittanceRateAction.handler(
      rt, msg, chainState as any, opts, cb
    );
    const rr = rateResult ?? { success: false as const, text: "Rate check failed" };
    logger.info(`CHAIN: CHECK_REMITTANCE_RATE returned success=${rr.success}, text=${rr.text?.substring(0, 120)}`);
    if (!rr.success && cb) {
      await cb({
        text: rr.text ?? "⚠️ Could not fetch rate.",
        source: msg.content.source,
      });
    }
    if (rr.success && cb && msg.entityId) {
      const intentNw = sfData.intent as { receiverWallet?: string } | undefined;
      const rw = String(intentNw?.receiverWallet ?? "");
      if (rw && isFirstTimeSendTo(msg.entityId as string, rw)) {
        await cb({
          text: "⚠️ <b>New recipient address</b> — You have not sent USDC to this wallet before. Verify the address, then type <b>CONFIRM</b> to authorize this transfer.",
          source: msg.content.source,
        });
      }
    }
    return rr;
  } catch (e) {
    logger.warn(`Chain to CHECK_REMITTANCE_RATE failed: ${e}`);
    if (cb) {
      await cb({
        text: "⚠️ Could not fetch rate. Please try again.",
        source: msg.content.source,
      });
    }
    return r;
  }
};

const pinAwaitingConfirm = new Set<string>();
const pinVerifiedForTransfer = new Set<string>();
const behavioralPinAwaiting = new Set<string>();
const behavioralStepUpSatisfied = new Set<string>();
type BehavioralResume = {
  rt: IAgentRuntime;
  msg: Memory;
  chainState: State;
  opts: Parameters<NonNullable<typeof confirmSendflowAction.handler>>[3];
  cb?: HandlerCallback;
  entityId: string;
  roomId: string;
};
const behavioralResumeByPendingId = new Map<string, BehavioralResume>();

const _origParseValidate = parseRemittanceIntentAction.validate;
parseRemittanceIntentAction.validate = async (rt: IAgentRuntime, msg: Memory, state?: State) => {
  const entityId = msg.entityId as string;
  const text = (msg.content?.text ?? "").trim();
  if (exportPinAwaiting.has(entityId) && /^\d{6}$/.test(text)) return true;
  if (exportCountdownCancel.has(entityId) && /^(cancel|abort)$/i.test(text)) return true;
  return _origParseValidate(rt, msg, state);
};

function parseYnLocal(t: string): "yes" | "no" | null {
  const x = t.trim().toLowerCase();
  if (x === "yes" || x === "y") return "yes";
  if (x === "no" || x === "n") return "no";
  return null;
}

const _origConfirmValidate = confirmSendflowAction.validate;
confirmSendflowAction.validate = async (rt: IAgentRuntime, msg: Memory, state?: State) => {
  const entityId = msg.entityId as string;
  const text = (msg.content.text ?? "").trim();
  if (/^\d{6}$/.test(text) && exportPinAwaiting.has(entityId)) return false;
  if (/^\d{6}$/.test(text) && pinAwaitingConfirm.has(entityId)) return true;
  if (/^CONFIRM$/i.test(text)) {
    const roomId = msg.roomId as string | undefined;
    if (roomId && entityId) {
      const pe = getPending(roomId, entityId);
      if (pe && !isExpired(pe) && pe.initiatorEntityId === entityId) return true;
    }
  }
  return _origConfirmValidate(rt, msg, state);
};

const _origConfirmHandler = confirmSendflowAction.handler;
confirmSendflowAction.handler = async (
  rt: IAgentRuntime,
  msg: Memory,
  state: State | undefined,
  opts: Parameters<NonNullable<typeof _origConfirmHandler>>[3],
  cb?: HandlerCallback
) => {
  const entityId = msg.entityId as string;
  const roomId = msg.roomId as string;
  const text = (msg.content.text ?? "").trim();
  const p = getPending(roomId, entityId);

  if (/^\d{6}$/.test(text) && pinAwaitingConfirm.has(entityId)) {
    pinAwaitingConfirm.delete(entityId);
    if (isPinBlocked(entityId)) {
      if (cb) await cb({ text: "🔒 Too many failed PIN attempts. Wait 10 minutes.", source: msg.content.source });
      clearProcessing(entityId);
      return { success: false, text: "PIN blocked" };
    }
    const ok = await verifyPin(entityId, text);
    if (!ok) {
      const fb = recordPinFailure(entityId);
      if (fb.blocked && process.env.ADMIN_TELEGRAM_ID && process.env.TELEGRAM_BOT_TOKEN) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.ADMIN_TELEGRAM_ID,
            text: `🚨 PIN lockout: user ${entityId}`,
            parse_mode: "HTML",
          }),
        }).catch((e) => log.error("telegram.admin_pin_alert_failed", { entityId }, e instanceof Error ? e : new Error(String(e))));
      }
      pinAwaitingConfirm.add(entityId);
      if (cb) await cb({ text: "❌ Wrong PIN. Try again.", source: msg.content.source });
      return { success: false, text: "Wrong PIN" };
    }
    clearPinFailures(entityId);
    if (behavioralPinAwaiting.has(entityId)) {
      behavioralPinAwaiting.delete(entityId);
      behavioralStepUpSatisfied.add(entityId);
      pinVerifiedForTransfer.add(entityId);
      if (cb) {
        await cb({
          text: `Login from unusual time/amount pattern detected. If this wasn't you, type /freeze.`,
          source: msg.content.source,
        });
      }
      const fakeMsg = { ...msg, content: { ...msg.content, text: "YES" } };
      return confirmSendflowAction.handler(rt, fakeMsg, state, opts, cb);
    }
    pinVerifiedForTransfer.add(entityId);
    const fakeMsg = { ...msg, content: { ...msg.content, text: "YES" } };
    return confirmSendflowAction.handler(rt, fakeMsg, state, opts, cb);
  }

  const trimmedConf = text.trim();
  if (/^CONFIRM$/i.test(trimmedConf) && p?.intent) {
    const recvC = String((p.intent as { receiverWallet?: string }).receiverWallet ?? "");
    if (recvC) {
      if (isFirstTimeSendTo(entityId, recvC)) {
        newRecipientConfirmed.add(`${entityId}:${recvC}`);
      }
      const fakeMsgC = { ...msg, content: { ...msg.content, text: "YES" } };
      return confirmSendflowAction.handler(rt, fakeMsgC, state, opts, cb);
    }
  }

  const ynEarly = parseYnLocal(text);
  if (ynEarly === "yes" && p?.intent) {
    const recvW = String((p.intent as { receiverWallet?: string }).receiverWallet ?? "");
    if (
      recvW &&
      isFirstTimeSendTo(entityId, recvW) &&
      !newRecipientConfirmed.has(`${entityId}:${recvW}`)
    ) {
      if (cb) {
        await cb({
          text: "⚠️ <b>New address</b> — First time sending to this wallet. Verify the address, then type <b>CONFIRM</b> to proceed.",
          source: msg.content.source,
        });
      }
      return { success: false, text: "awaiting_new_address_confirm" };
    }
    const amt = Number((p.intent as { amount?: number }).amount ?? 0);
    if (amt > TRANSFER_LIMITS.LARGE_TRANSFER_THRESHOLD) {
      if (!(await hasPin(entityId))) {
        if (cb) {
          await cb({
            text: "🔐 Set a security PIN first: <code>/setpin 123456</code>",
            source: msg.content.source,
          });
        }
        return { success: false, text: "PIN setup required" };
      }
      if (!pinVerifiedForTransfer.has(entityId)) {
        pinAwaitingConfirm.add(entityId);
        if (cb) {
          await cb({
            text: "🔐 Enter your 6-digit PIN to confirm this transfer:",
            source: msg.content.source,
          });
        }
        return { success: false, text: "Awaiting PIN" };
      }
    }
  }

  const result = await _origConfirmHandler.call(confirmSendflowAction, rt, msg, state, opts, cb);
  const cfm = result ?? { success: false as const, text: "Confirm failed" };
  logger.info(`CHAIN: CONFIRM result success=${cfm.success}`);
  if (!cfm.success) {
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    return cfm;
  }
  const sfConfirm = (cfm.values?.sendflow ?? {}) as Record<string, unknown>;
  if (!(sfConfirm.flow as any)?.confirmed) {
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    return cfm;
  }

  let chainSf = {
    ...(((state as any)?.values?.sendflow ?? {}) as Record<string, unknown>),
    ...sfConfirm,
  };
  let chainState = {
    ...(state ?? {}),
    values: { ...((state as any)?.values ?? {}), sendflow: chainSf },
  };

  if (cb && chainSf.intent) {
    const intPrev = chainSf.intent as RemittanceIntent;
    const line = await formatConversionLine(entityId, Number(intPrev.amount)).catch(() => "");
    if (line) {
      await cb({
        text: `💱 <b>Transfer preview</b>\nSending: <b>${intPrev.amount} USDC</b> ${line}`,
        source: msg.content.source,
      });
    }
  }

  try {
    const intentForBudget = chainSf.intent as Record<string, unknown> | undefined;
    const transferAmount = Number(intentForBudget?.amount ?? 0);
    if (transferAmount > 0) {
      const userMem = await loadMemory(entityId);
      const recvF = String((intentForBudget as { receiverWallet?: string })?.receiverWallet ?? "");
      const fraudSig = analyzeTransaction(entityId, transferAmount, recvF, {
        isNewUser: userMem.totalTransfers === 0,
        maxTransferUsd: TRANSFER_LIMITS.MAX_USDC,
      });
      if (fraudSig) {
        logSecurity("fraud_signal", entityId, fraudSig.severity, { pattern: fraudSig.pattern });
        if (fraudSig.pattern === "known_scam_wallet") {
          recordTransferResult("blocked");
          pinVerifiedForTransfer.delete(entityId);
          clearProcessing(entityId);
          if (cb) {
            await cb({
              text: "⛔ <b>Blocked.</b> This address is on a security blocklist.",
              source: msg.content.source,
            });
          }
          return { success: false, text: "scam" };
        }
      }
      const budgetCheck = checkBudget(userMem, transferAmount);
      if (!budgetCheck.allowed) {
        pinVerifiedForTransfer.delete(entityId);
        clearProcessing(entityId);
        const warn = `⚠️ <b>Budget Alert</b>\n\nThis transfer would exceed your monthly budget of <b>${userMem.monthlyBudget} USDC</b>.\nSpent so far: <b>${userMem.monthlySpent.toFixed(2)} USDC</b> | Remaining: <b>${budgetCheck.remaining.toFixed(2)} USDC</b>\n\nReply <b>OVERRIDE</b> to proceed anyway or <b>NO</b> to cancel.`;
        if (cb) await cb({ text: warn, source: msg.content.source });
        return { success: false, text: warn };
      }
    }

    const trl = checkRateLimit(entityId, "transfers");
    if (!trl.allowed) {
      pinVerifiedForTransfer.delete(entityId);
      clearProcessing(entityId);
      if (cb) {
        await cb({
          text: `⏱ <b>Transfer limit</b> — max 10 transfers/hour. Retry in <b>${trl.retryAfter ?? 60}s</b>.`,
          source: msg.content.source,
        });
      }
      return { success: false, text: "transfer rate limit" };
    }

    if (await isFrozen(entityId)) {
      pinVerifiedForTransfer.delete(entityId);
      clearProcessing(entityId);
      if (cb) {
        await cb({
          text: `Your account is frozen. No transfers can be made. Type /unfreeze to resume.`,
          source: msg.content.source,
        });
      }
      return { success: false, text: "frozen" };
    }

    if (!behavioralStepUpSatisfied.has(entityId)) {
      const intentForBeh = chainSf.intent as Record<string, unknown> | undefined;
      const transferAmountBeh = Number(intentForBeh?.amount ?? 0);
      const recvBeh = String((intentForBeh as { receiverWallet?: string })?.receiverWallet ?? "");
      const profile = await loadProfile(entityId);
      const messageIntervalMs =
        profile.lastMessageIntervalMs ?? profile.avgMessageIntervalMs ?? 60_000;
      const evt = {
        amountUsdc: transferAmountBeh,
        recipientAddress: recvBeh,
        utcHour: new Date().getUTCHours(),
        messageIntervalMs,
      };
      const anomaly = await scoreAnomaly(entityId, evt);
      if (anomaly.score > 30) {
        void alert("warn", "behavior.anomaly_score", {
          entityId,
          score: anomaly.score,
          triggers: anomaly.triggers,
        });
      }
      if (anomaly.triggers.includes("new_recipient") && transferAmountBeh > TRANSFER_LIMITS.MULTISIG_THRESHOLD) {
        void alert("warn", "transfer.new_recipient_over_50_usdc", {
          entityId,
          amountUsdc: transferAmountBeh,
        });
      }
      const metaB = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
      const chIdB = metaB?.telegram?.chat?.id != null ? String(metaB.telegram.chat.id) : "";
      const ctxBeh: TelegramContext = {
        chatId: chIdB,
        sendHtml: async (h) => {
          if (chIdB) await sendTgHtml(chIdB, h);
        },
        sendKeyboard: async (h, k) => {
          if (chIdB) await sendTgWithKeyboard(chIdB, h, k);
        },
      };
      const step = await stepUpIfNeededWithKeyboard(entityId, anomaly, ctxBeh, behavioralConfirmKeyboard);
      if (step.proceed === false && step.kind === "pin") {
        pinVerifiedForTransfer.delete(entityId);
        behavioralPinAwaiting.add(entityId);
        pinAwaitingConfirm.add(entityId);
        if (cb) {
          await cb({
            text: `🔐 Enter your 6-digit PIN to confirm this unusual transfer.\n\nLogin from unusual time/amount pattern detected. If this wasn't you, type /freeze.`,
            source: msg.content.source,
          });
        }
        return { success: false, text: "behavioral_pin" };
      }
      if (step.proceed === false && step.kind === "inline") {
        behavioralResumeByPendingId.set(step.pendingId, {
          rt,
          msg,
          chainState: chainState as State,
          opts,
          cb,
          entityId,
          roomId,
        });
        setBehavioralWizardPending(entityId, step.pendingId, step.expiresAt);
        return { success: false, text: "behavioral_inline" };
      }
    } else {
      behavioralStepUpSatisfied.delete(entityId);
    }

    return await continueTransferAfterRateLimit(rt, msg, chainState as State, opts, cb, entityId, roomId);
  } catch (e) {
    recordTransferResult("failed");
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    const emsg = e instanceof Error ? e.message : String(e);
    logger.warn(`Transaction chain failed: ${emsg}`);
    if (cb) {
      await cb({ text: `❌ Transaction failed: ${emsg}`, source: msg.content.source });
    }
    return { success: false, text: `❌ Transaction failed: ${emsg}` };
  }
};

const _origHistoryHandler = transactionHistoryAction.handler;
transactionHistoryAction.handler = async (
  rt: IAgentRuntime,
  msg: Memory,
  state: State | undefined,
  opts: Parameters<NonNullable<typeof _origHistoryHandler>>[3],
  cb?: HandlerCallback
) => {
  const result = await _origHistoryHandler.call(transactionHistoryAction, rt, msg, state, opts, cb);
  const r = result ?? { success: false as const, text: "History failed" };
  const repeatIntent = (r.values?.sendflow as Record<string, unknown>)?.repeatIntent;
  if (!repeatIntent) return r;
  logger.info("CHAIN: repeat intent detected, chaining to CHECK_REMITTANCE_RATE");
  const chainState = {
    ...(state ?? {}),
    values: {
      ...((state as any)?.values ?? {}),
      sendflow: { intent: repeatIntent },
    },
  };
  try {
    const rateResult = await checkRemittanceRateAction.handler(rt, msg, chainState as any, opts, cb);
    return rateResult ?? { success: false as const, text: "Rate check failed" };
  } catch (e) {
    logger.warn(`Chain repeat→rate failed: ${e}`);
    return r;
  }
};

logger.info("Action chains: PARSE→RATE, CONFIRM→LOCK→ROUTE→NOTIFY, HISTORY→RATE(repeat)");

await ensureWalletDataDir();
const connection = await getHealthyConnection();
void getMarketPulse(connection).catch(() => {});
await loadMetricsState();
await initSavingsPlatformAggregates();
const selfTest = await runStartupSelfTest(connection);
setDegradedMode(!selfTest.ok);
const escrow = loadEscrowPk();

if (escrow) {
  logger.info(`SendFlow escrow (loaded): ${escrow.publicKey.toBase58()}`);
} else {
  logger.warn("SendFlow: SOLANA_ESCROW_WALLET_PRIVATE_KEY not loaded (set for signing tests).");
}

logger.info(`Solana RPC: ${getCurrentRpcUrl() || connection.rpcEndpoint}`);

const ollamaResolved = await resolveOllamaModelAndSyncEnv();
const llmHealthy = await checkLlmHealth();
if (ollamaResolved) {
  logger.info(`Ollama base: ${ollamaResolved.ollamaBase}, model: ${ollamaResolved.model}`);
} else {
  logger.warn("NOSANA_LLM_ENDPOINT not set; Nosana/Ollama models will return empty defaults until configured.");
}
if (process.env.NOSANA_LLM_ENDPOINT?.trim() && !llmHealthy) {
  log.warn("startup", { llm: "degraded — LLM unavailable, using heuristic fallbacks" });
}

const adapter = new InMemoryDatabaseAdapter();
await adapter.init();

const runtime = new AgentRuntime({
  character: sendflowCharacter,
  adapter,
  plugins: (sendflowCharacter as any).plugins ?? [],
  logLevel: "info",
  settings: envAsRuntimeSettings(),
});

if (ollamaResolved) {
  registerNosanaModels(runtime, ollamaResolved.ollamaBase, ollamaResolved.model);
} else {
  registerNosanaModels(runtime, "", "qwen3.5:9b");
}

await runtime.initialize({ allowNoDatabase: true });

const isAgentE2e = isE2eMode();
const telegramService = isAgentE2e
  ? null
  : await TelegramService.start(runtime);
if (!isAgentE2e) {
  applyTelegramHandlerTimeout(
    telegramService as { bot?: { options?: { handlerTimeout?: number }; handlerTimeout?: number } },
    TELEGRAM_HANDLER_TIMEOUT_MS
  );
} else {
  logger.info("SENDFLOW_E2E: Telegram bot not started (capture mode).");
}

const botToken = runtime.getSetting("TELEGRAM_BOT_TOKEN") as string | undefined;
const botUsername = runtime.getSetting("TELEGRAM_BOT_USERNAME") as string | undefined ?? "SendFlowSol_bot";

const sendTgHtml = async (chatId: string, text: string): Promise<number | null> => {
  if (isE2eMode()) {
    pushE2eReply(text);
    return 1;
  }
  if (!botToken) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { result?: { message_id?: number } };
      return data.result?.message_id ?? null;
    }
    const errBody = await res.text().catch(() => "");
    log.error("telegram.sendMessage_failed", { chatId, status: res.status, errBody });
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `❌ <b>Something went wrong</b>\nCould not deliver message (${res.status}).\n💡 Try again or type <b>help</b>`,
        parse_mode: "HTML",
      }),
    }).catch((e) => log.error("telegram.sendMessage_fallback_failed", { chatId }, e as Error));
  } catch (err) {
    log.error("telegram.sendMessage_exception", { chatId }, err instanceof Error ? err : new Error(String(err)));
  }
  return null;
};

const sendTgWithKeyboard = async (chatId: string, text: string, keyboard: InlineKeyboard): Promise<number | null> => {
  if (isE2eMode()) {
    pushE2eReply(text);
    return 1;
  }
  if (!botToken) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }),
    });
    if (res.ok) {
      const data = (await res.json()) as { result?: { message_id?: number } };
      return data.result?.message_id ?? null;
    }
    log.error("telegram.sendMessage_keyboard_failed", { chatId, status: res.status });
  } catch (err) {
    log.error("telegram.sendMessage_keyboard_exception", { chatId }, err instanceof Error ? err : new Error(String(err)));
  }
  return null;
};

const sendTgPhoto = async (chatId: string, photoBuffer: Buffer, caption: string): Promise<void> => {
  if (!botToken) return;
  try {
    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("photo", new Blob([photoBuffer], { type: "image/png" }), "receipt.png");
    formData.append("caption", caption);
    formData.append("parse_mode", "HTML");
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: formData });
    if (!res.ok) {
      log.error("telegram.sendPhoto_failed", { chatId, status: res.status });
      await sendTgHtml(
        chatId,
        `❌ <b>Could not send image</b>\n${(await res.text().catch(() => "")).slice(0, 200)}\n💡 Try again or type <b>help</b>`
      );
    }
  } catch (err) {
    log.error("telegram.sendPhoto_exception", { chatId }, err instanceof Error ? err : new Error(String(err)));
    await sendTgHtml(
      chatId,
      `❌ <b>Something went wrong</b>\n${err instanceof Error ? err.message : String(err)}\n💡 Try again or type <b>help</b>`
    );
  }
};

const getCustodialUsdcBalance = async (userId: string): Promise<number> => {
  const w = await getCustodialWallet(userId);
  if (!w) return 0;
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const ata = await getAssociatedTokenAddress(mint, new PublicKey(w.publicKey));
  try {
    const tb = await connection.getTokenAccountBalance(ata);
    return Number(tb.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
};

const answerCbQuery = async (callbackQueryId: string, text?: string): Promise<void> => {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text ?? "" }),
    });
  } catch (err) {
    log.error("telegram.answerCallback_failed", { callbackQueryId }, err instanceof Error ? err : new Error(String(err)));
  }
};

const deleteTgMessage = async (chatId: string, messageId: number): Promise<void> => {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    });
  } catch (err) {
    log.error("telegram.deleteMessage_failed", { chatId, messageId }, err instanceof Error ? err : new Error(String(err)));
  }
};

const editMessageReplyMarkup = async (chatId: string, messageId: number): Promise<void> => {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  } catch (err) {
    log.error("telegram.editMessageReplyMarkup_failed", { chatId, messageId }, err instanceof Error ? err : new Error(String(err)));
  }
};

const sendTypingAction = async (chatId: string): Promise<void> => {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch { /* best effort */ }
};

const editTgPlain = async (chatId: string, messageId: number, text: string): Promise<void> => {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
    });
  } catch (err) {
    log.error("telegram.editMessageText_failed", { chatId, messageId }, err instanceof Error ? err : new Error(String(err)));
  }
};

/** Plain text, no parse_mode — key material must not go through HTML parsing. */
const sendTgPlainProtected = async (chatId: string, text: string): Promise<number | null> => {
  if (!botToken) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, protect_content: true }),
    });
    if (res.ok) {
      const data = (await res.json()) as { result?: { message_id?: number } };
      return data.result?.message_id ?? null;
    }
    log.error("telegram.sendMessage_protected_failed", { chatId, status: res.status });
  } catch (err) {
    log.error("telegram.sendMessage_protected_exception", { chatId }, err instanceof Error ? err : new Error(String(err)));
  }
  return null;
};

async function scheduleWalletExportAfterPin(userId: string, chatId: string): Promise<void> {
  let seconds = 60;
  const countdownMsgId = await sendTgPlainProtected(chatId, `Your key will be sent in ${seconds}s. Type CANCEL to abort.`);
  let intervalId: ReturnType<typeof setInterval> | undefined;
  const cancel = (): void => {
    if (intervalId !== undefined) clearInterval(intervalId);
    exportCountdownCancel.delete(userId);
    if (countdownMsgId !== null) void deleteTgMessage(chatId, countdownMsgId).catch(() => {});
  };
  exportCountdownCancel.set(userId, cancel);
  intervalId = setInterval(() => {
    seconds--;
    void (async () => {
      if (seconds > 0) {
        if (countdownMsgId !== null) {
          await editTgPlain(chatId, countdownMsgId, `Your key will be sent in ${seconds}s. Type CANCEL to abort.`);
        }
      } else {
        if (intervalId !== undefined) clearInterval(intervalId);
        exportCountdownCancel.delete(userId);
        if (countdownMsgId !== null) void deleteTgMessage(chatId, countdownMsgId).catch(() => {});
        try {
          const pk = await exportPrivateKeyBase58OneShot(userId);
          const msgId = await sendTgPlainProtected(chatId, `Your private key (keep secret):\n${pk}`);
          log.info("wallet.export", { userId, timestamp: new Date().toISOString(), telegramMessageId: msgId });
        } catch (e) {
          log.error("wallet.export_failed", { userId }, e instanceof Error ? e : new Error(String(e)));
          await sendTgHtml(chatId, `Export failed.`);
        }
      }
    })();
  }, 1000);
}

const _origParseHandlerOuter = parseRemittanceIntentAction.handler;
const wrappedParseHandler = parseRemittanceIntentAction.handler;
parseRemittanceIntentAction.handler = async (rt, msg, state, opts, cb) => {
  const meta = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
  const chatId = meta?.telegram?.chat?.id;
  const entityId = msg.entityId as string;
  const userText = (msg.content.text ?? "").trim();
  const lower = userText.toLowerCase();
  try {
  if (chatId) await sendTypingAction(String(chatId));
  void recordUserMessage(entityId).catch(() => {});

  if (isPermanentlyBlocked(entityId)) {
    if (chatId) await sendTgHtml(String(chatId), "⛔ <b>Access denied.</b>");
    return { success: false, text: "blocked" };
  }
  const rl = checkRateLimit(entityId, "messages");
  if (!rl.allowed) {
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        `⏱ <b>Too many messages.</b> Try again in <b>${rl.retryAfter ?? 60}</b>s.`
      );
    }
    return { success: false, text: "rate limit" };
  }

  if (/^\/freeze\b/i.test(userText)) {
    await freezeAccount(entityId);
    await notifyAdminFreeze(entityId, "freeze");
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        `Your account is frozen. No transfers can be made. Type /unfreeze to resume.`
      );
    }
    return { success: true, text: "freeze" };
  }
  if (/^\/unfreeze\b/i.test(userText)) {
    await unfreezeAccount(entityId);
    await notifyAdminFreeze(entityId, "unfreeze");
    if (chatId) await sendTgHtml(String(chatId), `Account unfrozen. You can send transfers again.`);
    return { success: true, text: "unfreeze" };
  }

  if (/\b(emergency\s+stop|freeze\s+everything)\b/i.test(lower)) {
    await emergencyFreeze(entityId);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `🔒 <b>Account Frozen</b>`,
          `All transfers stopped immediately.`,
          `Recurring sends and pending confirmations were cleared.`,
          ``,
          `To unfreeze: <code>/unfreeze</code> (you may be asked for your PIN).`,
          `Or contact support.`,
        ].join("\n")
      );
    }
    return { success: true, text: "emergency_stop" };
  }

  if (/\bgenerate\s+recovery\s+codes\b/i.test(lower)) {
    const codes = generateRecoveryCodes(entityId);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [`🔐 <b>Recovery codes</b> — store offline; each works once:`, ...codes.map((c) => `<code>${c}</code>`)].join("\n")
      );
    }
    return { success: true, text: "recovery_codes" };
  }

  if (/\buse\s+recovery\s+code\s+([a-f0-9]+)\b/i.test(lower)) {
    const m = lower.match(/\buse\s+recovery\s+code\s+([a-f0-9]+)\b/i);
    const code = m?.[1] ?? "";
    const ok = useRecoveryCode(entityId, code);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        ok
          ? `✅ Recovery code accepted. Keep the rest safe. Contact support to finish moving your account if needed.`
          : `❌ Invalid or already used code.`
      );
    }
    return { success: ok, text: ok ? "recovery_ok" : "recovery_bad" };
  }

  if (/\bi\s+lost\s+access\b|\baccount\s+recovery\b/i.test(lower)) {
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        `If you still have Telegram access, use <code>/unfreeze</code> or generate <b>recovery codes</b>. If you lost this account, contact support with proof of identity — automated migration is not available yet.`
      );
    }
    return { success: true, text: "recovery_info" };
  }

  if (/\bmonthly\s+report\b|\bmoney\s+report\b/i.test(lower)) {
    const html = formatMonthlySpendingReport(entityId);
    if (chatId) await sendTgHtml(String(chatId), html ?? `No outbound transfers recorded this month yet.`);
    return { success: true, text: "monthly_report" };
  }

  const showCurrM = lower.match(/\bshow\s+amounts?\s+in\s+([a-z]{3})\b/i);
  if (showCurrM?.[1]) {
    const pref = await setDisplayCurrency(entityId, showCurrM[1]);
    if (chatId) {
      await sendTgHtml(String(chatId), `Display currency set to <b>${pref.displayCurrency}</b> (${pref.displaySymbol}).`);
    }
    return { success: true, text: "currency_set" };
  }

  const convM = lower.match(/\bhow\s+much\s+is\s+(\d+(?:\.\d+)?)\s+usdc\s+in\s+([a-z]{3})\b/i);
  if (convM?.[1] && convM[2] && chatId) {
    const amt = Number(convM[1]);
    const cur = convM[2].toUpperCase();
    const r = await getExchangeRate(cur);
    const local = amt * r;
    await sendTgHtml(String(chatId), `💱 <b>${amt} USDC</b> ≈ <b>${local.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}</b> (indicative rate).`);
    return { success: true, text: "currency_conv" };
  }

  if (/^\/demo\b/i.test(userText)) {
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        `Try SendFlow: type <code>Send $1 to demo.sol</code> — no signup, no seed phrase, just type.`
      );
    }
    return { success: true, text: "demo invite" };
  }

  if (chatId) {
    const cid = String(chatId);
    if (exportCountdownCancel.has(entityId) && /^(cancel|abort)$/i.test(userText.trim())) {
      const c = exportCountdownCancel.get(entityId);
      exportCountdownCancel.delete(entityId);
      c?.();
      await sendTgHtml(cid, `Export cancelled.`);
      return { success: true, text: "export_cancelled" };
    }
    if (/^\d{6}$/.test(userText) && exportPinAwaiting.has(entityId)) {
      exportPinAwaiting.delete(entityId);
      if (isPinBlocked(entityId)) {
        await sendTgHtml(cid, `🔒 Too many failed PIN attempts. Wait 10 minutes.`);
        return { success: false, text: "PIN blocked" };
      }
      const ok = await verifyPin(entityId, userText);
      if (!ok) {
        const fb = recordPinFailure(entityId);
        if (fb.blocked && process.env.ADMIN_TELEGRAM_ID && process.env.TELEGRAM_BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: process.env.ADMIN_TELEGRAM_ID,
              text: `🚨 PIN lockout: user ${entityId}`,
              parse_mode: "HTML",
            }),
          }).catch((e) => log.error("telegram.admin_pin_alert_failed", { entityId }, e instanceof Error ? e : new Error(String(e))));
        }
        exportPinAwaiting.add(entityId);
        await sendTgHtml(cid, `❌ Wrong PIN. Try again.`);
        return { success: false, text: "Wrong PIN" };
      }
      clearPinFailures(entityId);
      await scheduleWalletExportAfterPin(entityId, cid);
      return { success: true, text: "export_countdown" };
    }
  }

  const trimmedForClaim = userText.trim();
  const phoneClaimStartMatch = /^\/start\s+claim_([a-f0-9]{8})\s*$/i.exec(trimmedForClaim);
  if (phoneClaimStartMatch && chatId && !isE2eMode()) {
    return handlePhoneClaimDeepLinkStart({
      userId: entityId,
      chatId: String(chatId),
      claimCode: phoneClaimStartMatch[1]!,
      connection,
      sendHtml: sendTgHtml,
      sendKeyboard: sendTgWithKeyboard,
    });
  }

  const isPhoneClaim8Param = /^\/start\s+claim_[a-f0-9]{8}\s*$/i.test(trimmedForClaim);
  const claimSoon = /^\/start\s+claim_/i.test(trimmedForClaim) && !isPhoneClaim8Param;
  if (
    chatId &&
    !isE2eMode() &&
    isNewUser(entityId) &&
    !hasCompletedWelcomeOnboarding(entityId) &&
    !claimSoon
  ) {
    markSeen(entityId);
    registerNewUser(entityId);
    assignUserNumber(entityId);
    await loadMemory(entityId);
    const ob = await runWelcomeOnboarding({
      userId: entityId,
      chatId: String(chatId),
      originalText: userText,
      metadata: msg.metadata,
      sendHtml: sendTgHtml,
      sendKeyboard: sendTgWithKeyboard,
      connection,
      reprocess: () => parseRemittanceIntentAction.handler(rt, msg, state, opts, cb),
    });
    return ob ?? { success: true, text: "welcome_onboarding" };
  }

  const memForThreat = await loadMemory(entityId);
  const roomIdForThreat =
    typeof msg.roomId === "string" ? msg.roomId : String((msg as { roomId?: string }).roomId ?? "default");
  const pendingForThreat = getPending(roomIdForThreat, entityId);
  const pendingAmt = pendingForThreat?.intent?.amount;
  const threat = await classifyMessage(entityId, userText, {
    recentTransferCount: memForThreat.totalTransfers,
    accountAgeDays: getAccountAgeDays(entityId),
    pendingAmount: typeof pendingAmt === "number" ? pendingAmt : undefined,
  });
  if (threat.label === "block") {
    logSecurity("threat_block", entityId, "critical", {
      categories: threat.categories,
      explanation: threat.explanation,
    });
    recordTransferResult("blocked");
    const primaryCategory = threat.categories[0] ?? "unknown";
    auditLog({
      level: "warn",
      action: "THREAT_BLOCKED",
      result: "blocked",
      category: primaryCategory,
      userId: entityId,
      riskScore: threat.confidence,
    });
    void alert("critical", "threat.blocked", {
      entityId,
      categories: threat.categories,
      explanation: threat.explanation,
    });
    if (isE2eMode()) setE2eThreat("block", true);
    if (chatId) {
      await sendTgHtml(String(chatId), "This request couldn't be processed.");
    }
    return { success: false, text: "threat_block" };
  }
  if (threat.label === "suspicious") {
    msg.metadata = { ...msg.metadata, flagged: true } as typeof msg.metadata;
    void alert("warn", "threat.suspicious", {
      entityId,
      categories: threat.categories,
      explanation: threat.explanation,
    });
  }

  if (isE2eMode()) {
    setE2eThreat(threat.label, false);
  }

  recordRequest(entityId, "messages");

  recordDailyActive(entityId);
  const tgLang = (msg.metadata as { telegram?: { from?: { language_code?: string } } } | undefined)?.telegram?.from
    ?.language_code;
  rememberUserLocale(entityId, tgLang);
  recordActivity(entityId);
  touchLastActive(entityId);
  incrementFeatureUsage("message");

  const claimStart = userText.match(/^\/start\s+claim_(r_[a-f0-9]+)\s*$/i);
  if (claimStart && chatId) {
    const rec = getReceiptById(claimStart[1]!);
    if (rec && !rec.claimed) {
      if (isNewUser(entityId)) {
        markSeen(entityId);
        registerNewUser(entityId);
        assignUserNumber(entityId);
        startOnboarding(entityId);
        await loadMemory(entityId);
      }
      const w = await createCustodialWallet(entityId);
      claimReceipt(rec.receiptId, w.publicKey, entityId);
      markWelcomeOnboardingComplete(entityId);
      await sendTgHtml(
        String(chatId),
        [
          `✅ <b>You're set up on SendFlow</b>`,
          `Your wallet: <code>${w.publicKey}</code>`,
          ``,
          `<b>${rec.senderName}</b> invited you to receive <b>${rec.amount} USDC</b>.`,
          `When they send to this address, it will show up here. You can <b>cash out</b> to your bank anytime.`,
        ].join("\n")
      );
      await sendTgHtml(
        String(rec.senderUserId),
        `📬 Your invite was claimed. Recipient wallet: <code>${w.publicKey}</code>\nSend <b>${rec.amount} USDC</b> to this address in SendFlow to complete the gift.`
      ).catch(() => {});
      return { success: true, text: "claim" };
    }
    if (chatId) await sendTgHtml(String(chatId), `⚠️ This invite link is invalid or already used.`);
    return { success: false, text: "claim invalid" };
  }

  const lastMsgAt = getLastSeen(entityId);
  const hoursSince = (Date.now() - lastMsgAt) / 3600000;

  if (isShortcut(userText)) {
    if (chatId) {
      const handled = await handleShortcut(userText, {
        userId: entityId,
        chatId: String(chatId),
        sendHtml: async (h) => {
          await sendTgHtml(String(chatId), h);
        },
        sendKeyboard: async (h, k) => {
          await sendTgWithKeyboard(String(chatId), h, k);
        },
      });
      if (handled) return { success: true, text: "shortcut" };
    }
  }

  if (!isNewUser(entityId) && hoursSince > 8 && chatId) {
    const fr = (msg.metadata as { telegram?: { from?: { username?: string; first_name?: string } } } | undefined)?.telegram?.from;
    const display = fr?.username ? `@${fr.username}` : fr?.first_name ?? "there";
    const st = getStreak(entityId);
    const bal = await getCustodialUsdcBalance(entityId);
    await sendTgHtml(
      String(chatId),
      `${getTimeBasedGreeting()}, <b>${display}</b>!\nBalance: <b>${bal.toFixed(2)} USDC</b> | Streak: <b>${st.currentStreak} days</b> 🔥`
    );
  }

  const ctx0 = getContext(entityId);
  if (/\bsend\s+same\b/i.test(lower) && ctx0.lastAmount && ctx0.lastRecipient) {
    const fakeSame = { ...msg, content: { ...msg.content, text: `Send ${ctx0.lastAmount} USDC to ${ctx0.lastRecipient}` } };
    return wrappedParseHandler(rt, fakeSame, state, opts, cb);
  }
  const andSend = userText.match(/^\s*and\s+(\d+(?:\.\d+)?)\s+to\s+(.+)$/i);
  if (andSend?.[1] && andSend[2]) {
    const fakeAnd = { ...msg, content: { ...msg.content, text: `Send ${andSend[1]} USDC to ${andSend[2].trim()}` } };
    return wrappedParseHandler(rt, fakeAnd, state, opts, cb);
  }

  if (
    /\b(how do i add money|buy usdc|add money|fund my wallet|get usdc)\b/i.test(lower) ||
    /\badd\s+\$?\d+/i.test(lower)
  ) {
    const w = await getCustodialWallet(entityId);
    const loc = getUserLocale(entityId);
    if (w && chatId) {
      await sendTgWithKeyboard(
        String(chatId),
        formatOnRampReply(w.publicKey, loc.country),
        getOnRampKeyboard(w.publicKey)
      );
    }
    return { success: true, text: "onramp" };
  }

  if (/\b(cash out|withdraw to bank|off[\s-]?ramp|sell usdc|convert usdc to inr|send to my bank)\b/i.test(lower)) {
    const vel = await recordOffRampVelocityAttempt(entityId);
    if (!vel.allowed) {
      if (chatId) {
        await sendTgHtml(
          String(chatId),
          `⛔ <b>Off-ramp paused</b> — velocity_limit (too many cash-out attempts in a short window). Try again later or contact support.`
        );
      }
      return { success: false, text: "velocity_limit" };
    }
    const loc = getUserLocale(entityId);
    if (chatId) await sendTgWithKeyboard(String(chatId), formatOffRampReply(loc.country), getOffRampKeyboard(loc.country));
    return { success: true, text: "offramp" };
  }

  const saveGoalM = userText.match(/save\s+for\s+(.+?)\s*[—\-]\s*goal\s+(\d+(?:\.\d+)?)\s*usdc/i);
  if (saveGoalM?.[1] && saveGoalM[2] && chatId) {
    const g = createGoal(entityId, saveGoalM[1]!.trim(), Number(saveGoalM[2]));
    await sendTgHtml(
      String(chatId),
      [`<b>Savings goal created</b>`, `Goal: ${g.name}`, `Target: <b>${g.targetAmount} USDC</b>`, getProgress(g)].join("\n")
    );
    return { success: true, text: "goal" };
  }

  if (
    chatId &&
    ((/\bmy savings\b/i.test(lower) && !/\bgoals\b/i.test(lower)) || /\bhow much have i saved\b/i.test(lower))
  ) {
    const { totalSavedUsd, transferCount } = getLifetimeSavings(entityId);
    const lang = getUserLanguage(entityId);
    await sendTgHtml(String(chatId), formatLifetimeSavingsReply(totalSavedUsd, transferCount, lang));
    return { success: true, text: "lifetime_savings" };
  }

  if (/\bmy savings goals\b/i.test(lower) && chatId) {
    const gs = getGoals(entityId);
    await sendTgHtml(
      String(chatId),
      gs.length
        ? [`<b>Your goals</b>`, ...gs.map((g) => `• ${g.name}: ${getProgress(g)}`)].join("\n")
        : `No savings goals yet. Try: <code>Save for Mom's medical — goal 500 USDC</code>`
    );
    return { success: true, text: "goals" };
  }

  const addGoalM = userText.match(/\badd\s+(\d+(?:\.\d+)?)\s+usdc\s+to\s+my\s+savings goal\b/i);
  if (addGoalM?.[1] && chatId) {
    const gs = getGoals(entityId);
    const last = gs[gs.length - 1];
    if (last) {
      depositToGoal(last.goalId, Number(addGoalM[1]));
      await sendTgHtml(String(chatId), `✅ Added. ${getProgress(last)}`);
    } else if (chatId) await sendTgHtml(String(chatId), `Create a goal first.`);
    return { success: true, text: "goal deposit" };
  }

  const autoPM = userText.match(/\bauto-?save\s+(\d+(?:\.\d+)?)%\s+of\s+every\s+payment\b/i);
  if (autoPM?.[1] && chatId) {
    setAutoSavePercent(entityId, Number(autoPM[1]));
    await sendTgHtml(
      String(chatId),
      `✅ Auto-save <b>${autoPM[1]}%</b> of incoming payments applied to your latest goal.`
    );
    return { success: true, text: "autosaver" };
  }

  const phoneSend = userText.match(/send\s+(\d+(?:\.\d+)?)\s*(?:usdc|usd|\$)?\s*to\s+(\+\d[\d\s-]{8,18})/i);
  if (phoneSend?.[1] && phoneSend[2] && chatId) {
    const amt = Number(phoneSend[1]);
    const phone = phoneSend[2].replace(/[\s-]/g, "");
    const fr = (msg.metadata as { telegram?: { from?: { username?: string; first_name?: string } } } | undefined)?.telegram?.from;
    const name = fr?.first_name ?? fr?.username ?? "Friend";
    const r = createPendingReceipt(entityId, amt, phone, name, userText);
    await sendTgHtml(
      String(chatId),
      [
        `📱 <b>Invite queued</b>`,
        `Receipt <code>${r.receiptId}</code> — we texted <code>${phone}</code> when <code>TWILIO_*</code> is configured.`,
        `They open Telegram, claim, and get a wallet. You can then send USDC to their address in chat.`,
      ].join("\n")
    );
    return { success: true, text: "phone invite" };
  }

  const msgFraud = analyzeMessage(entityId, userText);
  if (msgFraud) logSecurity("message_flag", entityId, msgFraud.severity, { pattern: msgFraud.pattern });

  if (isCryptoQuestion(userText)) {
    try {
      const ans = await answerCryptoQuestion(userText, entityId, rt);
      if (chatId) await sendTgWithKeyboard(String(chatId), ans, cryptoReplyKeyboard);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      log.error("crypto.assistant_failed", { entityId }, e instanceof Error ? e : new Error(em));
      if (chatId) {
        await sendTgHtml(
          String(chatId),
          `❌ <b>Something went wrong</b>\n${em}\n💡 Try again or type <b>help</b>`
        );
      }
    }
    return { success: true, text: "crypto assistant" };
  }

  if (/0x[a-fA-F0-9]{40}/.test(userText) && !/sendflow/i.test(userText)) {
    if (chatId) await sendTgHtml(String(chatId), getCrossChainAdvice("solana", "ethereum"));
    return { success: true, text: "cross-chain" };
  }

  const setpinM = userText.match(/^\/setpin\s+(\d{6})$/i);
  if (setpinM) {
    try {
      await setupPin(entityId, setpinM[1]);
      if (chatId) await sendTgHtml(String(chatId), `✅ <b>PIN saved.</b> You'll need it for transfers over 10 USDC.`);
    } catch (e) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ ${e instanceof Error ? e.message : "Invalid PIN"}`);
    }
    return { success: true, text: "pin set" };
  }

  const approveM = userText.match(/^APPROVE\s+(ms_[a-f0-9]+)$/i);
  if (approveM) {
    const reqId = approveM[1];
    const ok = approveTransfer(reqId, entityId);
    const ex = getPendingExecution(reqId);
    if (ok && ex) {
      ex.approvedAt = new Date().toISOString();
      const res = await executeAfterApproval(
        reqId,
        runtime,
        connection,
        escrow,
        undefined,
        async (p) => {
          if (chatId) await sendTgHtml(String(chatId), p.text ?? "");
          return [];
        }
      );
      if (res.ok && res.payoutTxHash) {
        if (chatId) {
          await sendTgHtml(
            String(chatId),
            `✅ <b>Approved &amp; executed.</b>\n🔗 <a href="https://solscan.io/tx/${res.payoutTxHash}">Solscan</a>`
          );
        }
        if (ex.initiatorChatId) {
          await sendTgHtml(
            ex.initiatorChatId,
            `✅ <b>Transfer complete</b>\n🔗 <a href="https://solscan.io/tx/${res.payoutTxHash}">Solscan</a>${degradedTransferSuffix()}`
          );
        }
        clearProcessing(ex.userId);
        pinVerifiedForTransfer.delete(ex.userId);
      } else if (!res.ok) {
        if (chatId) await sendTgHtml(String(chatId), `❌ ${res.error ?? "Execution failed"}`);
        if (ex.initiatorChatId) {
          await sendTgHtml(
            ex.initiatorChatId,
            `❌ <b>Transfer failed after approval.</b>\n${res.error ?? ""}`
          );
        }
        removePendingExecution(reqId);
        removeApprovalRequest(reqId);
        clearProcessing(ex.userId);
        pinVerifiedForTransfer.delete(ex.userId);
      }
    } else if (chatId) {
      await sendTgHtml(String(chatId), ok ? `⚠️ Could not execute approval.` : `⚠️ Could not approve this request.`);
    }
    return { success: true, text: "approve" };
  }

  const rejectM = userText.match(/^REJECT\s+(ms_[a-f0-9]+)$/i);
  if (rejectM) {
    const reqId = rejectM[1];
    const ok = rejectTransfer(reqId, entityId);
    const ex = getPendingExecution(reqId);
    if (ok && ex?.initiatorChatId) {
      await sendTgHtml(ex.initiatorChatId, `❌ Your transfer was rejected by your approver.`);
    }
    if (ok && ex) {
      removePendingExecution(reqId);
      removeApprovalRequest(reqId);
      clearProcessing(ex.userId);
      pinVerifiedForTransfer.delete(ex.userId);
    }
    if (chatId) await sendTgHtml(String(chatId), ok ? `❌ Transfer rejected.` : `⚠️ Could not reject this request.`);
    return { success: true, text: "reject" };
  }

  const adminIdEnv = process.env.ADMIN_TELEGRAM_ID;
  if (adminIdEnv && String(chatId) === adminIdEnv && /^\//.test(userText)) {
    const low = userText.toLowerCase();
    if (low.startsWith("/admin status") || low === "/admin") {
      await sendTgHtml(String(chatId), formatAdminStatusMessage());
      return { success: true, text: "admin status" };
    }
    if (low.startsWith("/admin stats")) {
      await sendTgHtml(
        String(chatId),
        `📊 <b>Admin</b>\nTransfers (session): ${metrics.totalTransfers}\nUptime: ${Math.floor((Date.now() - metrics.startedAt) / 1000)}s`
      );
      return { success: true, text: "admin" };
    }
    if (low.startsWith("/admin metrics")) {
      const g = buildSendFlowMetrics(getAllSeenUserIds().length);
      const onb = getOnboardingStats();
      await sendTgHtml(
        String(chatId),
        [
          `<b>SendFlow metrics</b>`,
          `DAU: <b>${g.dau}</b> · WAU: <b>${g.wau}</b> · MAU: <b>${g.mau}</b>`,
          `Stickiness (D/M): <b>${g.dauMauRatio}</b>`,
          `Onboarding: <b>${onb.completed}/${onb.started}</b> · dropoff: <b>${onb.dropoffStep}</b>`,
          `Volume all-time: <b>${g.totalVolumeAllTime}</b> USDC · today: <b>${g.totalVolumeToday}</b>`,
          `Top features: ${g.topFeatures.slice(0, 5).join(", ") || "—"}`,
        ].join("\n")
      );
      return { success: true, text: "admin metrics" };
    }
    if (low.startsWith("/admin cohort")) {
      await sendTgHtml(String(chatId), getCohortReport());
      return { success: true, text: "admin cohort" };
    }
    if (low.startsWith("/admin queue")) {
      const q = getTxQueueStatus(entityId);
      await sendTgHtml(String(chatId), `Queue: ${q.length} item(s)`);
      return { success: true, text: "admin" };
    }
    if (low.startsWith("/admin block ")) {
      const id = userText.split(/\s+/)[2];
      if (id) {
        const { blockUserPermanent } = await import("./utils/rateLimiter");
        await blockUserPermanent(id);
        await sendTgHtml(String(chatId), `Blocked ${id}`);
      }
      return { success: true, text: "admin" };
    }
    if (low.startsWith("/admin unblock ")) {
      const id = userText.split(/\s+/)[2];
      if (id) {
        const { unblockUser } = await import("./utils/rateLimiter");
        await unblockUser(id);
        await sendTgHtml(String(chatId), `Unblocked ${id}`);
      }
      return { success: true, text: "admin" };
    }
    if (low.startsWith("/admin errors")) {
      const { metrics: m } = await import("./api/health");
      await sendTgHtml(String(chatId), `<code>${JSON.stringify(m.errors)}</code>`);
      return { success: true, text: "admin" };
    }
    if (low.startsWith("/admin attack")) {
      try {
        const { runAdminAttackDemo } = await import("./utils/adminAttackDemo");
        await runAdminAttackDemo(String(chatId), sendTgHtml);
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await sendTgHtml(String(chatId), `⚠️ Attack demo failed: ${em}`);
      }
      return { success: true, text: "admin attack" };
    }
    if (low.startsWith("/admin demo")) {
      try {
        await runDemo(String(chatId), null, connection, escrow, runtime, {
          sendHtml: sendTgHtml,
          sendPhoto: sendTgPhoto,
          demoReceiptEnabled: true,
        });
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        await sendTgHtml(String(chatId), `⚠️ Demo failed: ${em}`);
      }
      return { success: true, text: "admin demo" };
    }
  }

  if (/\bjoin\s+leaderboard\b/i.test(lower)) {
    const un = (msg.metadata as { telegram?: { from?: { username?: string } } })?.telegram?.from?.username ?? entityId;
    await joinLeaderboard(entityId, un);
    if (chatId) await sendTgHtml(String(chatId), `✅ You're on the leaderboard as <b>${un}</b>!`);
    return { success: true, text: "leaderboard" };
  }
  if (/\b(?:show\s+)?leaderboard\b/i.test(lower)) {
    const top = await getTopSenders(10);
    const vol = await totalNetworkVolume();
    const lines = top.map((e, i) => `${e.badge} ${i + 1}. ${e.displayName} — ${e.totalSent.toFixed(0)} USDC (${e.transferCount} tx)`);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [`🏆 <b>SendFlow Leaderboard</b>`, ``, ...lines, ``, `📊 Network volume: <b>${vol.toFixed(0)} USDC</b>`].join("\n")
      );
    }
    return { success: true, text: "leaderboard" };
  }
  if (/\bwhat(?:'s| is)\s+my\s+rank\b/i.test(lower)) {
    const r = await getUserRank(entityId);
    if (chatId) await sendTgHtml(String(chatId), r < 0 ? `Join with <code>join leaderboard</code>` : `Your rank: <b>#${r}</b>`);
    return { success: true, text: "rank" };
  }
  if (/\bstop\s+spending\s+insights\b/i.test(lower)) {
    setInsightsDisabled(entityId, true);
    if (chatId) await sendTgHtml(String(chatId), `✅ Insights disabled.`);
    return { success: true, text: "insights off" };
  }
  if (/\b(?:give me a )?virtual card\b/i.test(lower)) {
    const card = await issueVirtualCard(entityId);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `💳 <b>Your SendFlow Card</b> (${cardProviderMode() === "stub" ? "demo" : "live"})`,
          `Number: <code>${card.cardNumber}</code>`,
          `Expiry: ${String(card.expiryMonth).padStart(2, "0")}/${card.expiryYear}`,
          `Limit: <b>${card.spendingLimit} USDC</b>/day`,
          `Status: ${card.active ? "✅ Active" : "🔒 Frozen"}`,
        ].join("\n")
      );
    }
    return { success: true, text: "card" };
  }
  if (/\bfreeze\s+my\s+card\b/i.test(lower)) {
    await freezeCard(entityId);
    if (chatId) await sendTgHtml(String(chatId), `🔒 Card frozen.`);
    return { success: true, text: "freeze" };
  }
  if (/\bswap\s+\d+(?:\.\d+)?\s*usdc\s+to\s+sol\b/i.test(lower)) {
    const amt = Number(lower.match(/(\d+(?:\.\d+)?)\s*usdc/i)?.[1] ?? 0);
    const q = await getSwapQuote(USDC_MAINNET, SOL_MINT, amt, 6, 50);
    if (q && chatId) {
      pendingSwapAmount.set(entityId, amt);
      await sendTgWithKeyboard(
        String(chatId),
        [
          `🔄 <b>Swap Preview</b>`,
          `Sending: <b>${amt} USDC</b>`,
          `Est. output (lamports raw): <b>${q.outAmountRaw}</b>`,
          `Price impact: <b>${q.priceImpact.toFixed(2)}%</b>`,
          `Route: ${q.route}`,
        ].join("\n"),
        swapKeyboard
      );
    }
    return { success: true, text: "swap quote" };
  }

  if (/\bset\s+my\s+approver\s+(?:telegram\s+)?(\d+)\b/i.test(lower)) {
    const m = userText.match(/(\d{6,})/);
    if (m) {
      setApproverTelegramId(entityId, m[1]);
      if (chatId) await sendTgHtml(String(chatId), `✅ Approver Telegram ID set. Large transfers will notify them.`);
    }
    return { success: true, text: "approver" };
  }

  if (/^\/?(help|\?)$/i.test(lower) || (/^\/start$/i.test(lower))) {
    if (chatId) await sendTgWithKeyboard(String(chatId), HELP_MESSAGE, helpKeyboard);
    return { success: true, text: "Help displayed" };
  }

  if (/\bmy\s+referral\s+link\b/i.test(lower)) {
    const link = generateReferralLink(entityId, botUsername ?? "SendFlowSol_bot");
    const tree = getReferralTree(entityId);
    const e = getReferralEarnings(entityId);
    const msg2 = [
      `<b>Your Referral Network</b>`,
      ``,
      `Direct referrals: <b>${tree.level1Referrals.length}</b> people`,
      `Network (L2): <b>${tree.level2Referrals.length}</b> people`,
      ``,
      `Earnings:`,
      `Direct: <b>${e.level1.toFixed(2)} USDC</b>`,
      `Network: <b>${e.level2.toFixed(2)} USDC</b>`,
      `Milestones: <b>${e.milestones.toFixed(2)} USDC</b>`,
      `Total: <b>${e.total.toFixed(2)} USDC</b>`,
      ``,
      `📎 ${link}`,
    ].join("\n");
    if (chatId) await sendTgHtml(String(chatId), msg2);
    return { success: true, text: msg2 };
  }

  if (/\breferral\s+stats?\b/i.test(lower)) {
    const tree = getReferralTree(entityId);
    const e = getReferralEarnings(entityId);
    const n = tree.level1Referrals.length;
    const nextM = n < 5 ? 5 : n < 10 ? 10 : 25;
    const msg2 = [
      `<b>Your Referral Network</b>`,
      ``,
      `Direct: <b>${n}</b> · Network L2: <b>${tree.level2Referrals.length}</b>`,
      `Total earned: <b>${e.total.toFixed(2)} USDC</b> (L1 ${e.level1.toFixed(2)} + L2 ${e.level2.toFixed(2)} + milestones ${e.milestones.toFixed(2)})`,
      ``,
      `Next milestone: <b>${nextM}</b> referrals`,
      `Progress: <b>${n}/${nextM}</b>`,
    ].join("\n");
    if (chatId) await sendTgWithKeyboard(String(chatId), msg2, leaderboardKeyboard);
    return { success: true, text: msg2 };
  }

  if (/\bwhat(?:'s| is)\s+happening\b/i.test(lower) || /\bactivity\s+feed\b/i.test(lower)) {
    const ev = getRecentFeed(8);
    if (chatId) await sendTgWithKeyboard(String(chatId), formatFeedMessage(ev), feedFooterKeyboard);
    return { success: true, text: "feed" };
  }

  if (/\bswitch\s+to\s+(hindi|spanish|tagalog|swahili|english)\b/i.test(lower)) {
    const lang = detectLanguage(lower);
    setUserLanguage(entityId, lang);
    await saveMemory(entityId, { preferredLanguage: lang });
    const names: Record<string, string> = { en: "English", hi: "Hindi", es: "Spanish", tl: "Tagalog", sw: "Swahili" };
    const msg2 = `✅ Language switched to <b>${names[lang]}</b>`;
    if (chatId) await sendTgHtml(String(chatId), msg2);
    return { success: true, text: msg2 };
  }

  if (/\balways\s+send\s+(?:transactions?\s+)?fast\b/i.test(lower)) {
    await saveMemory(entityId, { defaultSpeedMode: "fast" });
    if (chatId) await sendTgHtml(String(chatId), `✅ Default speed set to <b>Fast</b> 🚀`);
    return { success: true, text: "Speed preference saved" };
  }
  if (/\balways\s+send\s+(?:transactions?\s+)?(?:turbo)\b/i.test(lower)) {
    await saveMemory(entityId, { defaultSpeedMode: "turbo" });
    if (chatId) await sendTgHtml(String(chatId), `✅ Default speed set to <b>Turbo</b> ⚡⚡`);
    return { success: true, text: "Speed preference saved" };
  }
  if (/\balways\s+send\s+(?:transactions?\s+)?(?:cheap|slow)\b/i.test(lower)) {
    await saveMemory(entityId, { defaultSpeedMode: "slow" });
    if (chatId) await sendTgHtml(String(chatId), `✅ Default speed set to <b>Slow</b> (no priority fee) 🐢`);
    return { success: true, text: "Speed preference saved" };
  }

  const budgetMatch = lower.match(/\bset\s+(?:my\s+)?monthly\s+budget\s+(?:to\s+)?(\d+(?:\.\d+)?)\s*(?:usdc)?/i);
  if (budgetMatch) {
    const budget = Number(budgetMatch[1]);
    await saveMemory(entityId, { monthlyBudget: budget });
    if (chatId) await sendTgHtml(String(chatId), `✅ Monthly budget set to <b>${budget} USDC</b>`);
    return { success: true, text: "Budget preference saved" };
  }

  if (/\bnotify\s+me\s+when\s+i\s+receive\b/i.test(lower)) {
    await saveMemory(entityId, { notifyOnReceive: true });
    if (chatId) await sendTgHtml(String(chatId), `✅ You'll be notified when you receive USDC 🔔`);
    return { success: true, text: "Notification preference saved" };
  }

  if (/\b(?:my\s+qr|qr\s+code|share\s+(?:my\s+)?wallet\s+qr)\b/i.test(lower)) {
    const wallet = await getCustodialWallet(entityId);
    if (wallet && chatId) {
      const { shortWallet: sw } = await import("@sendflow/plugin-intent-parser");
      const qr = await generateWalletQR(wallet.publicKey);
      await sendTgPhoto(String(chatId), qr, `📱 Scan to send me USDC\nWallet: <code>${sw(wallet.publicKey)}</code>`);
    } else if (chatId) {
      await sendTgHtml(String(chatId), `⚠️ No wallet found. Send any message to get started.`);
    }
    return { success: true, text: "QR sent" };
  }

  if (/^send$/i.test(lower.trim())) {
    startWizard(entityId);
    if (chatId) await sendTgWithKeyboard(String(chatId), `💸 <b>Step 1/3:</b> How much USDC to send?`, amountKeyboard());
    return { success: true, text: "Wizard started" };
  }

  if (/\b(?:confirm\s+export|export\s+(?:my\s+)?(?:private\s+)?key|backup\s+wallet)\b/i.test(lower)) {
    const wallet = await getCustodialWallet(entityId);
    if (!wallet || !chatId) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ No custodial wallet found.`);
      return { success: false, text: "No wallet" };
    }
    if (!(await hasPin(entityId))) {
      await sendTgHtml(
        String(chatId),
        `🔐 <b>Set a PIN first</b> to export your private key.\n\nUse <code>/setpin 123456</code> (6 digits), then try again.`
      );
      return { success: false, text: "PIN required for export" };
    }
    exportPinAwaiting.add(entityId);
    await sendTgHtml(
      String(chatId),
      `⚠️ <b>Export private key</b>\n\nAnyone with this key controls your funds.\n\n🔐 Enter your <b>6-digit PIN</b> to start a 60-second countdown before the key is sent.`
    );
    return { success: true, text: "Export PIN requested" };
  }

  if (/\b(?:create\s+(?:my\s+)?pay\s*link|my\s+pay\s*link)\b/i.test(lower)) {
    const amtMatch = lower.match(/(\d+(?:\.\d+)?)\s*usdc/);
    const tgMeta = msg.metadata as { telegram?: { from?: { username?: string } } } | undefined;
    const username = tgMeta?.telegram?.from?.username ?? entityId;
    const link = createPayLink(entityId, username, botUsername, amtMatch ? Number(amtMatch[1]) : undefined);
    if (chatId) await sendTgHtml(String(chatId), `🔗 <b>Your Pay Link</b>\n\n📎 ${link}\n\nShare this link — anyone who opens it can pay you instantly!`);
    return { success: true, text: "Pay link created" };
  }

  if (/\b(?:save|deposit)\s+(\d+(?:\.\d+)?)\s*usdc\b/i.test(lower)) {
    const amt = Number(lower.match(/(\d+(?:\.\d+)?)\s*usdc/i)?.[1] ?? 0);
    if (amt > 0) {
      const wallet = await getCustodialWallet(entityId);
      const position = await depositToVault(entityId, wallet?.publicKey ?? "", amt);
      const earnings = calculateEarnings(position);
      if (chatId) await sendTgHtml(String(chatId), [
        `🏦 <b>Savings Vault</b>`,
        ``,
        `Deposited: <b>${position.depositedAmount} USDC</b>`,
        `Protocol: <b>${position.protocol}</b> (best rate)`,
        `APY: <b>${position.estimatedAPY.toFixed(1)}%</b>`,
        `Earning: ~<b>${earnings.daily.toFixed(4)} USDC/day</b>`,
        `Est. monthly: ~<b>${earnings.monthly.toFixed(2)} USDC</b>`,
        ``,
        `Reply <b>WITHDRAW</b> to withdraw anytime.`,
      ].join("\n"));
      return { success: true, text: "Deposited to vault" };
    }
  }

  if (/\b(?:withdraw|withdraw\s+(?:my\s+)?savings)\b/i.test(lower)) {
    const position = await withdrawFromVault(entityId);
    if (position && chatId) {
      await sendTgHtml(String(chatId), `✅ <b>Withdrawn ${position.depositedAmount} USDC</b> from ${position.protocol} vault.`);
    } else if (chatId) {
      await sendTgHtml(String(chatId), `⚠️ No savings vault position found.`);
    }
    return { success: true, text: "Withdrawn" };
  }

  if (/\b(?:how\s+much\s+am\s+i\s+earning|vault\s+balance|my\s+savings)\b/i.test(lower)) {
    const position = getVaultPosition(entityId);
    if (position && chatId) {
      const earnings = calculateEarnings(position);
      await sendTgHtml(String(chatId), `🏦 <b>Vault Balance:</b> ${position.depositedAmount} USDC\n📈 APY: ${position.estimatedAPY.toFixed(1)}%\n💰 Earning: ~${earnings.daily.toFixed(4)} USDC/day`);
    } else if (chatId) {
      await sendTgHtml(String(chatId), `💡 No savings yet. Type <code>Save 50 USDC</code> to start earning yield!`);
    }
    return { success: true, text: "Vault info shown" };
  }

  const alertParsed = parsePriceAlertCommand(userText);
  if (alertParsed) {
    const result = addPriceAlert({ userId: entityId, token: alertParsed.token, condition: alertParsed.condition, threshold: alertParsed.threshold, basePrice: alertParsed.threshold });
    if (result.success && chatId) {
      await sendTgHtml(String(chatId), `✅ <b>Price alert set!</b>\n\n${alertParsed.token} ${alertParsed.condition} $${alertParsed.threshold}\n\nI'll notify you when it triggers. 🔔`);
    } else if (chatId) {
      await sendTgHtml(String(chatId), `⚠️ ${result.error ?? "Could not set alert."}`);
    }
    return { success: true, text: "Alert set" };
  }

  if (/\bmy\s+alerts?\b/i.test(lower)) {
    const alerts = listAlerts(entityId);
    if (alerts.length === 0 && chatId) {
      await sendTgHtml(String(chatId), `📭 No active price alerts.\n\n💡 Try: <code>Alert me when SOL hits $200</code>`);
    } else if (chatId) {
      const lines = alerts.map((a, i) => `${i + 1}. ${a.token} ${a.condition} $${a.threshold}`);
      await sendTgHtml(String(chatId), `🔔 <b>Your Price Alerts</b>\n\n${lines.join("\n")}`);
    }
    return { success: true, text: "Alerts listed" };
  }

  if (/\b(?:market|crypto\s+news|market\s+(?:update|pulse)|what's\s+happening|is\s+sol\s+up)\b/i.test(lower)) {
    if (chatId) {
      const pulse = await getMarketPulse(connection);
      await sendTgHtml(String(chatId), pulse);
    }
    return { success: true, text: "Market pulse shown" };
  }

  if (/\b(?:enable|activate)\s+business\s*(?:mode)?\b/i.test(lower)) {
    const tgMeta2 = msg.metadata as { telegram?: { from?: { username?: string } } } | undefined;
    const bname = tgMeta2?.telegram?.from?.username ?? "SendFlow User";
    enableBusiness(entityId, bname);
    if (chatId) await sendTgHtml(String(chatId), `🏢 <b>Business Mode Activated!</b>\n\nUnlocked:\n• CSV export: <code>export CSV</code>\n• Bulk payments\n• Webhook notifications\n• Team wallets`);
    return { success: true, text: "Business mode enabled" };
  }

  if (/\bexport\s+csv\b/i.test(lower) && isBusinessMode(entityId)) {
    const csv = exportTransactionsCSV(entityId);
    if (chatId && botToken) {
      const blob = new Blob([csv], { type: "text/csv" });
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append("document", blob, "sendflow_transactions.csv");
      form.append("caption", "📊 Your SendFlow transaction export");
      form.append("parse_mode", "HTML");
      try {
        const dr = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: "POST", body: form });
        if (!dr.ok) {
          log.error("telegram.sendDocument_failed", { chatId, status: dr.status });
          await sendTgHtml(String(chatId), `❌ <b>Could not send CSV</b>\n💡 Try again or type <b>help</b>`);
        }
      } catch (err) {
        log.error("telegram.sendDocument_exception", { chatId }, err instanceof Error ? err : new Error(String(err)));
        await sendTgHtml(String(chatId), `❌ <b>Something went wrong</b>\n💡 Try again or type <b>help</b>`);
      }
    }
    return { success: true, text: "CSV exported" };
  }

  if (/\bset\s+webhook\s+(https?:\/\/\S+)/i.test(lower)) {
    const url = lower.match(/\bset\s+webhook\s+(https?:\/\/\S+)/i)?.[1];
    if (url) {
      try {
        setWebhook(entityId, url);
        if (chatId) await sendTgHtml(String(chatId), `✅ Webhook set to <code>${url}</code>`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (chatId) await sendTgHtml(String(chatId), `❌ ${msg}`);
      }
    }
    return { success: true, text: "Webhook set" };
  }

  if (/\b(?:send\s+me\s+daily\s+(?:updates?|digest)|enable\s+digest)\b/i.test(lower)) {
    if (chatId) {
      enableDigest(entityId, String(chatId));
      await sendTgHtml(String(chatId), `✅ <b>Daily digest enabled!</b> You'll get a morning summary at 8:00 UTC.`);
    }
    return { success: true, text: "Digest enabled" };
  }

  if (/\b(?:stop\s+daily\s+digest|disable\s+digest)\b/i.test(lower)) {
    disableDigest(entityId);
    if (chatId) await sendTgHtml(String(chatId), `✅ Daily digest disabled.`);
    return { success: true, text: "Digest disabled" };
  }

  const claimUserM = userText.match(/\bclaim\s+(?:username\s+)?(?:sendflow\/)?([a-z0-9_]{3,20})\b/i);
  if (claimUserM) {
    const un = claimUserM[1].toLowerCase();
    const w = await getCustodialWallet(entityId);
    if (!w) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Create a wallet first (send any message).`);
      return { success: false, text: "no wallet" };
    }
    const res = claimUsername(entityId, un, w.publicKey);
    if (chatId) {
      if (res.success) await sendTgHtml(String(chatId), `✅ You're <b>sendflow/${un}</b>!`);
      else await sendTgHtml(String(chatId), `⚠️ ${res.error ?? "Could not claim username."}`);
    }
    return { success: res.success, text: "claim username" };
  }

  if (/\b(?:my\s+profile|show\s+profile)\b/i.test(lower)) {
    const p = getProfile(entityId);
    if (!p) {
      if (chatId) await sendTgHtml(String(chatId), `No profile yet. Say <code>claim username yourname</code>.`);
      return { success: true, text: "no profile" };
    }
    if (chatId) {
      const since = new Date(p.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      await sendTgWithKeyboard(
        String(chatId),
        [
          `${p.profileEmoji} <b>sendflow/${p.username}</b>`,
          `💳 <code>${shortWallet(p.walletAddress)}</code>`,
          `📊 Received: ${p.totalReceived.toFixed(0)} USDC`,
          `📅 Since: ${since}`,
          p.bio ? `💬 "${p.bio}"` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        profileKeyboard(p.username)
      );
    }
    return { success: true, text: "profile" };
  }

  const setBioM = userText.match(/\bset\s+my\s+bio\s+to\s+(.+)/i);
  if (setBioM) {
    updateProfile(entityId, { bio: setBioM[1].trim() });
    if (chatId) await sendTgHtml(String(chatId), `✅ Bio updated.`);
    return { success: true, text: "bio" };
  }

  const setEmojiM = userText.match(/\bset\s+my\s+emoji\s+to\s+(\S+)/i);
  if (setEmojiM) {
    updateProfile(entityId, { profileEmoji: setEmojiM[1].trim() });
    if (chatId) await sendTgHtml(String(chatId), `✅ Profile emoji updated.`);
    return { success: true, text: "emoji" };
  }

  if (/\b(?:i\s+)?need\s+a\s+loan\b/i.test(lower)) {
    const score = calculateCreditScore(entityId);
    const maxA = getMaxLoanAmount(score);
    const stars = "⭐".repeat(Math.min(5, Math.max(1, Math.ceil(score / 20))));
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `🏦 <b>SendFlow Micro-Loan</b>`,
          `Credit Score: <b>${score}/100</b> ${stars}`,
          `Max eligible: <b>${maxA} USDC</b>`,
          `Fee: 2% flat`,
          `Term: 30 days`,
          ``,
          `Say <code>apply for 10 USDC loan</code> to request.`,
        ].join("\n")
      );
    }
    return { success: true, text: "loan intro" };
  }

  const applyLoanM = userText.match(/\bapply\s+for\s+(\d+(?:\.\d+)?)\s*usdc\s+loan\b/i);
  if (applyLoanM) {
    const amt = Number(applyLoanM[1]);
    const loan = applyForLoan(entityId, amt);
    const repayAmt = loan.approvedAmount * (1 + loan.interestRate);
    if (loan.approvedAmount <= 0) {
      if (chatId) {
        await sendTgHtml(
          String(chatId),
          `⚠️ Loan not approved. Score <b>${loan.creditScore}/100</b> — build more transfer history first.`
        );
      }
      return { success: false, text: "loan denied" };
    }
    if (chatId) {
      pendingLoanApp.set(entityId, loan);
      await sendTgWithKeyboard(
        String(chatId),
        [
          `🏦 <b>SendFlow Micro-Loan</b>`,
          `Credit Score: <b>${loan.creditScore}/100</b>`,
          `Max eligible: <b>${getMaxLoanAmount(loan.creditScore)} USDC</b>`,
          `Fee: ${(loan.interestRate * 100).toFixed(0)}% flat`,
          `Term: 30 days`,
          ``,
          `You receive: <b>${loan.approvedAmount} USDC</b>`,
          `You repay: <b>${repayAmt.toFixed(2)} USDC</b>`,
        ].join("\n"),
        loanKeyboard
      );
    }
    return { success: true, text: "loan apply" };
  }

  if (/\brepay\s+my\s+loan\b/i.test(lower)) {
    const loan = getActiveLoan(entityId);
    if (!loan) {
      if (chatId) await sendTgHtml(String(chatId), `No active loan to repay.`);
      return { success: true, text: "no loan" };
    }
    if (!escrow) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Escrow not configured.`);
      return { success: false, text: "no escrow" };
    }
    try {
      const sig = await repayLoan(loan.loanId, entityId, escrow, connection);
      if (chatId) await sendTgHtml(String(chatId), `✅ Loan repaid. Tx: <code>${sig.slice(0, 8)}…</code>`);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Repay failed: ${em}`);
    }
    return { success: true, text: "repay" };
  }

  if (/\bmy\s+loan\s+status\b/i.test(lower)) {
    const loan = getActiveLoan(entityId);
    if (!loan) {
      if (chatId) await sendTgHtml(String(chatId), `No active loan.`);
      return { success: true, text: "no loan" };
    }
    const owe = loan.approvedAmount * (1 + loan.interestRate);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `🏦 <b>Loan</b> <code>${loan.loanId}</code>`,
          `Status: <b>${loan.status}</b>`,
          `Principal: <b>${loan.approvedAmount} USDC</b>`,
          `Repay: <b>${owe.toFixed(2)} USDC</b>`,
          `Due: <b>${loan.dueDate}</b>`,
        ].join("\n")
      );
    }
    return { success: true, text: "loan status" };
  }

  const rpcUrlStream = getCurrentRpcUrl() || connection.rpcEndpoint;
  const streamM = userText.match(
    /\bstream\s+(\d+(?:\.\d+)?)\s*usdc\s+per\s+hour\s+to\s+(.+?)\s+for\s+(\d+(?:\.\d+)?)\s*hours?\b/i
  );
  if (streamM) {
    const rate = Number(streamM[1]);
    const hours = Number(streamM[3]);
    const rawDest = streamM[2].trim();
    let receiverWallet = extractSolanaAddress(rawDest);
    if (!receiverWallet) {
      const dom = extractSolDomain(rawDest) ?? extractSolDomain(`${rawDest}.sol`);
      if (dom) {
        try {
          receiverWallet = await resolveSolDomain(dom, rpcUrlStream);
        } catch {
          receiverWallet = "";
        }
      }
    }
    if (!receiverWallet) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Could not resolve recipient wallet.`);
      return { success: false, text: "stream bad recv" };
    }
    const budget = rate * hours;
    try {
      const st = startStream(entityId, receiverWallet, rawDest.replace(/\.sol$/i, "") || "stream", rate, budget);
      if (chatId) {
        await sendTgHtml(
          String(chatId),
          [
            `🌊 <b>Active Stream</b>`,
            `To: <b>${st.receiverLabel}</b>`,
            `Rate: <b>${rate} USDC/hour</b>`,
            `Streamed: <b>0.00 USDC</b>`,
            `Remaining budget: <b>${budget.toFixed(2)} USDC</b>`,
          ].join("\n")
        );
      }
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (chatId) await sendTgHtml(String(chatId), `⚠️ ${em}`);
    }
    return { success: true, text: "stream start" };
  }

  if (/\bpause\s+my\s+stream\b/i.test(lower)) {
    const s = pauseStream(entityId);
    if (chatId) {
      await sendTgHtml(String(chatId), s ? `⏸ Stream paused.` : `No active stream.`);
    }
    return { success: true, text: "pause stream" };
  }

  if (/\bresume\s+stream\b/i.test(lower)) {
    const s = resumeStream(entityId);
    if (chatId) {
      await sendTgHtml(String(chatId), s ? `▶️ Stream resumed.` : `No paused stream.`);
    }
    return { success: true, text: "resume stream" };
  }

  if (/\bstop\s+streaming\b/i.test(lower)) {
    const s = getStreamStatus(entityId);
    if (s && escrow) {
      try {
        await settleStream(entityId, escrow, connection);
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        if (chatId) await sendTgHtml(String(chatId), `⚠️ Settle: ${em}`);
      }
    }
    endStream(entityId);
    if (chatId) await sendTgHtml(String(chatId), `⏹ Stream ended.`);
    return { success: true, text: "stream stop" };
  }

  if (/\bstream\s+status\b/i.test(lower)) {
    const s = getStreamStatus(entityId);
    if (!s) {
      if (chatId) await sendTgHtml(String(chatId), `No active stream.`);
      return { success: true, text: "no stream" };
    }
    const streamed = calculateStreamed(s);
    const remaining = Math.max(0, s.totalDeposited - streamed);
    const elapsedMin = Math.floor(
      (Date.now() - s.startedAt - s.totalPausedMs - (s.pausedAt ? Date.now() - s.pausedAt : 0)) / 60_000
    );
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `🌊 <b>${s.status === "active" ? "Active" : s.status === "paused" ? "Paused" : "Ended"} Stream</b>`,
          `To: <b>${s.receiverLabel}</b>`,
          `Rate: <b>${(s.ratePerSecond * 3600).toFixed(2)} USDC/hour</b>`,
          `Streamed: <b>${streamed.toFixed(2)} USDC</b> (~${Math.max(0, elapsedMin)} min)`,
          `Remaining budget: <b>${remaining.toFixed(2)} USDC</b>`,
        ].join("\n")
      );
    }
    return { success: true, text: "stream status" };
  }

  if (/\bcreate\s+treasury\s+(.+)/i.test(lower)) {
    const name = userText.replace(/.*\bcreate\s+treasury\s+/i, "").trim();
    const w = await getCustodialWallet(entityId);
    const wallet = escrow?.publicKey.toBase58() ?? w?.publicKey ?? "";
    if (!name || !wallet) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Need a name and wallet/escrow.`);
      return { success: false, text: "treasury bad" };
    }
    const t = createTreasury(entityId, name, wallet);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        `🏛 Treasury <b>${t.name}</b> created. Wallet: <code>${shortWallet(t.walletAddress)}</code>`
      );
    }
    return { success: true, text: "treasury" };
  }

  const addMemM = userText.match(/\badd\s+(\S+)\s+to\s+(.+)/i);
  if (addMemM && !/\busdc\b/i.test(userText)) {
    const newId = addMemM[1];
    const treasuryName = addMemM[2].trim();
    const tr = findTreasuryByName(treasuryName);
    if (tr) {
      addMember(tr.treasuryId, newId);
      if (chatId) await sendTgHtml(String(chatId), `✅ Added <b>${newId}</b> to <b>${tr.name}</b>.`);
    } else if (chatId) {
      await sendTgHtml(String(chatId), `⚠️ Treasury <b>${treasuryName}</b> not found.`);
    }
    return { success: true, text: "add member" };
  }

  const proposeM = userText.match(/\bpropose\s+paying\s+(\S+)\s+(\d+(?:\.\d+)?)\s*usdc(?:\s+for\s+(.+))?/i);
  if (proposeM) {
    const tid = getUserTreasuryId(entityId);
    if (!tid) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Join or create a treasury first.`);
      return { success: false, text: "no treasury" };
    }
    let recipient = proposeM[1];
    const amount = Number(proposeM[2]);
    const desc = (proposeM[3] ?? "Treasury spend").trim();
    if (!extractSolanaAddress(recipient)) {
      const dom = recipient.endsWith(".sol") ? recipient : `${recipient}.sol`;
      try {
        recipient = await resolveSolDomain(dom, rpcUrlStream);
      } catch {
        if (chatId) await sendTgHtml(String(chatId), `⚠️ Could not resolve ${proposeM[1]}`);
        return { success: false, text: "bad recipient" };
      }
    }
    const p = createProposal(tid, entityId, desc, amount, recipient);
    if (chatId) {
      await sendTgHtml(
        String(chatId),
        [
          `🗳️ <b>Proposal ${p.proposalId}</b>`,
          `💸 ${amount} USDC — ${desc}`,
          `Recipient: <code>${shortWallet(recipient)}</code>`,
          `Status: <b>${p.status}</b>`,
        ].join("\n")
      );
    }
    return { success: true, text: "proposal" };
  }

  const voteM = userText.match(/\bvote\s+(yes|no)\s+on\s+proposal\s+(\d+)/i);
  if (voteM) {
    const tid = getUserTreasuryId(entityId);
    if (!tid) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ No treasury.`);
      return { success: false, text: "no treasury" };
    }
    const propId = `prop_${voteM[2]}`;
    const { passed } = voteOnProposal(tid, propId, entityId, voteM[1].toLowerCase() as "yes" | "no");
    if (chatId) {
      await sendTgHtml(String(chatId), passed ? `✅ Proposal <b>passed</b> threshold.` : `🗳️ Vote recorded.`);
    }
    return { success: true, text: "vote" };
  }

  const execM = userText.match(/\bexecute\s+proposal\s+(\d+)/i);
  if (execM) {
    const tid = getUserTreasuryId(entityId);
    if (!tid || !escrow) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Treasury or escrow not available.`);
      return { success: false, text: "exec bad" };
    }
    const propId = `prop_${execM[1]}`;
    try {
      const sig = await executeProposal(tid, propId, escrow, connection);
      if (chatId) await sendTgHtml(String(chatId), `✅ Executed. Tx: <code>${sig.slice(0, 8)}…</code>`);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (chatId) await sendTgHtml(String(chatId), `⚠️ ${em}`);
    }
    return { success: true, text: "execute" };
  }

  if (/\btreasury\s+status\b/i.test(lower)) {
    const tid = getUserTreasuryId(entityId);
    if (!tid) {
      if (chatId) await sendTgHtml(String(chatId), `No treasury. Say <code>create treasury MyDAO</code>.`);
      return { success: true, text: "no treasury" };
    }
    if (chatId) await sendTgHtml(String(chatId), getTreasuryStatus(tid));
    return { success: true, text: "treasury status" };
  }

  if (/\benable\s+pos\s+(?:mode\s+)?for\s+(.+)/i.test(lower)) {
    const m = userText.match(/\benable\s+pos\s+(?:mode\s+)?for\s+(.+)/i);
    const biz = m?.[1]?.trim() ?? "Merchant";
    const w = await getCustodialWallet(entityId);
    if (!w) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ No wallet.`);
      return { success: false, text: "no wallet" };
    }
    enablePOS(entityId, biz, w.publicKey);
    if (chatId) await sendTgHtml(String(chatId), `☕ <b>POS mode ON</b> — ${biz}`);
    return { success: true, text: "pos on" };
  }

  if (/\bdisable\s+pos\b/i.test(lower)) {
    disablePOS(entityId);
    if (chatId) await sendTgHtml(String(chatId), `POS mode off.`);
    return { success: true, text: "pos off" };
  }

  const chargeM = userText.match(/\bcharge\s+(\d+(?:\.\d+)?)\s*usdc\s+(?:for\s+)?(.+)/i);
  if (chargeM && getPOSSession(entityId)?.active) {
    const amount = Number(chargeM[1]);
    const desc = (chargeM[2] ?? "Sale").trim();
    const inv = createPOSInvoice(entityId, amount, desc);
    const sess = getPOSSession(entityId);
    const blink = generateInvoiceBlink(inv.invoiceId, amount, sess?.merchantWallet ?? "");
    const qr = await generatePOSQR(blink);
    if (chatId) {
      await sendTgPhoto(
        String(chatId),
        qr,
        [
          `☕ <b>${sess?.businessName ?? "POS"}</b>`,
          `Amount: <b>${amount.toFixed(2)} USDC</b>`,
          `Item: ${desc}`,
          `Expires: 10 minutes`,
          ``,
          `📱 Customer scans to pay`,
        ].join("\n")
      );
    }
    return { success: true, text: "pos charge" };
  }

  if (/\btoday'?s\s+sales\b/i.test(lower)) {
    if (chatId) await sendTgHtml(String(chatId), getDailySummary(entityId));
    return { success: true, text: "pos sales" };
  }

  if (/\bcreate\s+(?:a\s+)?blink\s+for\s+(\d+(?:\.\d+)?)\s*usdc\b/i.test(lower)) {
    const bm = userText.match(/\bcreate\s+(?:a\s+)?blink\s+for\s+(\d+(?:\.\d+)?)\s*usdc\b/i);
    const amt = Number(bm?.[1] ?? 0);
    const last = sharedGetLastTransfer(entityId);
    const to = last?.receiverWallet;
    if (!to) {
      if (chatId) {
        await sendTgHtml(String(chatId), `⚠️ No recent transfer — include a recipient in a send first, or say <code>send X USDC to …</code>.`);
      }
      return { success: false, text: "no last tx" };
    }
    const url = generateTransferBlink(amt, to, "USDC");
    if (chatId) await sendTgHtml(String(chatId), formatBlinkMessage(url, `Transfer <b>${amt} USDC</b> to <code>${shortWallet(to)}</code>`));
    return { success: true, text: "blink transfer" };
  }

  if (/\bblink\s+for\s+my\s+invoice\b/i.test(lower)) {
    const inv = getLatestInvoiceForCreator(entityId);
    if (!inv) {
      if (chatId) await sendTgHtml(String(chatId), `No invoice found. Create one first.`);
      return { success: false, text: "no inv" };
    }
    const url = generateInvoiceBlink(inv.invoiceId, inv.amount, inv.creatorWallet);
    if (chatId) await sendTgHtml(String(chatId), formatBlinkMessage(url, `Invoice <b>${inv.amount} USDC</b>`));
    return { success: true, text: "blink inv" };
  }

  if (/\b(?:my\s+profile\s+blink|profile\s+blink)\b/i.test(lower)) {
    const p = getProfile(entityId);
    if (!p) {
      if (chatId) await sendTgHtml(String(chatId), `Claim a username first.`);
      return { success: false, text: "no profile" };
    }
    const url = generateProfileBlink(p.username);
    if (chatId) await sendTgHtml(String(chatId), formatBlinkMessage(url, `Pay <b>sendflow/${p.username}</b>`));
    return { success: true, text: "blink profile" };
  }

  if (/\b(?:my\s+card|show\s+my\s+card)\b/i.test(lower)) {
    const bal = await getCustodialUsdcBalance(entityId);
    const txs = sharedGetAllTransfers(entityId);
    const totalSent = txs.reduce((s, t) => s + (t.amount ?? 0), 0);
    const prof = getProfile(entityId);
    const totalReceived = prof?.totalReceived ?? 0;
    const score = calculateCreditScore(entityId);
    try {
      const png = await generateStatusCard(entityId, bal, totalSent, totalReceived, score, prof?.username);
      if (chatId) await sendTgPhoto(String(chatId), png, `📇 Your SendFlow status card`);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Could not render card: ${em}`);
    }
    return { success: true, text: "status card" };
  }

  const stakeNl = userText.match(/\bstake\s+(\d+(?:\.\d+)?)\s*usdc\s+for\s+(\d+)\s*days?\b/i);
  if (stakeNl) {
    const amt = Number(stakeNl[1]);
    const d = Number(stakeNl[2]);
    if (![7, 30, 90].includes(d)) {
      if (chatId) await sendTgHtml(String(chatId), `Lock must be <b>7</b>, <b>30</b>, or <b>90</b> days.`);
      return { success: false, text: "bad lock" };
    }
    const ld = d as 7 | 30 | 90;
    const rate = REWARD_RATES[ld];
    const apy = (rate * 100).toFixed(0);
    const matDate = new Date(Date.now() + d * 86_400_000);
    const mat = matDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const estAtMaturity = amt * rate * (d / 365.25);
    pendingStakePreview.set(entityId, { amount: amt, lockDays: ld });
    if (chatId) {
      await sendTgWithKeyboard(
        String(chatId),
        [
          `💰 <b>SendFlow Earn</b>`,
          `Stake: <b>${amt} USDC</b>`,
          `Lock: <b>${d} days</b>`,
          `Rate: <b>${apy}% APY</b>`,
          `You earn (~at maturity): <b>${estAtMaturity.toFixed(2)} USDC</b>`,
          `Matures: ${mat}`,
        ].join("\n"),
        confirmKeyboard
      );
    }
    return { success: true, text: "stake preview" };
  }

  if (/\bmy\s+earnings\b/i.test(lower) || /\bearn(?:ing)?s?\s+status\b/i.test(lower)) {
    const s = getStakePosition(entityId);
    if (!s && chatId) {
      await sendTgHtml(String(chatId), `No active stake. Say <code>Stake 50 USDC for 30 days</code>.`);
      return { success: true, text: "no stake" };
    }
    if (s && chatId) {
      const e = calculateEarned(s);
      await sendTgWithKeyboard(
        String(chatId),
        [
          `💰 <b>Your stake</b>`,
          `Amount: <b>${s.stakedAmount} USDC</b>`,
          `Status: <b>${s.status}</b>`,
          `Accrued (~): <b>${e.toFixed(4)} USDC</b>`,
          `Matures: <b>${new Date(s.maturesAt).toLocaleString()}</b>`,
        ].join("\n"),
        getStakeStatusKeyboard()
      );
    }
    return { success: true, text: "earn status" };
  }

  if (/\bwithdraw\s+stake\b/i.test(lower)) {
    const s = getStakePosition(entityId);
    if (!s) {
      if (chatId) await sendTgHtml(String(chatId), `No stake.`);
      return { success: true, text: "none" };
    }
    if (!isMatured(s)) {
      if (chatId) {
        await sendTgHtml(String(chatId), `Stake still locked until <b>${new Date(s.maturesAt).toLocaleString()}</b>.`);
      }
      return { success: false, text: "locked" };
    }
    if (!escrow) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Escrow not configured.`);
      return { success: false, text: "no escrow" };
    }
    try {
      const sig = await withdrawStake(entityId, escrow, connection);
      if (chatId) await sendTgHtml(String(chatId), `✅ Withdrawn. Tx: <code>${sig.slice(0, 10)}…</code>`);
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (chatId) await sendTgHtml(String(chatId), `❌ <b>Something went wrong</b>\n${em}`);
    }
    return { success: true, text: "withdraw stake" };
  }

  if (/\bcreate\s+payment\s+page\s+for\b/i.test(lower)) {
    const w = await getCustodialWallet(entityId);
    if (!w || !chatId) {
      if (chatId) await sendTgHtml(String(chatId), `⚠️ Wallet required.`);
      return { success: false, text: "no wallet" };
    }
    const amtM = userText.match(/(\d+(?:\.\d+)?)\s*usdc/i);
    const raw = userText.replace(/.*\bcreate\s+payment\s+page\s+for\b/i, "").trim();
    const title = raw.replace(/\s*[—-].*$/, "").trim().slice(0, 80) || "Payment";
    const descM = userText.match(/[—-]\s*(.+)$/);
    const desc = (descM?.[1] ?? title).trim().slice(0, 200);
    const page = createPaymentPage(entityId, title, desc, w.publicKey, amtM ? Number(amtM[1]) : undefined);
    const base = process.env.PUBLIC_BASE_URL ?? process.env.WEBAPP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const url = `${base.replace(/\/$/, "")}/pay/${page.pageId}`;
    await sendTgHtml(String(chatId), `Your payment page is live!\nURL: <code>${url}</code>\n\nShare this link anywhere.`);
    return { success: true, text: "pay page" };
  }

  if (/\bmy\s+payment\s+pages\b/i.test(lower)) {
    const list = listPaymentPages(entityId);
    if (chatId) {
      const base = process.env.PUBLIC_BASE_URL ?? process.env.WEBAPP_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
      const lines = list.map((p) => `${p.title}: ${base.replace(/\/$/, "")}/pay/${p.pageId}`);
      await sendTgHtml(String(chatId), lines.length ? [`<b>Your pages</b>`, ...lines].join("\n") : `No active pages.`);
    }
    return { success: true, text: "list pages" };
  }

  if (/\bdisable\s+payment\s+page\b/i.test(lower)) {
    const list = listPaymentPages(entityId);
    const last = list[0];
    if (last) {
      disablePaymentPage(last.pageId, entityId);
      if (chatId) await sendTgHtml(String(chatId), `Disabled <code>${last.pageId}</code>.`);
    } else if (chatId) await sendTgHtml(String(chatId), `No page to disable.`);
    return { success: true, text: "disable page" };
  }

  if (isGroupMessage(msg.metadata) && /\bsplit\b/i.test(lower) && /\busdc\b/i.test(lower)) {
    const amtM = userText.match(/(\d+(?:\.\d+)?)\s*usdc/i);
    const mentions = extractMentionedUsernames(userText);
    if (amtM && mentions.length > 0 && chatId) {
      const desc = userText.replace(/.*?\d+(?:\.\d+)?\s*usdc\s*/i, "").replace(/\bbetween\b/i, "").trim().slice(0, 120);
      const split = createBillSplit(entityId, String(chatId), Number(amtM[1]), desc || "Split", mentions);
      await sendTgWithKeyboard(String(chatId), formatSplitMessage(split), [
        [{ text: "💸 Pay my share", callback_data: `split_pay_${split.splitId}` }],
      ]);
      const from = (msg.metadata as { telegram?: { from?: { username?: string } } })?.telegram?.from?.username ?? "Someone";
      for (const u of mentions) {
        const uid = getUserIdForUsername(u);
        if (uid) {
          await sendTgHtml(
            uid,
            `@${from} started a bill split. You owe <b>${(split.totalAmount / mentions.length).toFixed(2)} USDC</b> for <b>${escapeHtmlLite(desc || "split")}</b>. Open the group to pay.`
          );
        }
      }
      return { success: true, text: "split" };
    }
  }

  const invMatch = userText.match(/^\/start\s+inv_(\S+)/);
  if (invMatch) {
    const invoice = getInvoice(invMatch[1]);
    if (invoice && !invoice.paid) {
      const fakeMsg = { ...msg, content: { ...msg.content, text: `Send ${invoice.amount} USDC to ${invoice.creatorWallet}` } };
      return wrappedParseHandler(rt, fakeMsg, state, opts, cb);
    }
    const errText = invoice?.paid ? "🧾 This invoice has already been paid." : "🧾 Invoice not found or expired.";
    if (chatId) await sendTgHtml(String(chatId), errText);
    return { success: false, text: errText };
  }

  const payMatch = userText.match(/^\/start\s+(pay_\S+)/);
  if (payMatch) {
    const parsed = parsePayLink(payMatch[1]);
    if (parsed && chatId) {
      if (parsed.amount) {
        const fakeMsg2 = { ...msg, content: { ...msg.content, text: `Send ${parsed.amount} USDC to ${parsed.username}` } };
        return wrappedParseHandler(rt, fakeMsg2, state, opts, cb);
      }
      await sendTgWithKeyboard(String(chatId), `💸 Send money to <b>${parsed.username}</b>`, payLinkAmountKeyboard(parsed.username));
      return { success: true, text: "Pay link opened" };
    }
  }

  const voiceMeta = msg.metadata as { telegram?: { voice?: { file_id?: string } } } | undefined;
  const voiceFileId = voiceMeta?.telegram?.voice?.file_id;
  if (voiceFileId && botToken) {
    if (chatId) await sendTgHtml(String(chatId), `🎤 <b>Processing voice message...</b>`);
    const fileBuffer = await downloadTelegramFile(botToken, voiceFileId);
    if (fileBuffer) {
      const transcription = await transcribeVoice(fileBuffer);
      if (transcription) {
        if (chatId) await sendTgHtml(String(chatId), `🎤 Heard: "<i>${transcription}</i>" — processing...`);
        const fakeVoiceMsg = { ...msg, content: { ...msg.content, text: transcription } };
        return wrappedParseHandler(rt, fakeVoiceMsg, state, opts, cb);
      }
    }
    if (chatId) await sendTgHtml(String(chatId), `⚠️ Could not transcribe voice message.\n💡 Set <code>WHISPER_ENDPOINT</code> or type your command instead.`);
    return { success: false, text: "Voice transcription failed" };
  }

  if (isGroupMessage(msg.metadata) && !isBotMentioned(userText, botUsername)) {
    return { success: false, text: "" };
  }
  const groupText = isGroupMessage(msg.metadata) ? stripBotMention(userText, botUsername) : userText;
  if (groupText !== userText) {
    const fakeGroupMsg = { ...msg, content: { ...msg.content, text: groupText } };
    return wrappedParseHandler(rt, fakeGroupMsg, state, opts, cb);
  }

  if (await isFrozen(entityId)) {
    const looksLikeTransfer =
      /^\s*send\s+[\d$]/i.test(userText) ||
      /\bsend\s+\d+(?:\.\d+)?\s*(?:usdc|usd|\$)?\s+to\b/i.test(lower) ||
      /\btransfer\s+\d/i.test(lower);
    if (looksLikeTransfer) {
      if (chatId) {
        await sendTgHtml(
          String(chatId),
          `Your account is frozen. No transfers can be made. Type /unfreeze to resume.`
        );
      }
      return { success: false, text: "frozen" };
    }
  }

  return wrappedParseHandler(rt, msg, state, opts, cb);
  } finally {
    updateLastSeen(entityId);
  }
};

const sendTelegramNotification = async (_userId: string, text: string): Promise<void> => {
  try {
    const adminId = runtime.getSetting("ADMIN_TELEGRAM_ID");
    if (botToken && adminId) {
      await sendTgHtml(String(adminId), text);
    }
  } catch (e) {
    log.error("notify.admin_failed", {}, e instanceof Error ? e : new Error(String(e)));
  }
};

startPriceMonitor(
  async (ct: ConditionalTransfer) => {
    logger.info(`PriceMonitor: executing conditional transfer for ${ct.userId}`);
  },
  sendTelegramNotification
);

setInterval(() => {
  void sweepExpiredPhoneClaims(connection, async (cid, html) => {
    await sendTgHtml(cid, html);
  }).then((n) => {
    if (n > 0) logger.info(`phone_claim.expiry_sweep refunded=${n}`);
  });
}, 30 * 60 * 1000);

startScheduler(
  async (rt: RecurringTransfer) => {
    logger.info(`Scheduler: executing recurring transfer ${rt.scheduleId} for ${rt.userId}`);
    return null;
  },
  sendTelegramNotification
);

setWatchNotifyCallback(sendTelegramNotification);

startPriceAlertMonitor(sendTelegramNotification);

startDigestScheduler(async (chatId: string, text: string) => {
  await sendTgHtml(chatId, text);
});

if (botToken) {
  const pollCallbackQueries = async () => {
    let offset = 0;
    const poll = async () => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=30&allowed_updates=["callback_query"]`, {
          signal: AbortSignal.timeout(35_000),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { result?: Array<{ update_id: number; callback_query?: { id: string; data?: string; from?: { id: number }; message?: { chat?: { id: number } } } }> };
        for (const update of data.result ?? []) {
          offset = update.update_id + 1;
          const cbq = update.callback_query;
          if (!cbq?.data) continue;
          const cbChatId = cbq.message?.chat?.id ? String(cbq.message.chat.id) : null;
          const cbUserId = cbq.from?.id ? String(cbq.from.id) : null;
          if (!cbChatId || !cbUserId) continue;

          await answerCbQuery(cbq.id);

          const cbData = cbq.data;
          if (cbData === "action_send") {
            startWizard(cbUserId);
            await sendTgWithKeyboard(cbChatId, `💸 <b>Step 1/3:</b> How much USDC to send?`, amountKeyboard());
          } else if (cbData === "action_balance") {
            await sendTgHtml(cbChatId, `Checking balance... type <code>balance</code>`);
          } else if (cbData === "action_contacts") {
            await sendTgHtml(cbChatId, `Type <code>my contacts</code> to see your contact book.`);
          } else if (cbData === "action_history") {
            await sendTgHtml(cbChatId, `Type <code>history</code> to see recent transfers.`);
          } else if (cbData === "action_invoice") {
            await sendTgHtml(cbChatId, `Type <code>create invoice for 50 USDC</code>`);
          } else if (cbData === "action_settings") {
            await sendTgWithKeyboard(cbChatId, `⚙️ <b>Settings</b>`, settingsKeyboard);
          } else if (cbData === "action_repeat") {
            await sendTgHtml(cbChatId, `Type <code>repeat last transfer</code>`);
          } else if (cbData === "action_stats") {
            await sendTgHtml(cbChatId, `Type <code>stats</code> to see your analytics.`);
          } else if (cbData === "action_referral") {
            const link = generateReferralLink(cbUserId, botUsername);
            await sendTgHtml(cbChatId, `👥 Share: ${link}\n💡 Earn 0.1 USDC per referral!`);
          } else if (cbData === "copy_wallet") {
            const w = await getCustodialWallet(cbUserId);
            if (w) await sendTgHtml(cbChatId, `📋 <code>${w.publicKey}</code>\n\nTap the address above to copy.`);
          } else if (cbData === "share_qr") {
            const w = await getCustodialWallet(cbUserId);
            if (w) {
              const { shortWallet: sw2 } = await import("@sendflow/plugin-intent-parser");
              const qr = await generateWalletQR(w.publicKey);
              await sendTgPhoto(cbChatId, qr, `📱 Scan to send me USDC\nWallet: <code>${sw2(w.publicKey)}</code>`);
            }
          } else if (cbData.startsWith("wizard_amount_")) {
            const val = cbData.replace("wizard_amount_", "");
            if (val === "custom") {
              updateWizard(cbUserId, { step: "custom_amount" });
              await sendTgHtml(cbChatId, `💸 Type the amount in USDC (e.g. <code>42.5</code>):`);
            } else {
              const { listContacts: lc } = await import("@sendflow/plugin-intent-parser");
              const contacts = lc(cbUserId);
              updateWizard(cbUserId, { step: "recipient", amount: Number(val) });
              await sendTgWithKeyboard(cbChatId, `👤 <b>Step 2/3:</b> Who to send <b>${val} USDC</b> to?`, contactsKeyboard(contacts));
            }
          } else if (cbData.startsWith("wizard_to_")) {
            const target = cbData.replace("wizard_to_", "");
            if (target === "custom") {
              updateWizard(cbUserId, { step: "custom_recipient" });
              await sendTgHtml(cbChatId, `✍️ Type wallet address or .sol domain:`);
            } else {
              const wiz = getWizard(cbUserId);
              if (wiz?.amount) {
                clearWizard(cbUserId);
                await sendTgHtml(cbChatId, `Processing: Send ${wiz.amount} USDC to ${target}...`);
              }
            }
          } else if (cbData.startsWith("paylink_")) {
            const parts = cbData.replace("paylink_", "").split("_");
            if (parts.length >= 2) {
              const amount = parts[0] === "custom" ? null : Number(parts[0]);
              const username = parts.slice(1).join("_");
              if (amount) {
                await sendTgHtml(cbChatId, `Processing: Send ${amount} USDC to ${username}...`);
              } else {
                await sendTgHtml(cbChatId, `Type the amount to send to ${username} (e.g. <code>Send 25 USDC to ${username}</code>)`);
              }
            }
          } else if (cbData.startsWith("approve_ms_")) {
            const requestId = cbData.slice("approve_ms_".length);
            const ok = approveTransfer(requestId, cbUserId);
            const ex = getPendingExecution(requestId);
            if (ok && ex) {
              ex.approvedAt = new Date().toISOString();
              const res = await executeAfterApproval(
                requestId,
                runtime,
                connection,
                escrow,
                undefined,
                async (payload) => {
                  await sendTgHtml(cbChatId, payload.text ?? "");
                  return [];
                }
              );
              if (res.ok && res.payoutTxHash) {
                await sendTgHtml(
                  cbChatId,
                  `✅ <b>Approved &amp; executed.</b>\n🔗 <a href="https://solscan.io/tx/${res.payoutTxHash}">Solscan</a>`
                );
                if (ex.initiatorChatId) {
                  await sendTgHtml(
                    ex.initiatorChatId,
                    `✅ <b>Transfer complete</b>\n🔗 <a href="https://solscan.io/tx/${res.payoutTxHash}">Solscan</a>${degradedTransferSuffix()}`
                  );
                }
                clearProcessing(ex.userId);
                pinVerifiedForTransfer.delete(ex.userId);
              } else if (!res.ok) {
                await sendTgHtml(cbChatId, `❌ ${res.error ?? "Execution failed"}`);
                if (ex.initiatorChatId) {
                  await sendTgHtml(
                    ex.initiatorChatId,
                    `❌ <b>Transfer failed after approval.</b>\n${res.error ?? ""}\n💡 Check wallet balance and RPC, then try again.`
                  );
                }
                removePendingExecution(requestId);
                removeApprovalRequest(requestId);
                clearProcessing(ex.userId);
                pinVerifiedForTransfer.delete(ex.userId);
              }
            } else {
              await sendTgHtml(cbChatId, `⚠️ Could not approve this request.`);
            }
          } else if (cbData.startsWith("reject_ms_")) {
            const requestId = cbData.slice("reject_ms_".length);
            const ok = rejectTransfer(requestId, cbUserId);
            const ex = getPendingExecution(requestId);
            if (ok && ex?.initiatorChatId) {
              await sendTgHtml(ex.initiatorChatId, `❌ Your transfer was rejected by your approver.`);
            }
            if (ok && ex) {
              removePendingExecution(requestId);
              removeApprovalRequest(requestId);
              clearProcessing(ex.userId);
              pinVerifiedForTransfer.delete(ex.userId);
              await sendTgHtml(cbChatId, `❌ Transfer rejected.`);
            } else {
              await sendTgHtml(cbChatId, `⚠️ Could not reject this request.`);
            }
          } else if (cbData.startsWith("sf_phone_claim_")) {
            const claimCode = cbData.slice("sf_phone_claim_".length);
            await executePhoneClaimPayout({
              runtime,
              recipientUserId: cbUserId,
              recipientChatId: cbChatId,
              claimCode,
              sendHtml: sendTgHtml,
              sendKeyboard: sendTgWithKeyboard,
              connection,
            });
          } else if (cbData === "sf_onboard_send") {
            recordOnboardingFirstAction("send");
            startWizard(cbUserId);
            await sendTgWithKeyboard(cbChatId, `💸 <b>How much USDC?</b>`, amountKeyboard());
          } else if (cbData === "sf_onboard_request") {
            recordOnboardingFirstAction("request");
            await sendTgHtml(
              cbChatId,
              `📩 <b>Request payment</b>\n\nType something like:\n<code>Request 25 USDC from @client for invoice</code>\n\nor <code>Create invoice for 50 USDC</code>`
            );
          } else if (cbData === "sf_onboard_addfunds") {
            recordOnboardingFirstAction("addfunds");
            const w = await getCustodialWallet(cbUserId);
            if (w) {
              await sendTgWithKeyboard(
                cbChatId,
                formatOnRampReply(w.publicKey, getUserLocale(cbUserId).country),
                getOnRampKeyboard(w.publicKey)
              );
            } else await sendTgHtml(cbChatId, `Setting up wallet…`);
          } else if (cbData === "sf_onboard_wallet") {
            recordOnboardingFirstAction("wallet");
            const w = await getCustodialWallet(cbUserId);
            if (w) {
              const bal = await getCustodialUsdcBalance(cbUserId);
              await sendTgHtml(
                cbChatId,
                [`<b>Your wallet</b>`, `Address: <code>${w.publicKey}</code>`, `USDC balance: <b>${bal.toFixed(2)}</b>`].join("\n")
              );
            } else await sendTgHtml(cbChatId, `Wallet not ready yet.`);
          } else if (cbData === "onboard_send") {
            startWizard(cbUserId);
            await sendTgWithKeyboard(cbChatId, `💸 <b>How much USDC?</b>`, amountKeyboard());
          } else if (cbData === "onboard_fund" || cbData === "onboard_fund_first") {
            const w = await getCustodialWallet(cbUserId);
            if (w) {
              await sendTgWithKeyboard(
                cbChatId,
                formatOnRampReply(w.publicKey, getUserLocale(cbUserId).country),
                getOnRampKeyboard(w.publicKey)
              );
            } else await sendTgHtml(cbChatId, `Setting up wallet…`);
          } else if (cbData === "onramp_skip") {
            await sendTgHtml(cbChatId, `Great — when you're ready, say <code>balance</code> or <code>Send $10 to Mom</code>.`);
          } else if (cbData === "onboard_how") {
            advanceOnboarding(cbUserId);
            await sendTgWithKeyboard(
              cbChatId,
              [
                `Watch this:`,
                ``,
                `You type: <i>"Send 5 USDC to raj.sol"</i>`,
                `I do: check rate → lock funds → transfer → confirm`,
                `You pay: ~$0.001 in fees (not $15 like Western Union)`,
                ``,
                `Ready to try?`,
              ].join("\n"),
              onboardingDemoKeyboard()
            );
            scheduleOnboardingReminder(cbUserId, cbChatId, async (html) => {
              await sendTgHtml(cbChatId, html);
            });
          } else if (cbData === "onboard_demo") {
            await sendTgHtml(
              cbChatId,
              `Type: <code>Send 1 USDC to raj.sol</code> (or any wallet / .sol name) — then confirm.`
            );
          } else if (cbData === "onboard_share") {
            const link = generateReferralLink(cbUserId, botUsername ?? "SendFlowSol_bot");
            await sendTgHtml(cbChatId, `Share this link — friends get 3 fee-free txs:\n<code>${link}</code>`);
          } else if (cbData === "onboard_explore") {
            await sendTgWithKeyboard(cbChatId, HELP_MESSAGE, helpKeyboard);
          } else if (cbData.startsWith("challenge_join_")) {
            await sendTgHtml(cbChatId, `You're in this week's challenge. Ship volume and climb the board!`);
          } else if (cbData.startsWith("challenge_lb_")) {
            const cid = cbData.slice("challenge_lb_".length);
            const lb = getChallengeLeaderboard(cid);
            await sendTgHtml(
              cbChatId,
              lb.length ? [`<b>Challenge board</b>`, ...lb.map((r) => `#${r.rank} — ${r.progress}`)].join("\n") : `No scores yet.`
            );
          } else if (cbData.startsWith("ach_share_")) {
            const aid = cbData.slice("ach_share_".length);
            const ach = ACHIEVEMENTS.find((a) => a.id === aid);
            if (ach) {
              await sendTgHtml(
                cbChatId,
                `<a href="${twitterShareUrl(ach, botUsername ?? "SendFlowSol_bot")}">Share on X (Twitter)</a>`
              );
            }
          } else if (cbData === "ach_all") {
            await sendTgHtml(cbChatId, `Badges: send volume, refer friends, keep streaks, vote DAO, run POS, use Earn/Vault/Swap.`);
          } else if (cbData.startsWith("beh_unusual_yes_")) {
            pruneExpiredBehavioralPending();
            const id = cbData.slice("beh_unusual_yes_".length);
            const taken = takeBehavioralPending(id);
            if (!taken || taken.userId !== cbUserId || taken.expiresAt < Date.now()) {
              behavioralResumeByPendingId.delete(id);
              clearBehavioralWizardPending(cbUserId);
              await sendTgHtml(cbChatId, `This confirmation expired. Start the transfer again.`);
            } else {
              const resume = behavioralResumeByPendingId.get(id);
              behavioralResumeByPendingId.delete(id);
              clearBehavioralWizardPending(cbUserId);
              if (!resume) {
                await sendTgHtml(cbChatId, `Could not resume transfer. Try again.`);
              } else {
                setProcessing(cbUserId);
                try {
                  await continueTransferAfterRateLimit(
                    resume.rt,
                    resume.msg,
                    resume.chainState,
                    resume.opts,
                    resume.cb,
                    resume.entityId,
                    resume.roomId
                  );
                } catch (e) {
                  const em = e instanceof Error ? e.message : String(e);
                  log.error("behavioral.resume_failed", { cbUserId }, e instanceof Error ? e : new Error(em));
                  await sendTgHtml(cbChatId, `❌ ${em}`);
                }
              }
            }
          } else if (cbData.startsWith("beh_unusual_no_")) {
            const id = cbData.slice("beh_unusual_no_".length);
            takeBehavioralPending(id);
            behavioralResumeByPendingId.delete(id);
            clearBehavioralWizardPending(cbUserId);
            pinVerifiedForTransfer.delete(cbUserId);
            clearProcessing(cbUserId);
            await sendTgHtml(cbChatId, `Cancelled. This unusual transfer was not sent.`);
          } else if (cbData === "confirm_yes") {
            const stakeP = pendingStakePreview.get(cbUserId);
            if (stakeP) {
              pendingStakePreview.delete(cbUserId);
              stakeUsdc(cbUserId, stakeP.amount, stakeP.lockDays);
              const s = getStakePosition(cbUserId);
              const e = s ? calculateEarned(s) : 0;
              await sendTgWithKeyboard(
                cbChatId,
                [
                  `✅ <b>Stake confirmed</b>`,
                  s ? `Locked: <b>${s.stakedAmount} USDC</b>` : ``,
                  s ? `Accrued (~): <b>${e.toFixed(4)} USDC</b>` : ``,
                ]
                  .filter(Boolean)
                  .join("\n"),
                getStakeStatusKeyboard()
              );
            }
          } else if (cbData === "confirm_no") {
            pendingStakePreview.delete(cbUserId);
            await sendTgHtml(cbChatId, `Cancelled.`);
          } else if (cbData === "loan_accept") {
            const loan = pendingLoanApp.get(cbUserId);
            if (loan && escrow) {
              try {
                const sig = await disburseLoan(loan.loanId, escrow, connection);
                pendingLoanApp.delete(cbUserId);
                await sendTgHtml(cbChatId, `✅ Loan disbursed.\n🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                log.error("loan.disburse_failed", { cbUserId }, e instanceof Error ? e : new Error(em));
                await sendTgHtml(cbChatId, `❌ <b>Something went wrong</b>\n${em}\n💡 Try again or type <b>help</b>`);
              }
            } else {
              await sendTgHtml(cbChatId, `No pending loan or escrow not configured.`);
            }
          } else if (cbData === "loan_decline") {
            const loan = pendingLoanApp.get(cbUserId);
            if (loan) pendingLoanApp.delete(cbUserId);
            await sendTgHtml(cbChatId, `Okay — loan offer dismissed.`);
          } else if (cbData === "stream_pause") {
            const st = pauseStream(cbUserId);
            await sendTgHtml(cbChatId, st ? `Stream <b>paused</b>.` : `No active stream.`);
          } else if (cbData === "stream_stop") {
            const st = getStreamStatus(cbUserId);
            if (st && escrow) {
              try {
                await settleStream(cbUserId, escrow, connection);
                endStream(cbUserId);
                await sendTgHtml(cbChatId, `Stream stopped and settled.`);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                log.error("stream.stop_failed", { cbUserId }, e instanceof Error ? e : new Error(em));
                await sendTgHtml(cbChatId, `❌ <b>Something went wrong</b>\n${em}`);
              }
            } else {
              await sendTgHtml(cbChatId, `No active stream or escrow missing.`);
            }
          } else if (cbData === "pos_sales") {
            const s = getPOSSession(cbUserId);
            const summary = s ? getDailySummary(cbUserId) : `No POS session.`;
            await sendTgHtml(cbChatId, typeof summary === "string" ? summary : String(summary));
          } else if (cbData === "pos_disable") {
            disablePOS(cbUserId);
            await sendTgHtml(cbChatId, `POS mode disabled.`);
          } else if (cbData.startsWith("vote_yes_")) {
            const pid = cbData.slice("vote_yes_".length);
            const tid = findTreasuryIdByProposalId(pid);
            if (tid) {
              voteOnProposal(tid, pid, cbUserId, "yes");
              recordDaoVote(cbUserId);
              await sendTgHtml(cbChatId, `Recorded <b>YES</b> on <code>${pid}</code>.`);
            } else await sendTgHtml(cbChatId, `Proposal not found.`);
          } else if (cbData.startsWith("vote_no_")) {
            const pid = cbData.slice("vote_no_".length);
            const tid = findTreasuryIdByProposalId(pid);
            if (tid) {
              voteOnProposal(tid, pid, cbUserId, "no");
              recordDaoVote(cbUserId);
              await sendTgHtml(cbChatId, `Recorded <b>NO</b> on <code>${pid}</code>.`);
            } else await sendTgHtml(cbChatId, `Proposal not found.`);
          } else if (cbData.startsWith("execute_proposal_")) {
            const pid = cbData.slice("execute_proposal_".length);
            const tid = findTreasuryIdByProposalId(pid);
            if (tid && escrow) {
              try {
                const sig = await executeProposal(tid, pid, escrow, connection);
                await sendTgHtml(cbChatId, `✅ Executed.\n🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                log.error("treasury.execute_failed", { cbUserId, pid }, e instanceof Error ? e : new Error(em));
                await sendTgHtml(cbChatId, `❌ ${em}`);
              }
            } else {
              await sendTgHtml(cbChatId, `Cannot execute (treasury/escrow/proposal).`);
            }
          } else if (cbData.startsWith("blink_profile_")) {
            const u = cbData.slice("blink_profile_".length);
            const url = generateProfileBlink(u);
            await sendTgHtml(cbChatId, `Blink profile URL:\n<code>${url}</code>`);
          } else if (cbData.startsWith("send_to_")) {
            const u = cbData.slice("send_to_".length);
            await sendTgHtml(cbChatId, `Say: <code>Send 10 USDC to @${u}</code> (change the amount as needed).`);
          } else if (cbData === "swap_confirm") {
            const amt = pendingSwapAmount.get(cbUserId);
            const w = await getCustodialWallet(cbUserId);
            if (amt && w) {
              try {
                const sig = await executeSwap(cbUserId, USDC_MAINNET, SOL_MINT, amt, 6, 50, connection);
                pendingSwapAmount.delete(cbUserId);
                if (sig) {
                  await sendTgHtml(cbChatId, `✅ Swap submitted.\n🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`);
                } else {
                  await sendTgHtml(cbChatId, `Swap could not complete. Check balance and RPC.`);
                }
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                log.error("swap.confirm_failed", { cbUserId }, e instanceof Error ? e : new Error(em));
                await sendTgHtml(cbChatId, `❌ ${em}`);
              }
            } else {
              await sendTgHtml(cbChatId, `No pending swap or wallet missing. Say <code>swap 10 USDC to SOL</code>.`);
            }
          } else if (cbData === "swap_cancel") {
            pendingSwapAmount.delete(cbUserId);
            await sendTgHtml(cbChatId, `Swap cancelled.`);
          } else if (cbData === "vault_deposit") {
            await sendTgHtml(cbChatId, `Type: <code>deposit 50 USDC to savings</code> (or similar).`);
          } else if (cbData === "vault_withdraw") {
            const pos = getVaultPosition(cbUserId);
            if (!pos) {
              await sendTgHtml(cbChatId, `No vault deposit.`);
            } else {
              const out = await withdrawFromVault(cbUserId);
              await sendTgHtml(
                cbChatId,
                out ? `✅ Withdrawn (recorded). You had <b>${out.depositedAmount} USDC</b> in ${out.protocol}.` : `Nothing to withdraw.`
              );
            }
          } else if (cbData === "vault_earnings") {
            const pos = getVaultPosition(cbUserId);
            if (!pos) await sendTgHtml(cbChatId, `No vault deposit.`);
            else {
              const { daily, monthly } = calculateEarnings(pos);
              await sendTgHtml(
                cbChatId,
                `Vault: <b>${pos.depositedAmount} USDC</b> @ ${pos.estimatedAPY.toFixed(1)}% APY\nEst. daily: <b>${daily.toFixed(4)}</b> · monthly: <b>${monthly.toFixed(2)} USDC</b>`
              );
            }
          } else if (cbData === "alert_new") {
            await sendTgHtml(cbChatId, `Type: <code>alert me when SOL below 100</code> (adjust to your rule).`);
          } else if (cbData === "swap_sol") {
            await sendTgHtml(cbChatId, `Type: <code>swap 10 USDC to SOL</code> for a quote and confirm.`);
          } else if (cbData === "action_savings") {
            const g = await getBestYield();
            await sendTgWithKeyboard(
              cbChatId,
              `🏦 <b>Savings vault</b>\nBest yield: <b>${g.apy.toFixed(1)}%</b> (${g.protocol})`,
              savingsKeyboard
            );
          } else if (cbData === "action_market") {
            const pulse = await getMarketPulse(connection);
            await sendTgWithKeyboard(cbChatId, pulse, marketKeyboard);
          } else if (cbData === "action_leaderboard") {
            const top = await getTopSenders(10);
            const lines = top.map((e, i) => `${i + 1}. ${e.displayName} — ${e.totalSent.toFixed(2)} USDC`);
            await sendTgWithKeyboard(cbChatId, (lines.length ? [`<b>Top senders</b>`, ...lines] : [`No entries yet.`]).join("\n"), leaderboardKeyboard);
          } else if (cbData === "action_card") {
            const bal = await getCustodialUsdcBalance(cbUserId);
            const txs = sharedGetAllTransfers(cbUserId);
            const totalSent = txs.reduce((s, t) => s + (t.amount ?? 0), 0);
            const prof = getProfile(cbUserId);
            const totalReceived = prof?.totalReceived ?? 0;
            const score = calculateCreditScore(cbUserId);
            try {
              const png = await generateStatusCard(cbUserId, bal, totalSent, totalReceived, score, prof?.username);
              await sendTgPhoto(cbChatId, png, `Your SendFlow status card`);
            } catch (e) {
              await sendTgHtml(cbChatId, `Could not render card: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else if (cbData === "key_export_confirm") {
            const wallet = await getCustodialWallet(cbUserId);
            if (!wallet) {
              await sendTgHtml(cbChatId, `No wallet.`);
            } else if (!(await hasPin(cbUserId))) {
              await sendTgHtml(
                cbChatId,
                `🔐 Set a PIN first: <code>/setpin 123456</code> — then use Export again.`
              );
            } else {
              exportPinAwaiting.add(cbUserId);
              await sendTgHtml(
                cbChatId,
                `⚠️ <b>Export private key</b>\n\n🔐 Enter your <b>6-digit PIN</b> in chat to start a 60s countdown before the key is sent.`
              );
            }
          } else if (cbData === "key_export_cancel") {
            exportPinAwaiting.delete(cbUserId);
            await sendTgHtml(cbChatId, `Export cancelled.`);
          } else if (cbData === "leaderboard_join") {
            const from = cbq.from as { id: number; username?: string; first_name?: string } | undefined;
            const name = from?.username ? `@${from.username}` : from?.first_name ?? "User";
            await joinLeaderboard(cbUserId, name);
            await sendTgHtml(cbChatId, `You joined the leaderboard.`);
          } else if (cbData === "leaderboard_rank") {
            const r = await getUserRank(cbUserId);
            await sendTgHtml(cbChatId, r < 0 ? `Not ranked yet.` : `Your rank: <b>#${r}</b>`);
          } else if (cbData.startsWith("stake_")) {
            const tier = cbData.replace("stake_", "");
            if (tier === "cancel") {
              pendingStakeAmount.delete(cbUserId);
              pendingStakePreview.delete(cbUserId);
              await sendTgHtml(cbChatId, `Stake flow cancelled.`);
            } else if (tier === "withdraw") {
              const s = getStakePosition(cbUserId);
              if (!s || !escrow) {
                await sendTgHtml(cbChatId, `No stake or escrow.`);
              } else if (!isMatured(s)) {
                await sendTgHtml(cbChatId, `Still locked until <b>${new Date(s.maturesAt).toLocaleString()}</b>.`);
              } else {
                try {
                  const sig = await withdrawStake(cbUserId, escrow, connection);
                  await sendTgHtml(cbChatId, `✅ Withdrawn. <code>${sig.slice(0, 10)}…</code>`);
                } catch (e) {
                  await sendTgHtml(cbChatId, `❌ ${e instanceof Error ? e.message : String(e)}`);
                }
              }
            } else if (tier === "earnings") {
              const s = getStakePosition(cbUserId);
              if (!s) await sendTgHtml(cbChatId, `No active stake.`);
              else {
                const e = calculateEarned(s);
                await sendTgHtml(cbChatId, `Accrued (~): <b>${e.toFixed(4)} USDC</b> on <b>${s.stakedAmount} USDC</b> staked.`);
              }
            } else {
              const days = tier === "7" ? 7 : tier === "30" ? 30 : tier === "90" ? 90 : 0;
              if (!days) await sendTgHtml(cbChatId, `Unknown stake option.`);
              else await sendTgHtml(cbChatId, `Type: <code>Stake 50 USDC for ${days} days</code> to preview and confirm.`);
            }
          } else if (cbData.startsWith("split_pay_")) {
            const sid = cbData.slice("split_pay_".length);
            const ok = recordPayment(sid, cbUserId);
            const sp = getSplitStatus(sid);
            if (ok && sp) {
              await sendTgHtml(cbChatId, `✅ Recorded your payment.`);
              if (sp.status === "complete" && sp.groupChatId) {
                await sendTgHtml(sp.groupChatId, `✅ Bill fully settled! Total collected: <b>${sp.totalAmount} USDC</b>`);
              } else if (sp.groupChatId) {
                await sendTgWithKeyboard(sp.groupChatId, formatSplitMessage(sp), [
                  [{ text: "💸 Pay my share", callback_data: `split_pay_${sp.splitId}` }],
                ] as InlineKeyboard);
              }
            } else {
              await sendTgHtml(cbChatId, `Could not record payment (wrong split or already paid).`);
            }
          } else if (cbData.startsWith("rollback_dismiss_")) {
            const uid = cbData.slice("rollback_dismiss_".length);
            if (uid === cbUserId) expireRollback(cbUserId);
          } else if (cbData.startsWith("rollback_") && !cbData.startsWith("rollback_dismiss_")) {
            const uid = cbData.slice("rollback_".length);
            if (uid !== cbUserId) {
              await sendTgHtml(cbChatId, `Not your rollback.`);
            } else if (!escrow) {
              await sendTgHtml(cbChatId, `Escrow not configured.`);
            } else {
              try {
                const sig = await executeRollback(cbUserId, escrow, connection);
                await sendTgHtml(cbChatId, `↩ Undo sent.\n🔗 <a href="https://solscan.io/tx/${sig}">Solscan</a>`);
              } catch (e) {
                const em = e instanceof Error ? e.message : String(e);
                await sendTgHtml(cbChatId, `❌ ${em}`);
              }
            }
          } else if (cbData === "settings_export") {
            await sendTgWithKeyboard(
              cbChatId,
              `⚠️ <b>Export private key</b>\n\nRequires a PIN (<code>/setpin</code>). After you confirm, you'll enter your PIN and wait 60s before the key is sent.`,
              exportKeyboard
            );
          } else if (cbData === "settings_lang") {
            await sendTgHtml(cbChatId, `🌐 Type: <code>Switch to Hindi</code> (or Spanish/Tagalog/Swahili/English)`);
          } else if (cbData === "settings_speed") {
            await sendTgHtml(cbChatId, `⚡ Type: <code>Always send transactions fast</code>`);
          } else if (cbData === "settings_budget") {
            await sendTgHtml(cbChatId, `💰 Type: <code>Set my monthly budget to 500 USDC</code>`);
          } else if (cbData === "settings_digest") {
            const enabled = isDigestEnabled(cbUserId);
            await sendTgHtml(cbChatId, enabled ? `Type <code>stop daily digest</code> to disable.` : `Type <code>send me daily updates</code> to enable.`);
          } else if (cbData === "settings_business") {
            await sendTgHtml(cbChatId, `Type <code>enable business mode</code> to unlock business features.`);
          }
        }
      } catch (e) {
        log.error("telegram.callback_poll_failed", {}, e instanceof Error ? e : new Error(String(e)));
      }
      setTimeout(poll, 100);
    };
    poll();
  };
  pollCallbackQueries();
  const rpcQueueInterval = setInterval(() => {
    void processRpcRetryQueue(runtime, connection, undefined, async (cid, text) => {
      await sendTgHtml(cid, text);
    });
  }, 30_000);
  const multisigExpiryInterval = setInterval(() => {
    for (const id of getExpiredPendingExecutionIds()) {
      const ex = getPendingExecution(id);
      const apr = getApproval(id);
      if (ex?.initiatorChatId) {
        void sendTgHtml(
          ex.initiatorChatId,
          `⏱ <b>Approval request expired.</b>\n\nNo funds were moved.`
        );
      }
      if (apr?.approverTelegramId) {
        void sendTgHtml(apr.approverTelegramId, `⏱ <b>Approval request expired.</b>`);
      }
      removePendingExecution(id);
      removeApprovalRequest(id);
      if (ex?.userId) {
        clearProcessing(ex.userId);
        pinVerifiedForTransfer.delete(ex.userId);
      }
    }
  }, 60_000);
  const loanOverdueInterval = setInterval(() => {
    const overdue = checkOverdueLoans();
    for (const loan of overdue) {
      void sendTgHtml(
        loan.userId,
        `⚠️ <b>Loan Overdue!</b>\nYou owe <b>${(loan.approvedAmount * (1 + loan.interestRate)).toFixed(2)} USDC</b>\nReply <b>repay my loan</b> to settle now.`
      );
    }
  }, 3_600_000);

  const streamSettleMs = Number(process.env.STREAM_SETTLEMENT_INTERVAL_MS ?? 300_000);
  const streamSettleInterval = setInterval(() => {
    void (async () => {
      if (!escrow) return;
      for (const [userId, streamId] of getUserStreamsMap()) {
        const stream = getStreamsMap().get(streamId);
        if (stream?.status === "active") {
          const streamed = calculateStreamed(stream);
          const delta = streamed - stream.totalStreamed;
          if (delta >= 0.01) {
            try {
              await settleStream(userId, escrow, connection);
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    })();
  }, streamSettleMs);

  const weeklyReportInterval = scheduleWeeklyReports(runtime, async (cid, html) => {
    await sendTgHtml(cid, html);
  });

  const smartNotifInterval = scheduleSmartNotifications(
    async (userId, html) => {
      await sendTgHtml(userId, html);
    },
    () => getAllSeenUserIds()
  );

  const receiptExpiryInterval = setInterval(() => {
    const expired = expireOldReceipts();
    for (const r of expired) {
      void sendTgHtml(
        String(r.senderUserId),
        `⏳ Phone invite <code>${r.receiptId}</code> expired after 7 days with no claim. Start a new invite if you still need it.`
      ).catch(() => {});
    }
  }, 3_600_000);

  const challengeAndNotifyInterval = setInterval(() => {
    void (async () => {
      const d = new Date();
      if (d.getUTCDate() === 1 && d.getUTCHours() === 8) {
        const mk = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        if (mk !== lastMonthlyReportMonth) {
          lastMonthlyReportMonth = mk;
          for (const uid of sharedGetAllTransferUserIds()) {
            const html = formatMonthlySpendingReport(uid);
            if (html) await sendTgHtml(uid, html);
          }
        }
      }
      const ch = rotateChallengeIfNeeded();
      if (!ch) return;
      if (d.getUTCDay() === 1 && d.getUTCHours() === 9 && lastChallengeBroadcastId !== ch.challengeId) {
        lastChallengeBroadcastId = ch.challengeId;
        const end = new Date(ch.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const start = new Date(ch.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const msg = [
          `🏆 <b>This Week's Challenge</b>`,
          `<b>${ch.title}</b> — ${ch.description}`,
          ``,
          `Prize pool: <b>${ch.prizePool} USDC</b>`,
          `Duration: ${start} – ${end}`,
        ].join("\n");
        for (const uid of getAllSeenUserIds()) {
          await sendTgWithKeyboard(uid, msg, challengeKeyboard(ch.challengeId));
        }
      }
      const bucket = `${Math.floor(Date.now() / (6 * 3600000))}`;
      if (bucket !== lastTop3NotifyBucket) {
        lastTop3NotifyBucket = bucket;
        const top = topThreeForNotify();
        for (const t of top) {
          await sendTgHtml(t.userId, `🏆 Weekly challenge: you're <b>#${t.rank}</b> (progress ${t.progress}).`);
        }
      }
    })();
  }, 60 * 60 * 1000);

  (globalThis as { __sendflowIntervals?: ReturnType<typeof setInterval>[] }).__sendflowIntervals = [
    rpcQueueInterval,
    multisigExpiryInterval,
    loanOverdueInterval,
    streamSettleInterval,
    weeklyReportInterval,
    smartNotifInterval,
    receiptExpiryInterval,
    challengeAndNotifyInterval,
  ];
  logger.info("Callback query handler started");
}

const healthServer = startHealthServer({
  connection,
  runtime,
  getQueueSize: () => getAllQueued().length,
  getEscrowBalance: async () => {
    if (!escrow) return null;
    return (await connection.getBalance(escrow.publicKey)) / 1e9;
  },
  ollamaOk: () => llmHealthy,
});

const webappUrl = process.env.WEBAPP_PUBLIC_URL?.trim();
if (botToken && webappUrl) {
  await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "💳 SendFlow",
        web_app: { url: webappUrl },
      },
    }),
  }).catch(() => {});
}

const adminId = process.env.ADMIN_TELEGRAM_ID;
if (adminId && botToken) {
  const escrowAddr = escrow ? escrow.publicKey.toBase58().slice(0, 4) + "..." + escrow.publicKey.toBase58().slice(-4) : "N/A";
  const twilioOn = Boolean(process.env.TWILIO_ACCOUNT_SID?.trim());
  const whisperOn = Boolean(process.env.WHISPER_ENDPOINT?.trim());
  const chainOn = Boolean(process.env.CHAINALYSIS_API_KEY?.trim());
  const receiptsOn = process.env.MINT_RECEIPTS === "true";
  if (process.env.NOSANA_LLM_ENDPOINT?.trim() && !llmHealthy) {
    await sendTgHtml(
      adminId,
      `⚠️ <b>SendFlow started in degraded mode</b>\nLLM endpoint unreachable.\nIntent parsing may use heuristics only.`
    ).catch(() => {});
  }
  await sendTgHtml(adminId, [
    `⚡ <b>SendFlow v1.0 Started</b>`,
    ``,
    `Telegram: ✅`,
    `LLM (Nosana): ${llmHealthy ? "✅" : process.env.NOSANA_LLM_ENDPOINT?.trim() ? "⚠️ degraded" : "❌ not configured"}`,
    `Solana RPC: ✅`,
    `Twilio SMS: ${twilioOn ? "✅" : "❌ disabled"}`,
    `Voice (Whisper): ${whisperOn ? "✅" : "❌ disabled"}`,
    `Chainalysis: ${chainOn ? "✅" : "❌ off"}`,
    `Receipt NFTs: ${receiptsOn ? "✅" : "❌"}`,
    ``,
    `Mode: ${process.env.NODE_ENV ?? "development"}`,
    `Escrow: <code>${escrowAddr}</code>`,
    `🌐 Health: <code>http://localhost:${process.env.PORT ?? 3000}/health</code>`,
  ].join("\n"));
}

log.info("startup.complete", {
  features: {
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim()),
    llm: llmHealthy,
    solana: Boolean(escrow),
    twilio: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()),
    whisper: Boolean(process.env.WHISPER_ENDPOINT?.trim()),
    chainalysis: Boolean(process.env.CHAINALYSIS_API_KEY?.trim()),
    receipts: process.env.MINT_RECEIPTS === "true",
  },
  mode: process.env.NODE_ENV ?? "development",
  version: "1.0.0",
});

async function continueTransferAfterRateLimit(
  rt: IAgentRuntime,
  msg: Memory,
  chainState: State,
  opts: Parameters<NonNullable<typeof confirmSendflowAction.handler>>[3],
  cb: HandlerCallback | undefined,
  entityId: string,
  roomId: string
): Promise<ActionResult | undefined> {
  let chainSf = { ...(((chainState as any)?.values?.sendflow ?? {}) as Record<string, unknown>) };

  const intentMs = chainSf.intent as import("@sendflow/plugin-intent-parser").RemittanceIntent | undefined;
  const msAmount = Number(intentMs?.amount ?? 0);
  const approverTg = getApproverTelegramId(entityId);
  if (msAmount > TRANSFER_LIMITS.MULTISIG_THRESHOLD && approverTg && intentMs) {
    const rateSnap = coerceRateSnapshot(chainSf.rate, intentMs);
    const req = requestApproval({
      initiatorUserId: entityId,
      approverWallet: "",
      approverTelegramId: approverTg,
      amount: msAmount,
      recipient: intentMs.receiverWallet,
      expiresInMs: 600_000,
    });
    const metaChatMs = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
    const initiatorChatIdMs =
      metaChatMs?.telegram?.chat?.id != null ? String(metaChatMs.telegram.chat.id) : undefined;
    storePendingExecution(req.requestId, {
      requestId: req.requestId,
      userId: entityId,
      roomId,
      intent: intentMs,
      rate: rateSnap,
      usdcLockAmount: msAmount,
      initiatorChatId: initiatorChatIdMs,
      approverTelegramId: approverTg,
      speedMode: String((chainSf as { speedMode?: string }).speedMode ?? "normal"),
    });
    await sendTgWithKeyboard(
      approverTg,
      [
        `🔐 <b>Approval required</b>`,
        ``,
        `<b>${msAmount} USDC</b> → <code>${intentMs.receiverWallet.slice(0, 4)}…${intentMs.receiverWallet.slice(-4)}</code>`,
        `Initiator: <code>${String(entityId).slice(0, 12)}…</code>`,
        ``,
        `Expires in <b>10 minutes</b>.`,
      ].join("\n"),
      approvalKeyboard(req.requestId)
    );
    if (cb) {
      await cb({
        text: `⏳ <b>Waiting for approver</b>\n\nYour co-signer must approve this transfer within 10 minutes.`,
        source: msg.content.source,
      });
    }
    return { success: true, text: "awaiting multisig" };
  }

  recordRequest(entityId, "transfers");

  const lr = await lockUsdcEscrowAction.handler(rt, msg, chainState as any, opts, cb);
  const lockResult = lr ?? { success: false as const, text: "Lock failed" };
  if (!lockResult.success) {
    recordTransferResult("failed");
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    return lockResult;
  }
  if ((lockResult.data as { queued?: boolean } | undefined)?.queued) {
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    return { success: true, text: lockResult.text ?? "queued", data: lockResult.data };
  }

  chainSf = {
    ...chainSf,
    ...((lockResult.values?.sendflow ?? {}) as Record<string, unknown>),
  };
  chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } } as State;

  const rr = await routePayoutAction.handler(rt, msg, chainState as any, opts, cb);
  const routeResult = rr ?? { success: false as const, text: "Route failed" };
  if (!routeResult.success) {
    recordTransferResult("failed");
    pinVerifiedForTransfer.delete(entityId);
    clearProcessing(entityId);
    return routeResult;
  }

  chainSf = {
    ...chainSf,
    ...((routeResult.values?.sendflow ?? {}) as Record<string, unknown>),
  };
  chainState = { ...chainState, values: { ...chainState.values, sendflow: chainSf } } as State;

  const payoutData = (chainSf.payout ?? {}) as Record<string, unknown>;
  const intentData = (chainSf.intent ?? {}) as Record<string, unknown>;
  if (payoutData.txHash && msg.entityId) {
    try {
      const custodial = await getCustodialWallet(entityId);
      const usdcMint = process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      const intentForCat: RemittanceIntent = {
        amount: Number(payoutData.amountSent ?? intentData.amount ?? 0),
        sourceMint: String(intentData.sourceMint ?? usdcMint),
        targetMint: String(intentData.targetMint ?? usdcMint),
        targetRail: "SPL_TRANSFER",
        receiverLabel: String(intentData.receiverLabel ?? "recipient"),
        receiverWallet: String(intentData.receiverWallet ?? ""),
        memo: typeof intentData.memo === "string" ? intentData.memo : undefined,
        confidence: typeof intentData.confidence === "number" ? intentData.confidence : 1,
      };
      recordTransaction(msg.entityId as string, {
        amount: Number(payoutData.amountSent ?? intentData.amount ?? 0),
        receiverWallet: String(intentData.receiverWallet ?? ""),
        receiverLabel: String(intentData.receiverLabel ?? "recipient"),
        txHash: String(payoutData.txHash),
        explorerUrl: String(payoutData.explorerUrl ?? `https://solscan.io/tx/${payoutData.txHash}`),
        completedAt: new Date().toISOString(),
        category: categorizeTransfer(intentForCat, entityId, custodial?.publicKey),
        memo: intentForCat.memo,
      });
      const payoutAmt = Number(payoutData.amountSent ?? intentData.amount ?? 0);
      void recordTransferForProfile(entityId, payoutAmt, String(intentData.receiverWallet ?? "")).catch(() => {});
      logger.info("CHAIN: transaction recorded in history");
      metrics.totalTransfers += 1;
      recordTransferResult("success");
      noteUserActive24h(entityId);
      recordVolume24h(payoutAmt);
      auditLog({
        level: "info",
        action: "ROUTE_PAYOUT",
        result: "success",
        userId: entityId,
        amountUsdc: payoutAmt,
        recipientHash: String(intentData.receiverWallet ?? "")
          ? hashRecipientAddress(String(intentData.receiverWallet))
          : undefined,
        txSig: String(payoutData.txHash ?? ""),
      });
      auditLog({
        level: "info",
        action: "transfer.completed",
        result: "success",
        userId: entityId,
        amountUsdc: payoutAmt,
        recipientHash: String(intentData.receiverWallet ?? "")
          ? hashRecipientAddress(String(intentData.receiverWallet))
          : undefined,
        txSig: String(payoutData.txHash ?? ""),
      });
      noteFirstTransfer(entityId);
      recordTransferVolume(entityId, payoutAmt, 0);
      bumpChallengeForUser(entityId, { volumeDelta: payoutAmt, transferDelta: 1 });
      recordHourlyTransfer(payoutAmt);
      updateContext(entityId, {
        lastRecipient: String(intentData.receiverWallet ?? ""),
        lastAmount: payoutAmt,
        lastAction: "transfer",
      });
      trackFeatureDiscovery(entityId, "transfer");
      incrementFeatureUsage("transfer");
      addFeedEvent({
        type: "transfer",
        displayText: `Someone sent ${payoutAmt.toFixed(0)} USDC`,
        timestamp: new Date().toISOString(),
        emoji: "💸",
      });
      void (async () => {
        const fresh = getNewlyUnlocked(entityId);
        const meta = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
        const ch = meta?.telegram?.chat?.id;
        for (const ach of fresh) {
          if (escrow && ach.reward) {
            try {
              await grantAchievement(entityId, ach, escrow, connection);
            } catch (e) {
              log.error("achievement.grant_failed", { entityId, id: ach.id }, e instanceof Error ? e : new Error(String(e)));
            }
          }
          if (ch) {
            await sendTgWithKeyboard(String(ch), generateAchievementCard(ach), achievementUnlockedKeyboard(ach.id));
          }
          addFeedEvent({
            type: "achievement",
            displayText: `Someone unlocked "${ach.name}" badge`,
            timestamp: new Date().toISOString(),
            emoji: ach.icon,
          });
        }
        if (!isOnboardingComplete(entityId) && ch) {
          completeOnboarding(entityId);
          await sendTgWithKeyboard(
            String(ch),
            [
              `✅ You just sent money on Solana.`,
              ``,
              `Tell a friend — they get <b>3 free transactions</b>.`,
              `You get <b>0.1 USDC</b> when they send their first transfer.`,
            ].join("\n"),
            onboardingCompleteKeyboard()
          );
        }
        const sr = checkStreakReward(entityId);
        if (sr && escrow && ch) {
          try {
            await payStreakReward(entityId, escrow, connection);
            await sendTgHtml(
              String(ch),
              `🔥 <b>Day ${getStreak(entityId).currentStreak} Streak!</b>\nYou've used SendFlow every day.\n\nReward: <b>${sr.reward}</b>\nLongest streak: <b>${getStreak(entityId).longestStreak}</b> days`
            );
          } catch (e) {
            log.error("streak.pay_failed", { entityId }, e instanceof Error ? e : new Error(String(e)));
          }
        }
      })();
      markTransferCompleted(entityId);
      logTransfer("completed", {
        userId: entityId,
        amount: Number(payoutData.amountSent ?? intentData.amount ?? 0),
        txHash: String(payoutData.txHash),
      });
      try {
        const histAll = sharedGetAllTransfers(entityId);
        const currentTx = histAll[0];
        const prior = histAll.slice(1);
        const insight =
          currentTx &&
          (await generateInsight(entityId, prior as SharedTxRecord[], currentTx as SharedTxRecord, rt));
        const metaI = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
        const ch = metaI?.telegram?.chat?.id;
        if (insight && ch && !isInsightsDisabled(entityId)) await sendTgHtml(String(ch), insight);
      } catch (err) {
        log.error("chain.insight_failed", { entityId }, err instanceof Error ? err : new Error(String(err)));
      }
      const tgName = (msg.metadata as { telegram?: { from?: { username?: string } } })?.telegram?.from?.username;
      await updateLeaderboard(entityId, Number(payoutData.amountSent ?? intentData.amount ?? 0), tgName ?? entityId).catch(() => {});

      await updateStats(entityId, Number(payoutData.amountSent ?? intentData.amount ?? 0)).catch(() => {});

      const referrerId = getReferrerOf(entityId);
      if (referrerId && !hasCompletedFirstTransfer(entityId)) {
        markReferralPaid(referrerId, entityId);
        sendTelegramNotification(referrerId, `🎁 <b>Referral reward!</b> Your referral just completed their first transfer. +0.1 USDC!`).catch(() => {});
      }

      if (process.env.MINT_RECEIPTS === "true" && escrow) {
        const receiptMeta: ReceiptMetadata = {
          sender: String(intentData.senderWallet ?? ""),
          receiver: String(intentData.receiverWallet ?? ""),
          amount: Number(payoutData.amountSent ?? 0),
          token: "USDC",
          txHash: String(payoutData.txHash),
          timestamp: new Date().toISOString(),
        };
        mintTransferReceipt(connection, escrow, receiptMeta).then((receiptTx) => {
          if (receiptTx) logger.info(`Receipt NFT minted: ${receiptTx}`);
        }).catch(() => {});
      }

      const meta = msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined;
      const txChatId = meta?.telegram?.chat?.id;
      if (txChatId && botToken && payoutData.txHash) {
        const statusMsgId = await sendTgHtml(String(txChatId), `⏳ <b>Transaction submitted...</b>\n🔗 <a href="https://solscan.io/tx/${payoutData.txHash}">View on Solscan</a>`);
        if (statusMsgId) {
          trackTransactionStatus(connection, String(payoutData.txHash), String(txChatId), botToken, statusMsgId).catch((e) =>
            log.error("tx.track_status_failed", { txHash: payoutData.txHash }, e instanceof Error ? e : new Error(String(e)))
          );
        }
        const cw = await getCustodialWallet(entityId);
        const senderPk = cw?.publicKey ?? String(intentData.senderWallet ?? "");
        if (intentData.receiverWallet && senderPk) {
          openRollbackWindow(
            entityId,
            String(payoutData.txHash),
            Number(payoutData.amountSent ?? intentData.amount ?? 0),
            String(intentData.receiverWallet),
            senderPk
          );
          const loc = getUserLocale(entityId);
          recordTransferSavings(entityId, payoutAmt, loc.country, loc.country);
          const lifetimeSaved = getTotalSavedVsWu(entityId);
          const compBlock = formatCompetitorBlock(payoutAmt, loc.country, loc.country, lifetimeSaved);
          const wuLine = formatLocalizedWuLine(payoutAmt, loc, loc.country);
          const undoId = await sendTgWithKeyboard(
            String(txChatId),
            [
              `✅ <b>Transfer complete!</b>${degradedTransferSuffix()}`,
              `💸 Sent: <b>${payoutAmt.toFixed(2)} USDC</b>`,
              wuLine,
              ``,
              compBlock,
              ``,
              `🔗 <a href="https://solscan.io/tx/${payoutData.txHash}">View transaction</a>`,
              ``,
              `<i>Made a mistake? You have 30 seconds to undo.</i>`,
            ].join("\n"),
            rollbackKeyboard(entityId)
          );
          if (undoId) {
            setTimeout(() => {
              void editMessageReplyMarkup(String(txChatId), undoId);
              expireRollback(entityId);
            }, 30_000);
          }
        }
      }
    } catch (err) {
      log.error("chain.post_payout_notify_failed", { entityId }, err instanceof Error ? err : new Error(String(err)));
      if (msg.metadata && (msg.metadata as { telegram?: { chat?: { id?: number } } }).telegram?.chat?.id) {
        await sendTgHtml(
          String((msg.metadata as { telegram?: { chat?: { id?: number } } }).telegram!.chat!.id),
          `❌ <b>Something went wrong</b> updating your transfer summary.\n💡 Check <b>history</b> or Solscan.\n${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  try {
    await notifyPartiesAction.handler(rt, msg, chainState as any, opts, cb);
  } catch (err) {
    log.error("chain.notify_parties_failed", { entityId }, err instanceof Error ? err : new Error(String(err)));
    const ch = (msg.metadata as { telegram?: { chat?: { id?: number } } } | undefined)?.telegram?.chat?.id;
    if (ch) {
      await sendTgHtml(
        String(ch),
        `❌ <b>Transfer went through</b> but notifications failed.\n${err instanceof Error ? err.message : String(err)}\n💡 Try <b>history</b> for the tx link.`
      );
    }
  }

  pinVerifiedForTransfer.delete(entityId);
  clearProcessing(entityId);
  return routeResult;
}

process.on("SIGTERM", async () => {
  logger.info("SIGTERM: graceful shutdown");
  const ints = (globalThis as { __sendflowIntervals?: ReturnType<typeof setInterval>[] }).__sendflowIntervals;
  if (ints) for (const id of ints) clearInterval(id);
  try {
    await processRpcRetryQueue(runtime, connection, undefined, async (cid, text) => {
      await sendTgHtml(cid, text);
    });
  } catch {
    /* noop */
  }
  try {
    healthServer?.close(() => process.exit(0));
  } catch {
    process.exit(0);
  }
});

export type E2eAgentResponse = {
  replied: string[];
  blocked: boolean;
  threatLabel?: "safe" | "suspicious" | "block";
  txSig?: string;
};

function e2eStableChatNumericId(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

function e2eExtractTxSig(blob: string): string | undefined {
  const m = blob.match(/solscan\.io\/tx\/([1-9A-HJ-NP-Za-km-z]{32,128})/);
  return m?.[1];
}

async function injectMessage(userId: string, text: string): Promise<E2eAgentResponse> {
  resetE2eCapture();
  const roomId = `e2e-room-${userId}`;
  const memory = {
    id: crypto.randomUUID(),
    entityId: userId,
    roomId,
    agentId: runtime.agentId,
    content: { text, source: "telegram" },
    createdAt: Date.now(),
    metadata: {
      telegram: {
        chat: { id: e2eStableChatNumericId(userId) },
        from: { username: userId },
      },
    },
  } as Memory;

  const cb: HandlerCallback = async (resp) => {
    const t = resp?.text;
    if (typeof t === "string" && t.trim()) pushE2eReply(t);
    return [];
  };

  if (await confirmSendflowAction.validate(runtime, memory, undefined)) {
    await confirmSendflowAction.handler(runtime, memory, undefined, {}, cb);
  } else if (await parseRemittanceIntentAction.validate(runtime, memory, undefined)) {
    await parseRemittanceIntentAction.handler(runtime, memory, undefined, {}, cb);
  } else {
    await parseRemittanceIntentAction.handler(runtime, memory, undefined, {}, cb);
  }

  const snap = getE2eCaptureSnapshot();
  const blob = snap.replies.join("\n");
  const txSig = e2eExtractTxSig(blob);
  const blocked = snap.threatBlocked || /\bcouldn'?t be processed\b/i.test(blob);
  return { replied: snap.replies, blocked, threatLabel: snap.threatLabel, txSig };
}

if (isAgentE2e) {
  (globalThis as unknown as { __sendflowE2eInjectMessage?: typeof injectMessage }).__sendflowE2eInjectMessage =
    injectMessage;
}

logger.info(
  isAgentE2e
    ? "SendFlow E2E harness ready (Telegram disabled, inject via __sendflowE2eInjectMessage)."
    : "SendFlow agent running (Telegram + in-memory DB). Press Ctrl+C to stop."
);
