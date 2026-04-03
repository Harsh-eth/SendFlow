import {
  AgentRuntime,
  InMemoryDatabaseAdapter,
  ModelType,
  logger,
  type IAgentRuntime,
} from "@elizaos/core";
import { TelegramService } from "@elizaos/plugin-telegram";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { sendflowCharacter } from "./character";

/** Eliza `getSetting()` does not read `process.env`; mirror env here so plugins (e.g. Telegram) see the same vars. */
function envAsRuntimeSettings(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== "")
  );
}

function loadEscrowPk(): Keypair | null {
  const s = process.env.SOLANA_ESCROW_WALLET_PRIVATE_KEY?.trim();
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    try {
      const json = JSON.parse(s) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(json));
    } catch {
      return null;
    }
  }
}

function registerNosanaObjectModel(runtime: IAgentRuntime): void {
  const nosanaHeaders = (rt: IAgentRuntime): Record<string, string> => {
    const key = rt.getSetting("NOSANA_API_KEY");
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof key === "string" && key) {
      h.Authorization = `Bearer ${key}`;
    }
    return h;
  };

  const nosanaChatText = async (
    rt: IAgentRuntime,
    params: Record<string, unknown>
  ): Promise<string> => {
    const endpoint = rt.getSetting("NOSANA_LLM_ENDPOINT");
    if (!endpoint || typeof endpoint !== "string") {
      return "";
    }
    const prompt =
      typeof params.prompt === "string" ? params.prompt : String(params.prompt ?? "");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: nosanaHeaders(rt),
        body: JSON.stringify({
          model: rt.getSetting("ELIZA_MODEL") ?? "qwen3.5-27b-awq-4bit",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      return typeof text === "string" ? text : "";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`Nosana TEXT_SMALL/TEXT_LARGE failed: ${msg}`);
      return "";
    }
  };

  runtime.registerModel(
    ModelType.OBJECT_SMALL,
    async (rt, params) => {
      const endpoint = rt.getSetting("NOSANA_LLM_ENDPOINT");
      if (!endpoint || typeof endpoint !== "string") {
        return {};
      }
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: nosanaHeaders(rt),
          body: JSON.stringify({
            model: rt.getSetting("ELIZA_MODEL") ?? "qwen3.5-27b-awq-4bit",
            prompt: (params as { prompt?: string }).prompt,
            schema: (params as { schema?: unknown }).schema,
          }),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Nosana OBJECT_SMALL failed: ${msg}`);
        return {};
      }
    },
    "nosana",
    100
  );

  runtime.registerModel(ModelType.TEXT_SMALL, nosanaChatText, "nosana", 100);
  runtime.registerModel(ModelType.TEXT_LARGE, nosanaChatText, "nosana", 100);

  runtime.registerModel(
    ModelType.TEXT_EMBEDDING,
    async () => {
      return [];
    },
    "nosana",
    100
  );
}

const rpc = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const connection = new Connection(rpc, "confirmed");
const escrow = loadEscrowPk();

if (escrow) {
  logger.info(`SendFlow escrow (loaded): ${escrow.publicKey.toBase58()}`);
} else {
  logger.warn("SendFlow: SOLANA_ESCROW_WALLET_PRIVATE_KEY not loaded (set for signing tests).");
}

logger.info(`Solana RPC: ${connection.rpcEndpoint}`);

const adapter = new InMemoryDatabaseAdapter();
await adapter.init();

const runtime = new AgentRuntime({
  character: sendflowCharacter,
  adapter,
  logLevel: "info",
  settings: envAsRuntimeSettings(),
});

registerNosanaObjectModel(runtime);

await runtime.initialize({ allowNoDatabase: true });

await TelegramService.start(runtime);

logger.info("SendFlow agent running (Telegram + in-memory DB). Press Ctrl+C to stop.");
