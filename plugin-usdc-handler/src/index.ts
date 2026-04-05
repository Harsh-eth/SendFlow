import type { Plugin } from "@elizaos/core";
import { lockUsdcEscrowAction } from "./actions/lockUsdcEscrow";
import { checkBalanceAction } from "./actions/checkBalance";
import { showStatsAction } from "./actions/showStats";
import { watchWalletAction } from "./actions/watchWallet";

export const sendflowUsdcHandlerPlugin: Plugin = {
  name: "sendflow-usdc-handler",
  description: "SendFlow: lock USDC into escrow on Solana (SPL).",
  actions: [lockUsdcEscrowAction, checkBalanceAction, showStatsAction, watchWalletAction],
  providers: [],
  services: [],
};

export default sendflowUsdcHandlerPlugin;
export { lockUsdcEscrowAction };
export { checkBalanceAction };
export { showStatsAction };
export { watchWalletAction };
export { setWatchNotifyCallback } from "./utils/walletWatcher";
export { releaseEscrow } from "./utils/releaseEscrow";
