import type { Plugin } from "@elizaos/core";
import { notifyPartiesAction } from "./actions/notifyParties";

export const sendflowNotifierPlugin: Plugin = {
  name: "sendflow-notifier",
  description: "SendFlow: Telegram notifications for sender and receiver.",
  actions: [notifyPartiesAction],
  providers: [],
  services: [],
};

export default sendflowNotifierPlugin;
export { notifyPartiesAction };
