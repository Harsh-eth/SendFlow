declare module "@elizaos/plugin-telegram" {
  import type { Plugin, Service } from "@elizaos/core";
  const plugin: Plugin;
  export class TelegramService extends Service {
    static start(runtime: import("@elizaos/core").IAgentRuntime): Promise<Service>;
  }
  export default plugin;
}
