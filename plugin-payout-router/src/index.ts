import type { Plugin } from "@elizaos/core";
import { routePayoutAction } from "./actions/routePayout";

export const sendflowPayoutRouterPlugin: Plugin = {
  name: "sendflow-payout-router",
  description: "SendFlow: SPL / Jupiter / Squads payout routing on Solana.",
  actions: [routePayoutAction],
  providers: [],
  services: [],
};

export default sendflowPayoutRouterPlugin;
export { routePayoutAction };
export * from "./rails/splTransfer";
export * from "./rails/jupiterSwap";
export * from "./rails/squadsEscrow";
