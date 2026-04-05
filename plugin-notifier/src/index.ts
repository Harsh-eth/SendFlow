import type { Plugin } from "@elizaos/core";
import { notifyPartiesAction } from "./actions/notifyParties";
import { transactionHistoryAction } from "./actions/transactionHistory";

export const sendflowNotifierPlugin: Plugin = {
  name: "sendflow-notifier",
  description: "SendFlow: Telegram notifications for sender and receiver.",
  actions: [notifyPartiesAction, transactionHistoryAction],
  providers: [],
  services: [],
};

export default sendflowNotifierPlugin;
export { notifyPartiesAction };
export {
  transactionHistoryAction,
  recordTransaction,
  getLastTransfer,
  getLastTransferTo,
  getAllTransfers,
} from "./actions/transactionHistory";
export type { TxRecord } from "./actions/transactionHistory";
