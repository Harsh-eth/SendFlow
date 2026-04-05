/** Lightweight onboarding copy + keyword language hints (no external API). */

export type OnboardingLocale = "en" | "ES" | "HI" | "TL" | "SW";

const ES_KEYS = /\b(hola|dinero|enviar|mandar|pagar|transferir)\b/i;
const HI_KEYS = /भेजें|पैसे|भेजो|ट्रांसफर/i;
const TL_KEYS = /\b(pera|padala|magpadala|bayad)\b/i;
const SW_KEYS = /\b(habari|pesa|tuma|kuhamisha)\b/i;

export function detectOnboardingLocale(text: string, telegramLang?: string): OnboardingLocale {
  const tl = (telegramLang ?? "").toLowerCase().slice(0, 2);
  if (ES_KEYS.test(text) || tl === "es") return "ES";
  if (HI_KEYS.test(text) || tl === "hi") return "HI";
  if (TL_KEYS.test(text) || tl === "tl" || tl === "fil") return "TL";
  if (SW_KEYS.test(text) || tl === "sw") return "SW";
  return "en";
}

export function onboardingWelcomeBody(
  locale: OnboardingLocale,
  shortPk: string,
  invitedLine?: string
): string {
  const inv = invitedLine ? `\n\n${invitedLine}` : "";
  switch (locale) {
    case "ES":
      return [
        `<b>Bienvenido a SendFlow.</b>`,
        ``,
        `Tu cartera está lista: <code>${shortPk}</code>`,
        ``,
        `Puedes enviar dinero a cualquiera en Telegram — sin banco, sin comisiones altas, sin frases semilla.${inv}`,
      ].join("\n");
    case "HI":
      return [
        `<b>SendFlow में आपका स्वागत है।</b>`,
        ``,
        `आपका वॉलेट तैयार है: <code>${shortPk}</code>`,
        ``,
        `आप Telegram पर किसी को भी पैसा भेज सकते हैं — बैंक, ज़्यादा फीस या सीड फ़्रेज़ की ज़रूरत नहीं।${inv}`,
      ].join("\n");
    case "TL":
      return [
        `<b>Maligayang pagdating sa SendFlow.</b>`,
        ``,
        `Handa na ang wallet mo: <code>${shortPk}</code>`,
        ``,
        `Maaari kang magpadala ng pera sa kahit sino sa Telegram — walang bangko, walang malaking bayad, walang seed phrase.${inv}`,
      ].join("\n");
    case "SW":
      return [
        `<b>Karibu SendFlow.</b>`,
        ``,
        `Pochi yako iko tayari: <code>${shortPk}</code>`,
        ``,
        `Unaweza kutuma pesa kwa mtu yeyote kwenye Telegram — bila benki, bila ada kubwa, bila seed phrase.${inv}`,
      ].join("\n");
    default:
      return [
        `<b>Welcome to SendFlow.</b>`,
        ``,
        `Your wallet is ready: <code>${shortPk}</code>`,
        ``,
        `You can send money to anyone on Telegram — no bank, no high fees, no seed phrases.${inv}`,
      ].join("\n");
  }
}

export function onboardingPromptQuestion(locale: OnboardingLocale): string {
  switch (locale) {
    case "ES":
      return `<b>¿Qué quieres hacer?</b>`;
    case "HI":
      return `<b>आप क्या करना चाहते हैं?</b>`;
    case "TL":
      return `<b>Ano ang gusto mong gawin?</b>`;
    case "SW":
      return `<b>Unataka kufanya nini?</b>`;
    default:
      return `<b>What do you want to do?</b>`;
  }
}
