/**
 * Run before the rest of the agent: fatal checks in production only.
 */
import { log } from "./utils/structuredLogger";

if (process.env.NODE_ENV === "production") {
  const key = process.env.WALLET_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) {
    log.error("startup.fatal", { reason: "WALLET_ENCRYPTION_KEY missing or too short" });
    process.exit(1);
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    log.error("startup.fatal", { reason: "TELEGRAM_BOT_TOKEN missing" });
    process.exit(1);
  }
  const escrowKey = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!escrowKey) {
    log.error("startup.fatal", { reason: "SOLANA_ESCROW_WALLET_PRIVATE_KEY missing" });
    process.exit(1);
  }
}
