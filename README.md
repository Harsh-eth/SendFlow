# SendFlow — Send Money Anywhere. Just Ask.

> Built for the [Nosana Builders Challenge: ElizaOS](https://earn.superteam.fun/listings/sendflow-nosana)

[![Demo Video](https://img.shields.io/badge/Demo-Watch%20Now-red)](YOUR_VIDEO_LINK)
[![Live Bot](https://img.shields.io/badge/Telegram-@SendFlowSol__bot-blue)](https://t.me/SendFlowSol_bot)
[![Nosana](https://img.shields.io/badge/Powered%20by-Nosana%20GPU-green)](https://nosana.com)
[![Solana](https://img.shields.io/badge/Built%20on-Solana-purple)](https://solana.com)

## The Problem

500 million migrant workers pay $40 billion in fees every year just to send money home.
Western Union charges 5%. PayPal freezes accounts. Bank wires take 5 days.
Setting up a crypto wallet requires seed phrases most people don't understand.

## The Solution

Open Telegram. Type "Send $50 to Mom". Done in 2 seconds. Fee: $0.05.

SendFlow is an AI agent that makes sending USDC on Solana as simple as sending a text message.
**No wallet setup. No seed phrases. No bank account needed.**

## Quick Start

1. Open [@SendFlowSol_bot](https://t.me/SendFlowSol_bot) on Telegram
2. SendFlow creates your wallet instantly
3. Add USDC via the **P2P marketplace** (or a friend / exchange)
4. Type what you want to do

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Agent Framework | ElizaOS v2 |
| LLM | Qwen 3.5 9B on Nosana GPU |
| Blockchain | Solana mainnet |
| Swaps | Jupiter v6 |
| Price feeds | Pyth Network |
| Compute | Nosana decentralized GPU |
| Interface | Telegram Bot API |

## Who it's for

- **Remittance workers** — send home without a traditional bank maze.
- **Freelancers** — **invoices**, **payment links**, and **hosted `/pay/:pageId` pages** so clients pay without a separate wallet app.
- **Small businesses** — **POS** mode and QR instead of expensive card hardware.

## How it works

1. Open `@SendFlowSol_bot` on Telegram.
2. SendFlow creates your wallet and **P2P fund** buttons (buy/sell USDC with locals — escrow on Solana, **zero platform fee**).
3. Type the amount and recipient (`.sol`, address, contact, or **phone invite** flow).
4. Confirm — settlement in seconds; **fee comparison**, **streaks**, **referrals**, and **30s undo** (custodial) where applicable.

Five ElizaOS plugins (intent-parser, rate-checker, usdc-handler, payout-router, notifier), `GET /health` + `/metrics`, and **40+** product features — see the command reference below. Run `cd sendflow-agent && bun test` for integration tests.

## P2P USDC marketplace

SendFlow includes a built-in **peer-to-peer marketplace** where users buy and sell USDC from each other — **no platform fee** (only Solana network fees).

### For buyers (want USDC, have cash)

Type **“Buy 50 USDC”** → see sellers → pay via UPI, bank, GCash, M-Pesa, etc. → seller releases USDC from escrow → done.

### For sellers (have USDC, want cash)

Type **“Sell 100 USDC”** → set your rate → USDC moves to escrow → buyer sends fiat → you confirm → USDC is released to the buyer → done.

### Supported payment methods

UPI (India), GCash (Philippines), M-Pesa (Kenya/Africa), bank transfer, PayPal, Wise, cash in person.

### Why zero platform fees

There is no intermediary taking a spread — peers trade directly. SendFlow coordinates the trade and holds USDC in escrow during settlement.

### Safety

- USDC in escrow for sells before the offer is live  
- Reputation and simple limits for new accounts  
- Disputes: admin can **release to buyer** or **return to seller** (`/admin resolve <tradeId> buyer|seller`)

### Flow details

- **Partial fills**: buy less than the seller’s full line; the rest of the offer stays listed until sold or cancelled. Say **“bump my offer”** to move your listing to the top.
- **Payment proof**: after **“I have paid”**, buyers can upload a fiat screenshot; it is stored and shared with the seller and is available when an admin resolves a dispute.
- **Rates**: FX from ExchangeRate API + Jupiter USDC reference with cached fallbacks; warns if USDC drifts from the dollar peg.
- **Volume caps**: per-user tier daily limits persisted under `data/` (`p2p-daily-volume.json`).
- **Admin Telegram**: `/admin p2p stats`, `/admin p2p disputes`, `/admin p2p freeze <userId>`, `/admin p2p trades <userId>`.

### Security & persistence

- **Production** requires a **32+ character** `WALLET_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`, and `SOLANA_ESCROW_WALLET_PRIVATE_KEY` (enforced at process start).
- **Webhook URLs** (business mode) must be **HTTPS** and cannot target private or metadata hostnames (SSRF guard).
- **Optional blocklist:** set `SCAN_WALLET_BLOCKLIST` to a comma-separated list of Solana addresses; transfers to those wallets are rejected before lock.
- **On-disk data** under `SENDFLOW_DATA_DIR` (default `./data`): encrypted wallet JSON in `wallets/`, plus `contacts.json`, `tx-history.json`, `invoices.json`, `sendflow-ids.json`, savings ledgers, phone-claim records, and related stores — **back up this directory** for production.

## Prerequisites

- [Bun](https://bun.sh/) (see root `packageManager` in `package.json`)
- Docker (for container image and `docker compose`)
- [Nosana CLI](https://github.com/nosana-ci/nosana-cli) (optional, for GPU/network job runs)
- A funded Solana wallet with **USDC** (and SOL for fees) for custodial flows that use `SENDER_WALLET_PRIVATE_KEY` / `SOLANA_ESCROW_WALLET_PRIVATE_KEY`

## Local setup

From this directory (monorepo root):

```bash
bun install
bun run build
bun run test
cp .env.example .env   # fill secrets
bun run sendflow-agent/src/index.ts
```

Or from `sendflow-agent/`:

```bash
cp .env.example .env
bun run start
```

## Docker (local)

```bash
docker build -t sendflow:latest .
docker run --env-file sendflow-agent/.env -p 3000:3000 sendflow:latest
curl -s http://localhost:3000/health | jq .
```

`GET /health` returns JSON including `status`, `uptime`, `solanaConnected`, optional `escrowBalance` / `ollamaConnected`, and a **`p2p`** object (open offers, active trades, completed today, volume, disputes) when the agent is running.

## Deploy on Nosana (example)

Build and push your Docker image, then post a Nosana job (Builders market example):

```bash
docker build -t sendflow:latest .
docker tag sendflow:latest YOUR_DOCKERHUB_USERNAME/sendflow:latest
docker push YOUR_DOCKERHUB_USERNAME/sendflow:latest
nosana job post \
  --image YOUR_DOCKERHUB_USERNAME/sendflow:latest \
  --market 7AtiXMSH6R1jjBxrcYjehCkkSF7zvYWte63gwEDBcGHq \
  --wait
```

Set the job URL in `.env` after deploy:

```env
WEBAPP_PUBLIC_URL=https://YOUR_NODE.node.k8s.prd.nos.ci
SENDFLOW_BASE_URL=https://YOUR_NODE.node.k8s.prd.nos.ci
```

For CLI install and workflows, see [Nosana CLI](https://github.com/nosana-ci/nosana-cli) and [Create deployments](https://learn.nosana.com/api/create-deployments.html).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `SOLANA_RPC_URL` | Solana HTTP RPC (default mainnet-beta) |
| `SOLANA_ESCROW_WALLET_PRIVATE_KEY` | Escrow signer (base58 or JSON byte array) |
| `SENDER_WALLET_PRIVATE_KEY` | Custodial sender signer for lock + refund paths |
| `USDC_MINT` | USDC mint (mainnet default in `.env.example`) |
| `JUPITER_API_URL` | Jupiter v6 REST base (swap) |
| `JUPITER_PRICE_API_URL` | Jupiter price API base |
| `PYTH_PRICE_SERVICE_URL` | Hermes base URL |
| `PYTH_FEED_ID_SOURCE` / `PYTH_FEED_ID_TARGET` | Pyth price feed ids (hex) for the two mint legs |
| `SQUADS_PROGRAM_ID` | Squads program (integration hook) |
| `NOSANA_LLM_ENDPOINT` / `NOSANA_API_KEY` | Hosted LLM for `OBJECT_SMALL` |
| `ELIZA_MODEL` | Model name passed to Nosana body |
| `ADMIN_TELEGRAM_ID` | Receives alerts on payout failures + startup message |
| `MIN_TRANSFER_USDC` / `MAX_TRANSFER_USDC` | Transfer amount limits (defaults: 0.1 / 10000) |
| `MINT_RECEIPTS` | Set `true` to mint proof-of-transfer memo receipts |
| `REFERRAL_REWARD_USDC` | Referral reward amount (default: 0.1) |
| `TELEGRAM_BOT_USERNAME` | Bot username for deep links (default: SendFlowSol_bot) |
| `HELIUS_RPC_URL` | Optional Helius RPC for faster websockets |
| `WALLET_ENCRYPTION_KEY` | AES-256 key for custodial wallet encryption |
| `WHISPER_ENDPOINT` | Whisper ASR endpoint for voice transcription |
| `P2P_MAX_TRADE_NEW_USER` / `P2P_MAX_DAY_NEW_USER` | Per-trade and daily USDC caps for new traders |
| `P2P_MAX_TRADE_REGULAR` / `P2P_MAX_DAY_REGULAR` | Caps after reputation builds |
| `P2P_MAX_TRADE_TRUSTED` / `P2P_MAX_DAY_TRUSTED` | Higher caps for trusted traders |
| `P2P_MAX_TRADE_VERIFIED` / `P2P_MAX_DAY_VERIFIED` | Optional verified tier |
| `P2P_OFFER_EXPIRY_HOURS` | Listing TTL (default `24`) |
| `P2P_TRADE_TIMEOUT_MINUTES` | Auto-dispute if seller does not act after buyer marked paid |
| `P2P_MIN_TRADE_USDC` | Minimum trade size |
| `MOONPAY_URL` | Optional legacy URL helper in `offrampOracle` tests |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional SMS for phone claim invites |
| `BIRDEYE_API_KEY` | Birdeye API key (trending tokens) |
| `DEFI_LLAMA_URL` | DeFiLlama yields API |
| `DAILY_DIGEST_ENABLED` | Enable daily summary (default: true) |
| `SPONSOR_WALLET_PRIVATE_KEY` | Optional separate sponsor key (reserved for future use) |
| `WEEKLY_REPORT_ENABLED` | `true` / `false` for Sunday AI reports |
| `WEEKLY_REPORT_UTC_HOUR` | Hour (UTC) for weekly report tick (default `9`) |
| `LOAN_MAX_AMOUNT` | Cap for largest loan tier (default `100`) |
| `LOAN_INTEREST_RATE` | Flat rate (default `0.02`) |
| `STREAM_SETTLEMENT_INTERVAL_MS` | Stream settlement interval (default `300000`) |
| `POS_INVOICE_EXPIRY_MS` | POS invoice TTL (default `600000`) |
| `SENDFLOW_BASE_URL` | Base for Blink URLs (fallback: `WEBAPP_PUBLIC_URL`) |
| `QUICKNODE_RPC_URL` | Optional second RPC for automatic failover |
| `PORT` | Health + WebApp server (default `3000`) |
| `WEBAPP_PUBLIC_URL` | HTTPS URL for Telegram WebApp menu button |
| `SCAN_WALLET_BLOCKLIST` | Comma-separated Solana addresses to block |
| `VIRTUAL_CARD_PROVIDER` | `stub` (default), or partner integration id |

## Security & operations

- **Wallets:** v2 stores `KEY_VERSION: 2` with per-user keys derived via HMAC-SHA256 from `WALLET_ENCRYPTION_KEY` (legacy CBC wallets migrate on load).
- **Limits:** ~20 messages/minute and 10 transfers/hour per user; optional permanent blocklist in `data/blocklist.json`.
- **Transfers:** SPL `transfer` instructions are checked for amount, destination, allowed programs, and valid blockhash before signing (`verifyTransactionIntegrity` in escrow lock).
- **PIN:** `/setpin 123456` (bcrypt hash in `data/pins/`); required to confirm sends **> 10 USDC** when a PIN exists.
- **Observability:** JSON lines via `structuredLogger.ts`; `GET /health` and `GET /metrics` on `PORT` (same process as the agent).

## SendFlow Commands

### Transfers
- `Send 10 USDC to raj.sol` — .sol domain auto-resolved
- `Send 50 USDC to Mom` — uses saved contact
- `Send 0.5 SOL to raj.sol` — multi-token support
- `Send 100 BONK to mike.sol` — any registered SPL token
- `Send 10 USDC to raj.sol fast` — priority fee for faster settlement
- `Split 90 USDC equally between raj.sol, mike.sol and sara.sol`
- `Repeat last transfer`
- `Send again to Mom`

### Contacts
- `Save wallet as Mom: 7xKX...sU`
- `Show my contacts`
- `Delete contact Mom`

### Smart Features
- `Send 100 USDC to Mom when SOL hits $150` — conditional via Pyth Oracle
- `Send 50 USDC to raj.sol every Monday` — recurring transfer
- `Send 100 USDC to Mom every 1st of the month`
- `Cancel recurring transfer to Mom`
- `Show my schedules`

### Requests & Invoices
- `Request 20 USDC from raj.sol`
- `Create invoice for 50 USDC`
- `Create invoice for 100 USDC — label it Client Payment`

### Wallet & Analytics
- `Check my balance` / `balance`
- `Show my stats`
- `Watch Mom's wallet`
- `Alert me when balance drops below 50 USDC`
- `Stop watching Mom`
- `Show my watches`

### History
- `history` — last 5 transfers with Solscan links

### Preferences & Language
- `Switch to Hindi` — replies in Hindi (supports EN/HI/ES/TL/SW)
- `Always send transactions fast` — saves default speed preference
- `Set my monthly budget to 500 USDC` — budget warnings on overspend
- `Notify me when I receive USDC` — notification preference

### Referrals
- `My referral link` — generates shareable invite link
- `Referral stats` — shows referral count and earned rewards

### Pay Links & Savings
- `Create my pay link` — generates t.me/bot?start=pay_USERNAME
- `Create pay link for 50 USDC` — fixed amount pay link
- `Save 50 USDC` — deposit into highest yield vault
- `Withdraw my savings` — withdraw from vault
- `How much am I earning?` — vault balance + APY

### Price Alerts & Market
- `Alert me when SOL hits $200`
- `Alert me when BONK pumps 20%`
- `My alerts` — list active price alerts
- `Market update` — SOL/BTC/USDC prices + Solana TPS

### Wallet & QR
- `My QR` — generates wallet QR code as photo
- `Backup wallet` / `Confirm export` — export private key

### Group Chat
- `@SendFlowSol_bot send 5 USDC to @raj` — works in groups

### Business Mode
- `Enable business mode` — unlock CSV export, bulk pay, webhooks
- `Export CSV` — download transaction history as CSV
- `Set webhook https://...` — receive payment notifications

### Voice Messages
- Send a voice message — bot transcribes and processes it

### Daily Digest
- `Send me daily updates` — morning summary at 8:00 UTC
- `Stop daily digest` — disable

### SendFlow ID (usernames)
- `Claim username harsh` — reserve `sendflow/harsh` for your wallet
- `Send 10 USDC to sendflow/raj` — resolve to that user’s wallet before routing
- `My profile` — profile card; `Set my bio to …` / `Set my emoji to 🦊`

### Micro-loans
- `I need a loan` — credit score and max eligible amount
- `Apply for 20 USDC loan` — approve + disburse from escrow when configured
- `Repay my loan` / `My loan status`

### Streaming payments
- `Stream 5 USDC per hour to raj.sol for 3 hours` — budgeted stream
- `Pause my stream` / `Resume stream` / `Stop streaming` / `Stream status`

### DAO treasury
- `Create treasury SolanaDAO` — treasury + wallet binding
- `Add mike to SolanaDAO` — add member (demo ID)
- `Propose paying raj.sol 100 USDC for design work` — new proposal
- `Vote yes on proposal 1` / `Execute proposal 1` / `Treasury status`

### Merchant POS
- `Enable POS mode for HarshCoffee`
- `Charge 5 USDC for latte` — QR + Blink link
- `Today's sales` / `Disable POS`

### AI weekly reports
- Scheduled **Sunday 9:00 UTC** (configurable) for users with **3+** transfers; uses Nosana Qwen for a short insight

### Solana Blinks
- `Create a Blink for 10 USDC` (uses last transfer recipient when set)
- `Blink for my invoice` / `My profile Blink`

### Gasless onboarding
- First **3** transfers per user can use **escrow as fee payer** when eligible (see `lockUsdcEscrow` + `feeSponsorship`)

### Demo mode & status card
- `/admin demo` — 12-step scripted tour (admin chat only)
- `My card` / `Show my card` — 400×220 PNG status image

### Help
- `help` / `?` / `/help` — full command reference

## Example Telegram flow

1. **User:** `Send 50 USDC to Alice at 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`
   **Agent:** Parses intent (`PARSE_REMITTANCE_INTENT`).

2. **Agent:** Fetches Jupiter + Pyth (`CHECK_REMITTANCE_RATE`) and replies with rate + fee + **Reply YES to confirm**.

3. **User:** `YES` → `CONFIRM_SENDFLOW` sets `flow.confirmed`.

4. **Agent:** Locks USDC to escrow (`LOCK_USDC_ESCROW`), routes payout (`ROUTE_PAYOUT`), notifies (`NOTIFY_PARTIES`).

Verify any transaction on [Solscan](https://solscan.io/) using the links returned in messages.

## Architecture (ASCII)

```
Telegram (DM + Groups + Voice + Inline Keyboards)
   |
   v
+------------------------------------------+
| ElizaOS + SendFlow Agent                 |
| +--------------------------------------+ |
| | Plugins:                             | |
| |  intent-parser | rate-checker        | |
| |  usdc-handler  | payout-router       | |
| |  notifier                            | |
| +--------------------------------------+ |
| | Agent Utils:                         | |
| |  custodialWallet | keyboards | QR    | |
| |  wizard | payLinks | savingsVault    | |
| |  priceAlerts | marketPulse | voice   | |
| |  groupHandler | dailyDigest          | |
| |  businessMode | referralSystem       | |
| +--------------------------------------+ |
+------------------------------------------+
   |        |        |          |
   v        v        v          v
Solana   Jupiter   Pyth     DeFiLlama
 RPC     Swap API  Hermes   Yield API
```

## Plugins

| Package | Actions |
|---------|---------|
| `plugin-intent-parser` | `PARSE_REMITTANCE_INTENT`, `MANAGE_CONTACTS`, `PARSE_SPLIT_INTENT`, `CONDITIONAL_TRANSFER`, `REQUEST_PAYMENT`, `CREATE_INVOICE`, `SCHEDULE_TRANSFER` |
| `plugin-rate-checker` | `CHECK_REMITTANCE_RATE`, `CONFIRM_SENDFLOW` |
| `plugin-usdc-handler` | `LOCK_USDC_ESCROW`, `CHECK_BALANCE`, `SHOW_STATS`, `WATCH_WALLET` |
| `plugin-payout-router` | `ROUTE_PAYOUT` (SPL / Jupiter / Squads path) |
| `plugin-notifier` | `NOTIFY_PARTIES`, `TRANSACTION_HISTORY` |

## Shared Utilities

| Module | Purpose |
|--------|---------|
| `utils/format.ts` | `shortWallet()`, `htmlWallet()`, `solscanTxLink()`, `solscanAddrLink()` |
| `utils/tokenRegistry.ts` | Token lookup (USDC, SOL, BONK, JUP, WIF, PYTH) with mint addresses |
| `utils/priorityFee.ts` | Speed mode detection and priority fee instructions |
| `utils/simulateTx.ts` | Transaction simulation before execution |
| `utils/i18n.ts` | Multi-language translations (EN, HI, ES, TL, SW) |
| `utils/userRegistry.ts` | New-user detection, welcome & help messages |
| `utils/userMemory.ts` | Persistent user preferences (speed, budget, notifications) |
| `utils/referralSystem.ts` | Referral tracking and rewards |
| `utils/mintReceipt.ts` | Proof-of-transfer memo receipts |
| `utils/txTracker.ts` | Live transaction status tracking with Telegram message edits |
| `utils/custodialWallet.ts` | Auto-created AES-256 encrypted wallets per user |
| `utils/keyboards.ts` | Telegram inline keyboard buttons for all interactions |
| `utils/qrGenerator.ts` | Wallet QR code generation (PNG) |
| `utils/wizardState.ts` | Step-by-step send wizard state machine |
| `utils/payLinks.ts` | PayPal.me-style pay links via Telegram deep links |
| `utils/savingsVault.ts` | USDC yield vault with DeFiLlama APY data |
| `utils/priceAlerts.ts` | Price alerts with Jupiter polling (30s interval) |
| `utils/marketPulse.ts` | SOL/BTC/USDC prices + Solana TPS |
| `utils/groupHandler.ts` | Group chat @bot mention handling |
| `utils/dailyDigest.ts` | Personalized daily summary scheduler |
| `utils/businessMode.ts` | CSV export, webhooks, bulk payments |
| `utils/voiceHandler.ts` | Voice message transcription via Whisper |
| `sendflow-agent/utils/encryption.ts` | Per-user AES-256-GCM + HMAC key derivation |
| `sendflow-agent/utils/rateLimiter.ts` | Message/transfer rate limits + blocklist |
| `plugin-intent-parser/utils/txVerifier.ts` | Instruction + blockhash integrity checks before sign |
| `sendflow-agent/utils/fraudDetection.ts` | Heuristic fraud signals + optional blocklist |
| `sendflow-agent/utils/pinAuth.ts` | Bcrypt PIN storage for large transfers |
| `sendflow-agent/utils/virtualCard.ts` | Virtual debit card (stub or partner mode) |
| `sendflow-agent/utils/spendingCoach.ts` | Post-transfer LLM insights |
| `sendflow-agent/utils/tokenSwap.ts` | Jupiter v6 quote + swap execution |
| `sendflow-agent/utils/multiSigApproval.ts` | Approver registry + approval records |
| `sendflow-agent/utils/leaderboard.ts` | Opt-in leaderboard persistence |
| `sendflow-agent/utils/txQueue.ts` | Retry queue for deferred transfers |
| `sendflow-agent/utils/crossChainAdvisor.ts` | ETH/BTC address detection + guidance |
| `sendflow-agent/utils/structuredLogger.ts` | JSON-structured log lines |
| `sendflow-agent/utils/rpcManager.ts` | Multi-RPC health check + failover |
| `sendflow-agent/src/api/health.ts` | `GET /health`, `/metrics`, WebApp static HTML |

## Docker

```bash
docker compose build
docker compose up
```

## Security architecture

SendFlow stacks **seven independent layers** so a single failure mode does not silently compromise funds:

1. **AI classifier (Nosana / Qwen)** — Flags urgency scams, impersonation, and prompt injection before any transfer intent is acted on, defeating social-engineering and LLM-jailbreak attempts at the message boundary.
2. **Zero-trust custodial wallet** — Per-user AES-256-GCM keys derived with PBKDF2 and HMAC-sealed wallet files, defeating file tampering and offline key extraction from plaintext blobs.
3. **Transaction simulation** — Instructions and amounts are checked against policy before sign/broadcast, defeating malicious or confused program paths (e.g., hidden swaps or wrong recipients).
4. **Behavioral auth** — Anomaly scoring and step-up (inline confirm / PIN) for unusual patterns, defeating account takeover and “first payment to a new address” abuse at high amounts.
5. **Off-ramp KYC oracle** — Tier limits, cooling windows, velocity freezes, and optional Chainalysis-style checks, defeating wash trading, limit evasion, and high-risk fiat exits.
6. **RPC quorum & circuit breaker** — Multi-endpoint reads, broadcast quorum on writes, and an open circuit on repeated failures, defeating single-RPC lies and degraded infrastructure.
7. **Immutable audit log** — Append-only JSONL with periodic SHA-256 checkpoints to stdout and disk, defeating silent log tampering after the fact.

Run `bun run stress-test` to validate classifier latency and path health before a live demo (uses a fast fail-safe classifier path unless you set `STRESS_USE_LLM=1` for live Nosana/Qwen timings).

## Verification checklist (manual)

Run `bun run build` and `bun run test` in `sendflow/`, then `bun run build` in `sendflow-agent`. Confirm `@elizaos/core` is `2.0.0-alpha.77` in every `package.json`. Use Solscan for all on-chain receipts: `https://solscan.io/tx/<signature>`.
