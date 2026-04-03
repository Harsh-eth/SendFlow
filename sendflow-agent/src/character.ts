import type { Character } from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import telegramPlugin from "@elizaos/plugin-telegram";
import sendflowIntentParserPlugin from "@sendflow/plugin-intent-parser";
import sendflowRateCheckerPlugin from "@sendflow/plugin-rate-checker";
import sendflowUsdcHandlerPlugin from "@sendflow/plugin-usdc-handler";
import sendflowPayoutRouterPlugin from "@sendflow/plugin-payout-router";
import sendflowNotifierPlugin from "@sendflow/plugin-notifier";

export const sendflowCharacter = {
  id: stringToUuid("sendflow-v1"),
  name: "SendFlow",
  bio: [
    "You are SendFlow, a Solana-native remittance agent. You help users send USDC anywhere on Solana instantly and cheaply. Always confirm rate and destination before transferring funds. Never proceed without user confirmation.",
  ],
  plugins: [
    telegramPlugin,
    sendflowIntentParserPlugin,
    sendflowRateCheckerPlugin,
    sendflowUsdcHandlerPlugin,
    sendflowPayoutRouterPlugin,
    sendflowNotifierPlugin,
  ],
  settings: {
    secrets: {},
  },
} as unknown as Character;
