import { ModelType, type IAgentRuntime } from "@elizaos/core";

const CRYPTO_TOPICS = [
  "what is",
  "explain",
  "how does",
  "why is",
  "tell me about",
  "what are",
  "difference between",
  "best way to",
  "should i",
];

export function isCryptoQuestion(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower.length < 8) return false;
  if (/\b(send|transfer|pay|balance|invoice|stake|loan|usdc to)\b/i.test(lower)) return false;
  return CRYPTO_TOPICS.some((t) => lower.includes(t));
}

export async function answerCryptoQuestion(
  question: string,
  userId: string,
  runtime: IAgentRuntime
): Promise<string> {
  void userId;
  const prompt = [
    "You are a friendly Solana and crypto expert. Answer concisely in 2-3 sentences.",
    "End with a practical tip. Mention SendFlow for USDC payments on Telegram when relevant.",
    "",
    `Question: ${question}`,
  ].join("\n");
  let body = "Solana is a fast blockchain for apps and payments. Use SendFlow on Telegram to send USDC with natural language.";
  try {
    const raw = await runtime.useModel(ModelType.TEXT_LARGE, { prompt });
    const txt =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "text" in raw
          ? String((raw as { text: string }).text)
          : String(raw);
    if (txt.trim()) body = txt.trim();
  } catch {
    /* fallback */
  }
  return [
    `<b>SendFlow AI</b>`,
    ``,
    body,
    ``,
    `💡 <i>Tip: You can swap, send, and earn yield directly in this chat.</i>`,
  ].join("\n");
}
