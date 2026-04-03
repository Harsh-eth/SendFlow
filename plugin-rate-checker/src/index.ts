import type { Plugin } from "@elizaos/core";
import { checkRemittanceRateAction } from "./actions/checkRemittanceRate";
import { confirmSendflowAction } from "./actions/confirmSendflow";

export const sendflowRateCheckerPlugin: Plugin = {
  name: "sendflow-rate-checker",
  description: "SendFlow: Jupiter + Pyth FX for cross-SPL remittance quotes.",
  actions: [checkRemittanceRateAction, confirmSendflowAction],
  providers: [],
  services: [],
};

export default sendflowRateCheckerPlugin;
export { checkRemittanceRateAction };
export { confirmSendflowAction };
export * from "./types";
export * from "./providers/fxProvider";
