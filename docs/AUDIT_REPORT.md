# SendFlow — Full Technical Audit Report

Generated: 2026-04-05T12:00:00Z  
Auditor: Cursor AI (automated codebase audit)

**Scope note:** This audit prioritized reading **primary source and test files** (plugins’ `src/` entrypoints, escrow/payout/rate/notifier actions, intent parsing and simulation utilities, sendflow-agent security/payment/ops modules, HTTP API, tests, env examples, README, Docker, stress script) and using **repository-wide search** for `process.env`, crypto, and control flow. Not every line of every `sendflow-agent/src/utils/*.ts` helper (e.g. gamification, coach, or assistant wrappers) was opened individually; those are summarized from README and architecture where not directly inspected. `sendflow-agent/src/index.ts` was read in multiple large sections and cross-referenced via search, not exhaustively line-by-line.

---

## 1. Executive Summary

SendFlow is a Telegram-first **custodial USDC remittance agent** built on **ElizaOS v2** and **Solana**. It targets people who want to move dollar-stable value without traditional bank UX: users chat with a bot, express intent in natural language (for example sending USDC to a `.sol` name, address, contact, or phone-invite flow), confirm, and see on-chain settlement with links to Solscan. The README positions remittance workers, freelancers, and small businesses as primary audiences, with MoonPay/Transak-style on-ramps and off-ramp links described at the product level.

Across the codebase, the **five workspace plugins** implement the core pipeline: `plugin-intent-parser` (intents, contacts, splits, conditionals, invoices, schedules, pending confirmation flow), `plugin-rate-checker` (rate preview and `CONFIRM_SENDFLOW`), `plugin-usdc-handler` (escrow lock, balance, stats, wallet watch), `plugin-payout-router` (payout from escrow via SPL/Jupiter/Squads paths), and `plugin-notifier` (party notifications and transaction history action). The **sendflow-agent** hosts orchestration in a very large `index.ts`, custodial signing in `custodialWallet.ts`, threat classification in `threatClassifier.ts`, behavioral and PIN step-up logic, file-backed audit/metrics/off-ramp state, HTTP **health/metrics/landing** in `api/health.ts` and `api/landingPage.ts`, and dozens of product utilities (referrals, POS, streams, DAO demo, price alerts, voice, etc.). **Nosana/Qwen** is used for threat classification and (via Eliza) structured intent extraction; **simulation + program allowlists** run before custodial signing.

**Overall security posture: needs work.** Several controls described in README or `.env.example` are **not wired in code** (for example `SCAN_WALLET_BLOCKLIST`). **Large parts of “product state” are in-memory only** (contacts, invoices, transfer history in `txStore`, business profiles, savings vault positions, price alerts), so restarts wipe data and scale is limited. **Default encryption fallback** exists when `WALLET_ENCRYPTION_KEY` is missing or short (`encryption.ts`). **Custodial wallet files** are stored under a path fixed relative to the agent package (`sendflow-agent/data/wallets`), not `SENDFLOW_DATA_DIR`, which is inconsistent with other persistence. **Chainalysis** integration is real when `CHAINALYSIS_API_KEY` is set but returns **stub low risk** when unset (`offrampOracle.ts`). **Swap-mode** simulation verifies amount/program/SOL-drain bounds but **does not enforce a single recipient ATA** the same way as `transfer` mode (`simulationVerify.ts`). Despite gaps, **simulation-backed signing**, **PIN + behavioral step-up**, **threat classifier**, **off-ramp velocity freeze**, **RPC pool + circuit breaker**, and **append-only audit JSONL with checkpoints** are substantive defenses—not purely cosmetic.

---

## 2. Complete Feature Inventory

Status meanings: **complete** = real logic persisting or executing as designed; **partial** = works in demo scope but missing persistence, production hardening, or env; **stub** = placeholder, in-memory only, or returns fixed/low-risk defaults.

### 2.1 Transfer & payment features

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| Natural-language remittance intent (LLM + fallbacks) | `plugin-intent-parser/src/actions/parseRemittanceIntent.ts:242` | partial | `JSON.stringify(userText)` in LLM prompt; validates wallet via `isValidReceiverWallet` after model output |
| Heuristic / non-LLM intent path | `plugin-intent-parser/src/actions/parseRemittanceIntent.ts` (handlers after LLM) | partial | Used when LLM fails or phone path |
| Pending rate + YES/NO confirmation | `plugin-intent-parser/src/pendingFlow.ts` (re-exported `sendflow-agent/src/middleware/confirmationGate.ts:12`) | complete | 60s TTL described in middleware comment |
| Rate check + FX | `plugin-rate-checker/src/actions/checkRemittanceRate.ts` | partial | Depends on runtime settings / providers |
| Escrow lock (sender → escrow ATA) | `plugin-usdc-handler/src/actions/lockUsdcEscrow.ts:71` | complete | `simulateAndVerifyCore` before send; optional fee sponsorship |
| Payout routing (SPL / Jupiter / Squads) | `plugin-payout-router/src/actions/routePayout.ts:35` | complete | Refund path via `releaseEscrow` on failure |
| Custodial user signing + sim verify | `sendflow-agent/src/utils/custodialWallet.ts:198` | complete | `simulateAndVerifyCore` / `simulateAndVerifyVersionedCore` |
| SPL integrity check (legacy API) | `plugin-intent-parser/src/utils/txVerifier.ts:39` | complete | Blockhash + token program transfer opcode 3 |
| Transaction history (plugin action) | `plugin-notifier/src/actions/transactionHistory.ts` | partial | Backed by in-memory `txStore` (see 2.1) |
| Transfer records | `plugin-intent-parser/src/utils/txStore.ts:10` | stub | In-memory `Map`; lost on restart |
| Contacts | `plugin-intent-parser/src/utils/contactBook.ts:1` | stub | In-memory `Map`; lost on restart |
| Invoices | `plugin-intent-parser/src/utils/invoiceStore.ts:13` | stub | In-memory `Map` |
| Payment requests | `plugin-intent-parser/src/utils/paymentRequests.ts` | partial | Not fully audited line-by-line; plugin feature |
| Split payments | `plugin-intent-parser/src/actions/parseSplitIntent.ts` | partial | — |
| Conditional / scheduled transfers | `parseConditionalIntent.ts`, `scheduleTransfer.ts`, `priceMonitor.ts` | partial | — |
| Phone remittance detect | `plugin-intent-parser/src/utils/phoneRemittance.ts:45` | complete | Normalizes phone; excludes .sol / pubkey / sendflow id |
| Phone claim / SMS | `sendflow-agent/src/utils/phoneClaimFlow.ts` | partial | Twilio optional; HMAC paths use env secrets |
| Hosted pay pages | `sendflow-agent/src/utils/paymentPage.ts`, `sendflow-agent/src/api/health.ts:71` | partial | `/pay/:id` |
| Fee sponsorship (first N tx) | `plugin-intent-parser/src/utils/feeSponsorship.ts` (used in `lockUsdcEscrow.ts:166`) | partial | — |
| Rollback / undo window | `sendflow-agent/src/index.ts:4219` | partial | 30s UI; `rollbackManager` / openRollbackWindow |
| Savings vs WU messaging (P13-style) | `sendflow-agent/src/utils/costComparison.ts:36`, `sendflow-agent/src/index.ts:4227` | complete | Called after payout with `formatCompetitorBlock` + localized line |
| Savings vault UX | `sendflow-agent/src/utils/savingsVault.ts:12` | stub | In-memory `vaultStore`; DeFiLlama fetch for APY display only |
| Multi-sig approval flow | `sendflow-agent/src/utils/multiSigApproval.ts` + `index.ts` (approve/reject handlers) | partial | — |
| Stream payments | `sendflow-agent/src/utils/streamPayment.ts`, `index.ts:3835` | partial | Interval from env |
| Micro-loans | `sendflow-agent/src/utils/microLoan.ts` | partial | Demo-oriented |
| Merchant POS | `sendflow-agent/src/utils/merchantPOS.ts` | partial | — |
| Blinks | `sendflow-agent/src/utils/blinksGenerator.ts:1` | partial | Base URL from env |
| DAO treasury demo | `sendflow-agent/src/utils/daoTreasury.ts` | partial | — |
| Token swap helper | `sendflow-agent/src/utils/tokenSwap.ts` | partial | Jupiter integration |

### 2.2 Security & fraud prevention

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| Threat classifier (Nosana/Ollama chat) | `sendflow-agent/src/utils/threatClassifier.ts:140` | partial | 3s timeout; **suspicious** on failure, not hard block |
| Pre-LLM strip | `sendflow-agent/src/utils/threatClassifier.ts:31` | complete | Regex-based |
| Burst skip + soft throttle | `sendflow-agent/src/utils/threatClassifier.ts:115`, `rateLimiter.ts:142` | complete | Second message in 10s → skip LLM |
| Threat gate in agent | `sendflow-agent/src/index.ts:1717` | complete | `block` stops pipeline |
| E2E canary phrase | `sendflow-agent/src/utils/threatClassifier.ts:97` | complete | Test-only |
| Address typosquatting helper | `sendflow-agent/src/utils/addressImpersonation.ts:1` | complete | Single-char edit distance |
| Admin attack demo | `sendflow-agent/src/utils/adminAttackDemo.ts:22` | complete | Classifier + lookalike + velocity |
| Simulation + allowlist | `plugin-intent-parser/src/utils/simulationVerify.ts:315` | complete | Programs + USDC out + recipient ATA in **transfer** mode |
| Versioned tx sim | `simulationVerify.ts:382` | complete | Swap mode skips recipient ATA block at end |
| Replay guard | `plugin-intent-parser/src/utils/txReplayGuard.ts:8` | partial | File under `SENDFLOW_DATA_DIR` |
| PIN (bcrypt file) | `sendflow-agent/src/utils/pinAuth.ts:20` | complete | 6 digits; 3 failures → 10 min block in memory |
| Behavioral profile + anomaly | `sendflow-agent/src/utils/behavioralAuth.ts:94`, `162` | complete | Files under `data/behavior` |
| Step-up (inline / PIN) | `behavioralAuth.ts:259` | complete | score &lt; 30 proceed; ≥60 PIN |
| Fraud heuristics | `sendflow-agent/src/utils/fraudDetection.ts:20` | partial | `KNOWN_SCAM` **never populated**; comment references env not implemented |
| Wallet blocklist from env | README / `sendflow-agent/.env.example:73` | **stub** | **No code reads `SCAN_WALLET_BLOCKLIST`** |
| Rate limits | `sendflow-agent/src/utils/rateLimiter.ts:21` | complete | 20 msg/min, 10 xfer/hour, 5 fails/5m |
| Permanent blocklist file | `rateLimiter.ts:6` | complete | `data/blocklist.json` |
| Account freeze | `behavioralAuth.ts:302` | complete | `data/frozen/` |
| Audit log + checkpoints | `sendflow-agent/src/utils/auditLog.ts:80` | complete | SHA-256 every 100 lines |
| Admin tx security notify | `sendflow-agent/src/utils/txSecurityNotify.ts` | partial | Telegram to admin |

### 2.3 Off-ramp & compliance

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| Tier limits | `sendflow-agent/src/utils/offrampOracle.ts:29` | complete | Env-configurable |
| Velocity freeze (>5 in window) | `offrampOracle.ts:282` | complete | 4h freeze file + admin alert |
| Chainalysis risk API | `offrampOracle.ts:291` | partial | **`{ risk: "low", source: "stub" }` if no API key** |
| Off-ramp audit JSONL | `offrampOracle.ts:346` | complete | — |
| KYC links (Transak/MoonPay) | `offrampOracle.ts` (buildKycLink patterns in tests) | partial | — |

### 2.4 Onboarding & UX

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| Onboarding / welcome | `sendflow-agent/src/utils/onboardingFlow.ts` | partial | File under `SENDFLOW_DATA_DIR` |
| User registry / seen users | `sendflow-agent/src/utils/userRegistry.ts:8` | partial | Data dir |
| Referral rewards | `onboardingFlow.ts:257`, `index.ts:4187` | partial | Needs `DEMO_ESCROW_WALLET_PRIVATE_KEY` for funded path |
| Wizard state | `sendflow-agent/src/utils/wizardState.ts` | partial | — |
| i18n | `sendflow-agent/src/utils/i18n.ts`, `plugin-intent-parser/src/utils/i18n.ts` | partial | — |
| Voice → Whisper | `sendflow-agent/src/utils/voiceHandler.ts:3` | partial | Requires `WHISPER_ENDPOINT` |
| Demo mode | `sendflow-agent/src/utils/demoMode.ts` | partial | Uses `DEMO_*` env |
| Status card PNG | `sendflow-agent/src/utils/statusCard.ts` | partial | — |
| Leaderboard | `sendflow-agent/src/utils/leaderboard.ts` + `data/leaderboard.json` | partial | File exists in repo |

### 2.5 Infrastructure & observability

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| HTTP `/health` | `sendflow-agent/src/api/health.ts:49` | complete | JSON uptime + Solana check |
| HTTP `/metrics` | `health.ts:98` | complete | Prometheus text or JSON |
| HTTP `/`, `/index.html` landing | `health.ts` (landing route), `landingPage.ts:107` | complete | Live metrics fetch in page |
| HTTP `/og-image.png` | `health.ts` + `sendflow-agent/scripts/generateOgImage.ts` | complete | Static PNG |
| HTTP `/webapp` | `health.ts:129` | partial | Serves `sendflow-webapp/index.html` if present |
| Metrics state persistence | `sendflow-agent/src/utils/metricsState.ts:5` | complete | `SENDFLOW_DATA_DIR` or `cwd/data` |
| Structured logging | `sendflow-agent/src/utils/structuredLogger.ts` | complete | — |
| RPC pool + quorum/circuit | `sendflow-agent/src/utils/rpcManager.ts:34` | complete | Up to 3 URLs from env + fallback |
| Startup self-test | `sendflow-agent/src/utils/startupSelfTest.ts:62` | partial | Skips LLM check if no endpoint |
| Degraded mode | `sendflow-agent/src/utils/degradedMode.ts` | partial | — |
| Docker image | `Dockerfile:1` | complete | Bun 1.2-alpine, builds plugins, `CMD` agent |
| docker-compose | `docker-compose.yml:1` | complete | Port 3000, `env_file: .env` |

### 2.6 Demo & admin tooling

| Feature | Location (file:line) | Status | Notes |
|--------|------------------------|--------|-------|
| `/admin` commands | `sendflow-agent/src/index.ts:2054` | complete | Requires `chatId === ADMIN_TELEGRAM_ID` |
| `/admin attack` | `index.ts:2116`, `adminAttackDemo.ts` | complete | |
| `/admin demo` | Referenced `README.md:235`, `DEMO_SCRIPT.md:27` | partial | Wired through `demoMode` / index (not every line re-read) |
| Stress test harness | `scripts/stress-test.ts:35` | complete | Classifier latency; clears LLM endpoint by default |
| E2E inject hook | `sendflow-agent/tests/e2e/fullFlow.test.ts:78` | partial | **Skipped** without `TEST_DEVNET_WALLET_PRIVATE_KEY` |
| OG image generator | `sendflow-agent/scripts/generateOgImage.ts` | complete | `bun run gen:og` in agent package |

---

## 3. How to Run SendFlow (complete operator guide)

### 3.1 Prerequisites

| Tool | Version / source |
|------|------------------|
| **Bun** | Root `package.json` → `"packageManager": "bun@1.2.11"`; `engines.bun` → `>=1.0.0` |
| **Docker** | `README.md:31` — for image and `docker compose` |
| **Nosana CLI** | `README.md:32` — optional |
| **TypeScript** | `sendflow-agent/package.json` → `typescript` `^5.8.3` (devDependency) |
| **Solana keys / USDC** | `README.md:33` — funded wallet for custodial/escrow paths |

### 3.2 Local setup (step by step)

From **repository root** (`README.md:37`):

```bash
bun install
bun run build
bun run test
cp .env.example .env   # fill secrets
bun run sendflow-agent/src/index.ts
```

From **`sendflow-agent/`** (`sendflow-agent/package.json:11`):

```bash
cp .env.example .env
bun run start
```

where `start` is exactly:

```bash
bun --env-file=../../.env --env-file=.env run src/index.ts
```

Root `build` (`package.json:16`) runs filtered builds for all plugins then sendflow-agent. Root `test` runs `bun run --filter '*' test`.

### 3.3 Environment variables — complete reference

Sources: `sendflow-agent/.env.example`, `.env.example` (root), and `process.env` references under `sendflow-agent/` and `plugin-intent-parser/src` (grep). **Default** = value used in code when unset (if any). **UNDOCUMENTED** = used in code/tests but missing from `sendflow-agent/.env.example`.

| Variable | Required / Optional | Default (if any) | What breaks if missing |
|----------|---------------------|------------------|-------------------------|
| `TELEGRAM_BOT_TOKEN` | Required for live bot | — | No Telegram API |
| `ADMIN_TELEGRAM_ID` | Optional | — | No admin alerts / `/admin` gate won’t match |
| `SOLANA_RPC_URL` | Optional | `https://api.mainnet-beta.solana.com` in several plugins | Uses public RPC; may rate-limit |
| `RPC_POOL` | Optional | Falls back Helius/Quicknode/SOLANA_RPC | Single-RPC behavior |
| `HELIUS_RPC_URL` | Optional | — | Pool has one fewer URL |
| `QUICKNODE_RPC_URL` | Optional | — | Pool has one fewer URL |
| `SOLANA_ESCROW_WALLET_PRIVATE_KEY` | Required for lock/payout | — | `LOCK_USDC_ESCROW` / `ROUTE_PAYOUT` fail |
| `SENDER_WALLET_PRIVATE_KEY` | Required for lock + refund paths | — | Lock/refund failures |
| `USDC_MINT` | Optional | Mainnet USDC mint constant in code | Wrong token on non-mainnet |
| `JUPITER_API_URL` | Optional | `https://quote-api.jup.ag/v6` | Swap quotes fail |
| `JUPITER_PRICE_API_URL` | In root `.env.example` | — | Price features degrade |
| `JUPITER_PROGRAM_ID` | Optional | Default Jupiter v6 program in code | Allowlist may miss custom deployment |
| `PYTH_*` | Optional | — | Pyth leg skipped if feeds unset |
| `SQUADS_PROGRAM_ID` | Optional | Default in `.env.example` | Squads path integration |
| `NOSANA_LLM_ENDPOINT` | Optional | — | Threat classifier returns **suspicious**; intent LLM may fail |
| `NOSANA_API_KEY` | Optional | — | Nosana calls without Bearer |
| `ELIZA_MODEL` | Optional | `qwen3.5:9b` | Wrong/missing model on host |
| `MIN_TRANSFER_USDC` | In `.env.example` | `0.1` in example | Error copy uses env or `0.1` |
| `MAX_TRANSFER_USDC` | In `.env.example` | `10000` / fraud uses `100` if unset in one path | `errorRecovery.ts` vs `index.ts` mismatch possible |
| `WALLET_ENCRYPTION_KEY` | **Strongly required** | If &lt; 32 chars: **`sendflow_dev_master_key_change_in_production`** (`encryption.ts:11`) | **Weak/default master key** |
| `PORT` | Optional | `3000` | Health server port |
| `WEBAPP_PUBLIC_URL` | Optional | — | WebApp button / payment base URLs fallback localhost |
| `PUBLIC_BASE_URL` | Optional | — | Same family as WEBAPP |
| `SENDFLOW_BASE_URL` | Optional | `https://sendflow.app` in `blinksGenerator.ts` | Wrong blink host |
| `WHISPER_ENDPOINT` | Optional | — | Voice returns null (`voiceHandler.ts:5`) |
| `MOONPAY_URL` | In `.env.example` (duplicated twice) | — | On-ramp links |
| `TWILIO_*` | Optional | — | SMS invites disabled |
| `BIRDEYE_API_KEY` | Optional | — | Trending tokens |
| `DEFI_LLAMA_URL` | Optional | `https://yields.llama.fi/pools` in example | Savings APY fetch fails → fallback APY |
| `DAILY_DIGEST_ENABLED` | Optional | — | Digest behavior |
| `SPONSOR_WALLET_PRIVATE_KEY` | Optional | — | README: reserved |
| `WEEKLY_REPORT_*` | Optional | — | Scheduled reports |
| `LOAN_*` | Optional | — | Loan caps |
| `STREAM_SETTLEMENT_INTERVAL_MS` | Optional | `300000` | Stream tick |
| `POS_INVOICE_EXPIRY_MS` | Optional | `600000` | POS |
| `OFFRAMP_TIER*_LIMIT` | Optional | 100/500/2000 | Tier math |
| `TRANSAK_API_KEY` | Optional | — | KYC link generation paths |
| `CHAINALYSIS_API_KEY` | Optional | — | **Stub low risk** when empty |
| `DEMO_ESCROW_WALLET_PRIVATE_KEY` | Optional | — | Referral/demo funding |
| `DEMO_RECIPIENT_WALLET` | Optional | Hardcoded placeholder in `demoMode.ts:21` | Demo recipient |
| `TELEGRAM_BOT_USERNAME` | Optional | `SendFlowSol_bot` | Deep links |
| `REFERRAL_REWARD_USDC` | Optional | `0.1` | Referral amount |
| `MINT_RECEIPTS` | Optional | `false` | No memo receipt mint |
| `SENDFLOW_DATA_DIR` | Optional | `process.cwd()/data` | Mixed: many modules use this; **wallets do not** |
| `SENDFLOW_ESTIMATE_FEE_LAMPORTS` | Optional | `5000` | Landing fee column |
| `SCAN_WALLET_BLOCKLIST` | Documented only | — | **Not read by code** |
| `VIRTUAL_CARD_PROVIDER` | Optional | `stub` | `virtualCard.ts:54` |
| **UNDOCUMENTED** `NODE_ENV` | Tests / E2E | — | E2E path in `index.ts:661` |
| **UNDOCUMENTED** `SENDFLOW_E2E` | E2E | — | Enables inject + canary |
| **UNDOCUMENTED** `TEST_DEVNET_WALLET_PRIVATE_KEY` | E2E | — | Suite skip if unset |
| **UNDOCUMENTED** `E2E_PORT` | E2E | — | Port override |
| **UNDOCUMENTED** `STRESS_USE_LLM` | stress-test | — | Live LLM in stress |
| **UNDOCUMENTED** `GITHUB_URL` | landing | — | Optional link |
| **UNDOCUMENTED** `HACKATHON_NAME` | landing | — | Footer |
| **UNDOCUMENTED** `SENDFLOW_ESCROW_ADDRESS` / `ESCROW_WALLET_PUBLIC_KEY` | landing | — | Solscan footer |
| **UNDOCUMENTED** `SOL_PRICE_USD`, `SENDFLOW_WU_RATE`, `WU_RATE`, `SENDFLOW_MG_RATE`, `MG_RATE` | `plugin-intent-parser/src/utils/savingsEngine.ts` | — | Savings messaging |

### 3.4 Running tests

| Command | Where | Expected |
|---------|--------|----------|
| `bun run test` | Repo root | Runs `--filter '*'` tests across workspaces |
| `bun test` | `sendflow-agent/` | Unit + integration tests in `src/__tests__`, `tests/e2e` |
| `bun run test:e2e` | `sendflow-agent/package.json:10` | `bun test tests/e2e/fullFlow.test.ts` — **skipped** unless devnet wallet env set |
| `bun run build` | `sendflow-agent/` | `tsc --noEmit` |

Failures: read assertion message; E2E skip is **not** a pass for “live devnet proof.” Observability tests may log RPC errors by design.

### 3.5 Running the demo

1. Configure `.env` per `sendflow-agent/.env.example` with **live** `TELEGRAM_BOT_TOKEN`, Solana keys, and optional Nosana URL.  
2. Start: `cd sendflow-agent && bun run start`.  
3. Open Telegram bot (`TELEGRAM_BOT_USERNAME`).  
4. **User flow** (from `DEMO_SCRIPT.md`): e.g. `Send 1 USDC to raj.sol` → confirm → optional split / stake / `My card` / voice / leaderboard.  
5. **Admin attack sequence**: set `ADMIN_TELEGRAM_ID` to your numeric Telegram user id. Message `/admin attack` from that chat. Expected (`adminAttackDemo.ts`): three steps—(1) classifier result on urgency message, (2) typosquatting demo vs `DEMO_RECIPIENT_WALLET`, (3) velocity freeze after 6 attempts. If velocity already frozen, message notes clearing `data/offramp-velocity` (paraphrased from code).

### 3.6 Deploying on Nosana

From `README.md:56`:

```bash
docker build -t yourname/sendflow:latest .
docker push yourname/sendflow:latest
nosana job post --image yourname/sendflow:latest --market <MARKET_ADDRESS> --wait
```

`Dockerfile` exposes **3000**, runs `bun run src/index.ts` from `sendflow-agent`. Use the same env vars as production; **no Nosana-specific env vars** appear beyond generic `NOSANA_LLM_ENDPOINT` / `NOSANA_API_KEY` already in `.env.example`.

---

## 4. Security Architecture

### 4.1 The 7 security layers

Aligned with `README.md:343` ordering; implementation notes from code.

1. **AI classifier (Nosana / Qwen)** — `sendflow-agent/src/utils/threatClassifier.ts`, invoked `sendflow-agent/src/index.ts:1717`. Strips known injection patterns, sends **truncated** user text (8k) inside JSON chat payload. **Defeats** obvious social-engineering / injection at message boundary. **Partial**: on outage → **suspicious** not **block**; burst path skips LLM.  
2. **Zero-trust custodial wallet** — `sendflow-agent/src/utils/encryption.ts`, `custodialWallet.ts`. Per-user **AES-256-GCM** (v3) with **PBKDF2 100k** over HMAC material; legacy CBC migration. **Defeats** casual disk theft if master key strong. **Partial**: default master string if env weak/missing; wallets path **ignores** `SENDFLOW_DATA_DIR`.  
3. **Transaction simulation** — `plugin-intent-parser/src/utils/simulationVerify.ts`. RPC `simulateTransaction` with inner ix; checks program allowlist, USDC out totals vs intent (slippage), SOL system transfer cap, recipient ATA in transfer mode. **Defeats** malicious extra programs / wrong recipient for simple transfers. **Partial**: swap mode less strict on final recipient ATA.  
4. **Behavioral auth** — `sendflow-agent/src/utils/behavioralAuth.ts`. Profiles on disk; anomaly score drives inline confirm or PIN (`stepUpIfNeededWithKeyboard`). **Defeats** some ATO / anomalous patterns. **Complete** for file-backed profile.  
5. **Off-ramp KYC oracle** — `offrampOracle.ts`. Tiers, cooling, velocity freeze, optional Chainalysis. **Defeats** rapid retry abuse. **Partial** when Chainalysis key absent (**stub low**).  
6. **RPC quorum & circuit breaker** — `rpcManager.ts`. Pool URLs, health, write quorum, circuit open after consecutive failures. **Defeats** single bad RPC for some operations.  
7. **Immutable audit log** — `auditLog.ts`. JSONL + rolling SHA-256 checkpoint. **Defeats** silent single-line tamper (within checkpoint window assumptions).

### 4.2 Cryptography inventory

| Location | Algorithm | Key size / params | Purpose | Assessment |
|----------|-----------|-------------------|---------|------------|
| `encryption.ts:30` | PBKDF2-HMAC-SHA256 | 100k iters, 256-bit key | Derive per-user AES key | **Strong** (if master secret strong) |
| `encryption.ts:60` | AES-256-GCM | 256-bit key, random 128-bit IV | Encrypt seed | **Strong** |
| `encryption.ts:104` | AES-256-CBC | Legacy v1 | Migration only | **Adequate** for legacy migration only |
| `encryption.ts:114` | HMAC-SHA256 | Master key | Wallet MAC | **Strong** |
| `auditLog.ts:43` | SHA-256 | — | Checkpoint hash | **Adequate** (integrity marker, not password hashing) |
| `pinAuth.ts:22` | bcrypt | cost `10` | PIN storage | **Adequate** |
| `rpcManager.ts:10` | SHA-256 (createHash) | — | Internal hashing | **Adequate** |
| `phoneClaimFlow.ts` | HMAC (see file) | Uses `SOLANA_ESCROW...` as secret | Claim tokens | **Adequate** if secret is high-entropy key |

**No MD5 / SHA1 / ECB** found in audited crypto paths. **Static IV**: only legacy CBC path uses per-file IV from ciphertext (not a single global IV). **Hardcoded keys**: `getMasterKey()` returns a **fixed development string** when `WALLET_ENCRYPTION_KEY` is unset or too short — **flag as HIGH risk** for any non-dev deployment.

### 4.3 Key management

- **Generation**: `custodialWallet.ts:108` `Keypair.generate()` for new users.  
- **Encryption**: `secretKeyToWallet` → `encryptPrivateKey` (v3).  
- **Storage**: JSON files under `sendflow-agent/data/wallets/{safeUserId}.json` with `encryptedPrivateKey` + `mac`.  
- **Access**: Decrypt only inside `withInternalKeypair` / signing functions; buffers zeroized.  
- **Blast radius if `WALLET_ENCRYPTION_KEY` leaks**: Attacker decrypts **all** custodial wallets encrypted with that master key.  
- **Corrupted wallet file**: `migrateWalletIfNeeded` / load may fail; user cannot sign; logs warn.

### 4.4 Input validation & injection surface

| Input | Where | Sanitization |
|-------|--------|--------------|
| Telegram text | → threat strip → intent LLM / heuristics | Strip regex; LLM still sees `JSON.stringify(userText)` (`parseRemittanceIntent.ts:254`) |
| Phone | `phoneRemittance.ts:24` normalize | Digit normalization; length checks |
| Solana address | `solanaAddress.ts:4` | `PublicKey` parse |
| Amounts | Various `Number()`, `BigInt(Math.round(amount*1e6))` | Float rounding risk for very small amounts; not full decimal library |
| Shell / file path from user | — | **None found** in audited paths for user-controlled paths |
| Webhook URL (business) | `businessMode.ts:43` `setWebhook` | **No SSRF validation**; stored string used in `fetch` |

**Flag**: Unsanitized user text in **LLM intent prompt** and **classifier** — prompt-injection is mitigated by strip + schema validation + on-chain sim, not eliminated.

### 4.5 Authentication & authorization

- **Telegram user identity**: Eliza/`entityId` and `metadata.telegram.chat.id` drive actions; **trust model = Telegram authenticated the user to the bot**.  
- **Cross-user actions**: Pending flow keys include `roomId` + `entityId` (`confirmationGate` / pendingFlow); approver flows match `entityId` on reject/approve paths in `index.ts` (partial read). **Residual risk**: any bug mapping `entityId` ↔ wallet would be critical—audit did not prove full absence.  
- **PIN**: `pinAuth.ts`; stored bcrypt; 3 failures → 10 min lock (`recordPinFailure`).  
- **Admin**: `index.ts:2054` `String(chatId) === process.env.ADMIN_TELEGRAM_ID` for `/admin*` slash commands.

### 4.6 On-chain transaction security

- **Before `signTransaction`**: `custodialWallet.ts:205` runs `simulateAndVerifyCore` **after** partial sign.  
- **`simulateAndVerify`**: See §4.1; ensures simulation succeeds, programs allowed, USDC debited from user ATA ≤ intent × slip, transfer mode recipient ATA matches.  
- **Allowlist**: `buildAllowedPrograms` adds Jupiter program id from env (`simulationVerify.ts:50`).  
- **Drain more than intended**: Transfer mode checks aggregate USDC out and recipient; swap mode does not pin single recipient the same way—**jupiter path relies on broader simulation + program set**.

### 4.7 Known vulnerabilities & open issues

| Severity | Description | Location | Exploit scenario | Recommended fix |
|----------|-------------|----------|------------------|-----------------|
| **HIGH** | Default master encryption key if `WALLET_ENCRYPTION_KEY` missing/short | `encryption.ts:10` | Deploy without env; attacker with disk reads wallets | Refuse startup without 32+ char key |
| **HIGH** | `SCAN_WALLET_BLOCKLIST` documented but not implemented | `fraudDetection.ts:11`, `.env.example:73` | Operator thinks addresses blocked | Parse env into `KNOWN_SCAM` or remove doc |
| **MEDIUM** | Custodial wallet path ignores `SENDFLOW_DATA_DIR` | `custodialWallet.ts:33` | Backup/migration confusion; wallets not colocated | Use same `dataRoot()` as other modules |
| **MEDIUM** | In-memory contacts / invoices / tx history | `contactBook.ts`, `invoiceStore.ts`, `txStore.ts` | Restart = data loss; CSV export incomplete | Persist to disk/DB |
| **MEDIUM** | Business webhook `fetch(url)` without URL policy | `businessMode.ts:48` | User sets `http://169.254.169.254` style URL | Allowlist schemes/hosts or disable |
| **MEDIUM** | `MAX_TRANSFER_USDC` default mismatch (`100` vs `10000`) | `index.ts:1141` vs `errorRecovery.ts:7` | Confusing limits | Single source of truth |
| **LOW** | Chainalysis stub always “low” without key | `offrampOracle.ts:291` | Misunderstanding of risk coverage | Document “no API key = no chain risk” |

**None found** (in this pass): hardcoded production Telegram tokens in source files.

---

## 5. How to Use SendFlow — End User Guide

### 5.1 Getting started (first-time user)

Open the bot on Telegram (`README.md:19`). The agent creates a custodial wallet (`custodialWallet.ts:104`) and onboarding flows may run (`onboardingFlow.ts`). Fund USDC per bot instructions (on-ramp links are product-level; exact copy depends on handler).

### 5.2 Sending money

Examples from `README.md:119` (abbreviated):  
- `Send 10 USDC to raj.sol`  
- `Send 50 USDC to Mom` (contact)  
- `Send 0.5 SOL to raj.sol` (multi-token; registry in plugin)  
- `Split 90 USDC equally between ...`  
- `Repeat last transfer` / `Send again to Mom`

Flow: parse intent → rate check → user confirms YES / PIN if required → lock escrow → payout → notify.

### 5.3 Receiving money

Receiver notifications via notifier action; phone claim flow for invite-style receive (`phoneClaimFlow.ts`).

### 5.4 Invoices & pay links

`Create invoice for …` (`README.md:142`); pay links `Create my pay link` (`README.md:167`); hosted pages `/pay/:pageId` (`health.ts`).

### 5.5 Savings vault

`Save 50 USDC` / `Withdraw my savings` / `How much am I earning?` — **note**: `savingsVault.ts` stores positions in memory only (demo).

### 5.6 Price alerts & market data

`Alert me when SOL hits $200` etc.; `priceAlerts.ts` uses Jupiter price API v2; **in-memory** store, 30s polling in same file (not fully re-read).

### 5.7 Business & POS mode

`Enable business mode`, `Export CSV`, `Set webhook https://...` (`README.md:188`); POS commands (`README.md:219`).

### 5.8 Security features (PIN, freeze, backup)

- `/setpin 123456` — `index.ts:1973`, `pinAuth.ts:20`  
- `/freeze`, `/unfreeze` — `index.ts:1606`  
- Backup / export — messages reference PIN (`index.ts:3775`)

### 5.9 All commands — complete reference table

The README “SendFlow Commands” section (`README.md:117`–`239`) is the most complete catalog the repo provides. Slash / special commands verified in code include:

| Command / example | What it does | Notes |
|-------------------|--------------|--------|
| `/setpin NNNNNN` | Stores bcrypt PIN | `index.ts:1973` |
| `/freeze` | Writes frozen file | `behavioralAuth.ts:311` |
| `/unfreeze` | Removes frozen file | `index.ts:1617` |
| `/admin`, `/admin status`, `/admin stats`, `/admin metrics`, `/admin cohort`, `/admin queue`, `/admin block <id>`, `/admin unblock <id>`, `/admin errors`, `/admin attack` | Operator controls | `index.ts:2054` |
| `YES` / `NO` / `CONFIRM` | Confirmation flow | Wrapped `confirmSendflowAction` `index.ts:985` |
| Natural-language phrases | Parsed by actions | README table |

---

## 6. Scaling Analysis

### 6.1 Current throughput ceiling

- **Messages**: `rateLimiter.ts:22` — **20 / 60s** per user → ~0.33 msg/s per user (burst limited).  
- **Transfers**: **10 / hour** per user.  
- **Classifier**: burst skip reduces LLM load; 3s timeout per call when enabled.  
**Bottleneck order (typical)**: (1) **Telegram** delivery and sequential chat handling, (2) **Nosana/LLM** when enabled, (3) **Solana RPC** on simulation + send, (4) **file I/O** for audit/metrics/behavior.

### 6.2 File-based storage — the core scaling problem

| `data/` path (pattern) | Stores | Read/write | Problem at scale |
|-------------------------|--------|------------|------------------|
| `data/audit/*.jsonl` | Audit lines | Append heavy | Disk I/O; single writer queue |
| `data/metrics-state.json` | Metrics | Periodic write | Contention |
| `data/behavior/*.json` | Behavioral profiles | Per message | Many small files |
| `data/frozen/*.json` | Freeze flags | Rare | — |
| `data/blocklist.json` | User ids | Rare | — |
| `data/offramp-*` (from oracle) | Velocity, freeze | Per attempt | Many files |
| `sendflow-agent/data/wallets/*.json` | Custodial ciphertext | Per user sign | **Thousands of files**; backup/locking |
| `data/wallets` vs `SENDFLOW_DATA_DIR` | **Split brain** | Wallets not under unified root | Ops error |

**Single biggest risk**: file-backed state + **in-memory** stores (contacts, invoices, tx history) **do not cluster**; horizontal scaling requires external DB and sticky sessions or stateless redesign.

### 6.3 Scaling roadmap — 3 tiers

#### Tier 1: 0 → 1,000 users (no infra changes)

- **Breaks first**: public RPC rate limits, LLM latency, single-process CPU.  
- **Actions**: Dedicated Helius/Quicknode URLs in `RPC_POOL`; monitor `metrics`; run stress harness; ensure `WALLET_ENCRYPTION_KEY` production-grade.  
- **Effort**: ~2–5 days ops + tuning.

#### Tier 2: 1,000 → 50,000 users

- **Breaks**: file I/O, Telegram long-polling throughput, JSONL audit size.  
- **Replace**: Postgres for users, wallets (encrypted blob + KMS pointer), transfer history, contacts, invoices; Redis for rate limits and classifier throttle; S3/GCS for audit archive.  
- **Effort**: ~4–8 weeks engineering.

#### Tier 3: 50,000+ users

- **Breaks**: monolithic agent, custodial key handling compliance, RPC global fanout.  
- **Replace**: queue-based workers, HSM/KMS, dedicated Solana senders, multi-region RPC, read replicas.  
- **Effort**: multi-quarter.

### 6.4 Solana RPC scaling

Default pool: up to **three** URLs (`rpcManager.ts:47`). At 1,000 concurrent users polling balance, effective QPS = users × polls/sec ÷ cache hit rate — **will overwhelm shared free RPC**. **Recommendation**: paid dedicated endpoints + `RPC_POOL` + consider sender-specific connection pooling; light client not applicable for full tx simulation.

### 6.5 LLM classifier latency at scale

At **10,000 messages/minute**, Nosana endpoint + 3s timeout → massive queue unless **sharded workers**. **Recommendations**: rules-first fast path for obvious safe messages; cache per-user recent classification; async classification only where safe (not implemented today).

---

## 7. How to Make It More Secure — Prioritized Roadmap

### 7.1 P0 — Must fix before demo

| Item | Effort | Implementation |
|------|--------|----------------|
| Remove default `WALLET_ENCRYPTION_KEY` fallback in prod builds | 2h | `process.exit(1)` in `getMasterKey()` when key &lt; 32 chars if `NODE_ENV=production` |
| Document or implement `SCAN_WALLET_BLOCKLIST` | 2–4h | Split: implement `process.env.SCAN_WALLET_BLOCKLIST.split(",")` into `fraudDetection` **or** remove from README/.env.example |

### 7.2 P1 — This week

| Item | Effort | Implementation |
|------|--------|----------------|
| Webhook SSRF guard | 4h | In `setWebhook`, reject non-https, block private IP ranges, use `URL` parse |
| Align `MAX_TRANSFER_USDC` defaults | 1h | One module exports constant |
| Unify data root for wallets | 4h | Replace `WALLET_DIR` hardcode with `SENDFLOW_DATA_DIR`-aware path |

### 7.3 P2 — Before real users

| Item | Effort | Implementation |
|------|--------|----------------|
| Redis rate limits | 2–3d | Replace `Map` in `rateLimiter.ts` with Redis INCR + TTL |
| KMS / cloud HSM for master key | 1–2w | Store data key wrapped by KMS; no plaintext master in env |
| Chainalysis / TRM production | 1w | Require API key for mainnet off-ramp; fail closed or manual review |
| MPC / non-custodial path | multi-sprint | External wallet connect; reduce custodial scope |
| Telegram webhook mode + secret | 2–3d | Validate `X-Telegram-Bot-Api-Secret-Token` if using webhooks |
| Dependency CVE process | ongoing | Add `npm audit` / OSV in CI (Bun has no `bun audit` script in this repo) |

### 7.4 P3 — Long-term hardening

- Formal threat model + pen test on custodial path.  
- Separate signing service with minimal attack surface.  
- Anomaly detection on RPC error metrics (`metricsState`).

---

## 8. Dependency & Supply Chain Audit

### Production dependencies (direct)

| Package | Version | Workspace |
|---------|---------|-----------|
| `@elizaos/core` | `2.0.0-alpha.77` | agent + all plugins |
| `@elizaos/plugin-telegram` | `2.0.0-alpha.11` | sendflow-agent |
| `@solana/web3.js` | `^1.98.4` (agent); `^0.4.13`/`^0.4.14` spl-token pair in plugins) | — |
| `bcryptjs` | `^3.0.3` | sendflow-agent |
| `bs58` | `^6.0.0` | several |
| `canvas` | `^3.2.3` | sendflow-agent (OG image) |
| `qrcode` | `^1.5.4` | sendflow-agent |
| `telegraf` | `4.16.3` | sendflow-agent |
| `@bonfida/spl-name-service` | `^3.0.20` | plugin-intent-parser |
| Workspace plugins | `workspace:*` | internal |

**Flags**

- **ElizaOS 2.0.0-alpha.77**: pre-release stability/API risk.  
- **@solana/spl-token** patch mismatch (`^0.4.13` vs `^0.4.14`) across packages — reconcile.  
- **`bun audit`**: not defined in root `package.json`; attempted `bun audit` returns **“Script not found”** — **no automated CVE report from this audit run.**  
- **Lockfile**: **`bun.lock`** present at repo root (committed per listing).  
- **FS + network**: many packages (`@solana/web3.js`, `telegraf`, `canvas`) legitimately use both — treat as standard supply-chain risk; pin versions and run OSV.

---

## 9. Hackathon Readiness Checklist

| Item | Status | Evidence / FIX |
|------|--------|----------------|
| Bot live on Telegram | Unknown (ops) | Deploy with token; **FIX**: run `bun run start` with valid `TELEGRAM_BOT_TOKEN` |
| First message onboarding | Partial | `onboardingFlow.ts` exists; **FIX**: verify with new Telegram account |
| Transfer E2E devnet/mainnet | Partial | E2E **skipped** without `TEST_DEVNET_WALLET_PRIVATE_KEY` (`fullFlow.test.ts:22`) |
| Savings comparison after transfer | **Yes (code path)** | `index.ts:4227` calls `recordTransferSavings` + competitor block |
| `/admin attack` works | **Yes (code path)** | `index.ts:2116` + `adminAttackDemo.ts` |
| Landing + real metrics | **Yes** | `health.ts`, `landingPage.ts`, `metricsState.ts` |
| `bun run test:e2e` passes | **N/A / skip** | Suite skip without wallet — **FIX**: set `TEST_DEVNET_WALLET_PRIVATE_KEY` and funded devnet USDC |
| `bun run stress-test` passes | Unknown | **FIX**: run `bun run stress-test` from root; ensure thresholds in `scripts/stress-test.ts:14` |
| Seven security layers active | Partial | Chainalysis stub; in-memory data — see §4.1 |
| Off-ramp KYC &gt; $300 | Partial | Oracle tiers exist; full KYC UX not audited end-to-end |
| Phone claim E2E | Partial | Tests in `phoneClaimFlow.test.ts` mock Twilio |
| README security architecture | **Yes** | `README.md:341` |
| OG image | **Yes** | `sendflow-agent/src/api/static/og-image.png` + `gen:og` |
| No hardcoded secrets in committed **source** | **Mostly** | `.env` appears in local tree — **ensure not committed** (`.gitignore:9` excludes `.env`) |
| `.env.example` covers all env vars | **No** | Several **UNDOCUMENTED** vars in §3.3 — **FIX**: extend `sendflow-agent/.env.example` |

---

## 10. Appendix

### A. File tree

The following listing was generated with `find` **excluding** `node_modules` and `.git` (2026-04-05). **Note:** Local `.env` files may exist on disk but must not be committed.

```
.dockerignore
.env.example
.gitignore
DEMO_SCRIPT.md
Dockerfile
README.md
SUBMISSION.md
TWEET.md
bun.lock
data/metrics-state.json
docker-compose.yml
package.json
plugin-intent-parser/...
plugin-notifier/...
plugin-payout-router/...
plugin-rate-checker/...
plugin-usdc-handler/...
scripts/stress-test.ts
sendflow-agent/...
sendflow-webapp/index.html
```

(Full sorted path list is identical to the `find` output captured during audit—**~200+ paths** including `plugin-*/dist/*` and test fixtures.)

### B. Test coverage summary

| File | Focus | Approximate cases | Gaps |
|------|--------|-------------------|------|
| `sendflow-agent/src/__tests__/landingPage.test.ts` | Landing HTTP + metrics parse | 4 | No browser E2E |
| `observability.test.ts` | Audit hash, metrics text, alerter, self-test | several | — |
| `encryptionWallet.test.ts` | Encrypt/decrypt/MAC | few | — |
| `threatClassifier.test.ts` | Classifier paths | few | — |
| `behavioralAuth.test.ts` | Anomaly scoring | several | — |
| `offrampOracle.test.ts` | Tiers, velocity, Chainalysis mock | several | — |
| `rpcManager.test.ts` | Quorum, slippage, circuit | several | — |
| `txSimulator.test.ts` | Replay guard | few | — |
| `phoneClaimFlow.test.ts` | Claims, rate limit | several | Live Twilio |
| `onboardingFlow.test.ts` | Welcome paths | few | — |
| `integration.test.ts` | Many product stubs | many | Not full chain |
| `plugin-* / __tests__` | Per plugin | varies | — |
| `tests/e2e/fullFlow.test.ts` | Full security flow | **skipped** without devnet key | Needs env + funds |

### C. API surface

**HTTP** (`health.ts`): `GET /health`, `GET /metrics` (optional `?format=json`), `GET /`, `GET /index.html`, `GET /og-image.png`, `GET /webapp`, `GET /pay/:pageId`, `GET /api/balance`.

**Telegram**: All Eliza actions/plugins plus custom handlers in `index.ts` (freeze, setpin, admin, approve/reject multisig, voice, callbacks—full enumeration requires reading remaining `index.ts` branches).

### D. Data flow diagram (ASCII)

```
User (Telegram client)
        │
        ▼
Telegram Bot API  ◄──────────────────────────────┐
        │                                         │
        ▼                                         │
@elizaos/plugin-telegram + SendFlow agent        │
(sendflow-agent/src/index.ts)                     │
        │                                         │
        ├──► threatClassifier (Nosana/Ollama)    │
        │          │                              │
        │          ▼                              │
        ├──► rateLimiter / freeze / fraud        │
        │          │                              │
        │          ▼                              │
        ├──► PARSE_REMITTANCE_INTENT (LLM/heur.)  │
        │          │                              │
        │          ▼                              │
        ├──► CHECK_REMITTANCE_RATE                │
        │          │                              │
        │          ▼                              │
        ├──► CONFIRM_SENDFLOW (YES/PIN)           │
        │          │                              │
        │          ▼                              │
        ├──► LOCK_USDC_ESCROW (sender→escrow)     │
        │          │ simulateAndVerifyCore       │
        │          ▼                              │
        ├──► ROUTE_PAYOUT (escrow→recipient)     │
        │          │ Solana RPC                   │
        │          ▼                              │
        ├──► NOTIFY_PARTIES                       │
        │          │                              │
        │          └──────────────────────────────┘
        ▼
Solana validators (USDC SPL / Jupiter CPIs)
```

---

*End of report.*
