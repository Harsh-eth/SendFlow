import type { Plugin } from "@elizaos/core";
import { parseRemittanceIntentAction } from "./actions/parseRemittanceIntent";

export const sendflowIntentParserPlugin: Plugin = {
  name: "sendflow-intent-parser",
  description:
    "SendFlow: parse natural-language remittance intent (Solana USDC, SPL rails).",
  actions: [parseRemittanceIntentAction],
  providers: [],
  services: [],
};

export default sendflowIntentParserPlugin;
export { parseRemittanceIntentAction };
export * from "./types";
export { isValidReceiverWallet, extractSolanaAddress } from "./utils/solanaAddress";
export * from "./pendingFlow";
