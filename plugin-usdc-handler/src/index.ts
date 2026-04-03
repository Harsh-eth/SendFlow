import type { Plugin } from "@elizaos/core";
import { lockUsdcEscrowAction } from "./actions/lockUsdcEscrow";

export const sendflowUsdcHandlerPlugin: Plugin = {
  name: "sendflow-usdc-handler",
  description: "SendFlow: lock USDC into escrow on Solana (SPL).",
  actions: [lockUsdcEscrowAction],
  providers: [],
  services: [],
};

export default sendflowUsdcHandlerPlugin;
export { lockUsdcEscrowAction };
export { releaseEscrow } from "./utils/releaseEscrow";
