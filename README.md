# SendFlow

SendFlow is a **Solana-native** remittance agent built on **ElizaOS v2**: users describe transfers in plain English on Telegram, and the agent parses intent, quotes prices from Jupiter and Pyth, locks **USDC** into an escrow wallet, routes payout on-chain (SPL transfer, Jupiter v6 swap, or escrow release path), and notifies both parties with **Solscan** links.

Solana is used end-to-end for speed, low fees, and native **USDC** liquidity. Value movement is modeled as SPL tokens on **mainnet** (configure RPC and keys accordingly).

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

## Deploy on Nosana (example)

Build and push your Docker image, then post a Nosana job (market id from [Nosana docs](https://docs.nosana.com/)):

```bash
docker build -t yourname/sendflow:latest .
docker push yourname/sendflow:latest
nosana job post --image yourname/sendflow:latest --market <MARKET_ADDRESS> --wait
```

For local CLI install and job JSON workflows, see [Nosana CLI](https://github.com/nosana-ci/nosana-cli) and [Create deployments](https://learn.nosana.com/api/create-deployments.html).

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

## Example Telegram flow

1. **User:** `Send 50 USDC to Alice at 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`  
   **Agent:** Parses intent (`PARSE_REMITTANCE_INTENT`).

2. **Agent:** Fetches Jupiter + Pyth (`CHECK_REMITTANCE_RATE`) and replies with rate + fee + **Reply YES to confirm**.

3. **User:** `YES` → `CONFIRM_SENDFLOW` sets `flow.confirmed`.

4. **Agent:** Locks USDC to escrow (`LOCK_USDC_ESCROW`), routes payout (`ROUTE_PAYOUT`), notifies (`NOTIFY_PARTIES`).

Verify any transaction on [Solscan](https://solscan.io/) using the links returned in messages.

## Architecture (ASCII)

```
Telegram
   |
   v
+------------------+
| ElizaOS runtime  |
| +--------------+ |
| | intent-parser| |
| | rate-checker | |
| | usdc-handler | |
| | payout-router| |
| | notifier     | |
| +--------------+ |
+------------------+
   |                |
   v                v
Solana RPC     Jupiter / Pyth APIs
(USDC, SPL)    (quotes + swaps)
```

## Plugins

| Package | Role |
|---------|------|
| `plugin-intent-parser` | `PARSE_REMITTANCE_INTENT` |
| `plugin-rate-checker` | `CHECK_REMITTANCE_RATE`, `CONFIRM_SENDFLOW`, pending YES (60s) |
| `plugin-usdc-handler` | `LOCK_USDC_ESCROW`, `releaseEscrow()` |
| `plugin-payout-router` | `ROUTE_PAYOUT` (SPL / Jupiter / Squads path) |
| `plugin-notifier` | `NOTIFY_PARTIES` (Telegram) |

## Docker

```bash
docker compose build
docker compose up
```

## Verification checklist (manual)

Run `bun run build` and `bun run test` in `sendflow/`, then `bun run build` in `sendflow-agent`. Confirm `@elizaos/core` is `2.0.0-alpha.77` in every `package.json`. Use Solscan for all on-chain receipts: `https://solscan.io/tx/<signature>`.
