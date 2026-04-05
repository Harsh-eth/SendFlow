export type Language = "en" | "hi" | "es" | "tl" | "sw";

const userLanguages = new Map<string, Language>();

const TRANSLATIONS: Record<string, Record<Language, string>> = {
  "transfer.preview": {
    en: "Transfer Preview",
    hi: "ट्रांसफर पूर्वावलोकन",
    es: "Vista previa de transferencia",
    tl: "Preview ng Transfer",
    sw: "Muhtasari wa Uhamisho",
  },
  "transfer.success": {
    en: "Transfer Complete!",
    hi: "ट्रांसफर पूरा हुआ!",
    es: "¡Transferencia completada!",
    tl: "Transfer Kumpleto!",
    sw: "Uhamisho Umekamilika!",
  },
  "transfer.failed": {
    en: "Transfer Failed",
    hi: "ट्रांसफर विफल",
    es: "Transferencia fallida",
    tl: "Nabigo ang Transfer",
    sw: "Uhamisho Umeshindwa",
  },
  "confirm.prompt": {
    en: "Reply YES to confirm or NO to cancel",
    hi: "पुष्टि के लिए YES या रद्द करने के लिए NO टाइप करें",
    es: "Responda YES para confirmar o NO para cancelar",
    tl: "Sumagot ng YES para kumpirmahin o NO para kanselahin",
    sw: "Jibu YES kuthibitisha au NO kughairi",
  },
  "confirm.cancelled": {
    en: "Transfer cancelled. No funds moved.",
    hi: "ट्रांसफर रद्द किया गया। कोई फंड नहीं भेजा गया।",
    es: "Transferencia cancelada. No se movieron fondos.",
    tl: "Nakansela ang transfer. Walang pondo na inilipat.",
    sw: "Uhamisho umeghairiwa. Hakuna pesa zilizohamishwa.",
  },
  "confirm.timeout": {
    en: "Transfer expired. Please start again.",
    hi: "ट्रांसफर समाप्त हो गया। कृपया फिर से शुरू करें।",
    es: "Transferencia expirada. Por favor, comience de nuevo.",
    tl: "Nag-expire ang transfer. Magsimula ulit.",
    sw: "Uhamisho umeisha muda. Tafadhali anza tena.",
  },
  "balance.show": {
    en: "Your SendFlow Wallet",
    hi: "आपका SendFlow वॉलेट",
    es: "Tu billetera SendFlow",
    tl: "Ang iyong SendFlow Wallet",
    sw: "Pochi yako ya SendFlow",
  },
  "welcome.title": {
    en: "Welcome to SendFlow!",
    hi: "SendFlow में आपका स्वागत है!",
    es: "¡Bienvenido a SendFlow!",
    tl: "Maligayang pagdating sa SendFlow!",
    sw: "Karibu SendFlow!",
  },
  "savings.human_lt2": {
    en: "You saved ${amount} — that's a cup of chai",
    hi: "आपने ${amount} बचाए — यह एक कप चाय जितना है",
    es: "Ahorraste ${amount} — eso es una taza de chai",
    tl: "Nakatipid ka ng ${amount} — isang tasa ng chai iyan",
    sw: "Umeokoa ${amount} — hiyo ni kikombe cha chai",
  },
  "savings.human_2_5": {
    en: "You saved ${amount} — that's a street food meal",
    hi: "आपने ${amount} बचाए — यह सड़क के खाने का एक खाना है",
    es: "Ahorraste ${amount} — eso es una comida callejera",
    tl: "Nakatipid ka ng ${amount} — isang street food meal iyan",
    sw: "Umeokoa ${amount} — hiyo ni chakula cha mtaani",
  },
  "savings.human_5_15": {
    en: "You saved ${amount} — that's a day of groceries",
    hi: "आपने ${amount} बचाए — यह एक दिन की किराने का सामान है",
    es: "Ahorraste ${amount} — eso es un día de comestibles",
    tl: "Nakatipid ka ng ${amount} — isang araw ng groceries iyan",
    sw: "Umeokoa ${amount} — hiyo ni siku moja ya chakula",
  },
  "savings.human_5_15_ph": {
    en: "You saved ${amount} — that's a week of groceries in Manila",
    hi: "आपने ${amount} बचाए — यह मनीला में एक हफ्ते की किराना है",
    es: "Ahorraste ${amount} — eso es una semana de comestibles en Manila",
    tl: "Nakatipid ka ng ${amount} — isang linggo ng groceries sa Manila iyan",
    sw: "Umeokoa ${amount} — hiyo ni wiki ya chakula Manila",
  },
  "savings.human_5_15_in": {
    en: "You saved ${amount} — that's a week of groceries in Mumbai",
    hi: "आपने ${amount} बचाए — यह मुंबई में एक हफ्ते की किराना है",
    es: "Ahorraste ${amount} — eso es una semana de comestibles en Mumbai",
    tl: "Nakatipid ka ng ${amount} — isang linggo ng groceries sa Mumbai iyan",
    sw: "Umeokoa ${amount} — hiyo ni wiki ya chakula Mumbai",
  },
  "savings.human_15_30": {
    en: "You saved ${amount} — that's a week of school lunches",
    hi: "आपने ${amount} बचाए — यह स्कूल लंच का एक हफ्ता है",
    es: "Ahorraste ${amount} — eso es una semana de almuerzos escolares",
    tl: "Nakatipid ka ng ${amount} — isang linggo ng school lunch iyan",
    sw: "Umeokoa ${amount} — hiyo ni wiki ya chakula shule",
  },
  "savings.human_30_60": {
    en: "You saved ${amount} — that's a month of mobile data",
    hi: "आपने ${amount} बचाए — यह एक महीने का मोबाइल डेटा है",
    es: "Ahorraste ${amount} — eso es un mes de datos móviles",
    tl: "Nakatipid ka ng ${amount} — isang buwan ng mobile data iyan",
    sw: "Umeokoa ${amount} — hiyo ni mwezi wa data ya simu",
  },
  "savings.human_60_100": {
    en: "You saved ${amount} — that's a month of rent for many families",
    hi: "आपने ${amount} बचाए — कई परिवारों के लिए यह एक महीने का किराया है",
    es: "Ahorraste ${amount} — eso es un mes de alquiler para muchas familias",
    tl: "Nakatipid ka ng ${amount} — isang buwan ng renta para sa maraming pamilya iyan",
    sw: "Umeokoa ${amount} — hiyo ni kodi ya mwezi kwa familia nyingi",
  },
  "savings.human_100p": {
    en: "You saved ${amount} — that's life-changing money kept in the family",
    hi: "आपने ${amount} बचाए — यह परिवार में रहने वाला जीवन बदलने वाला पैसा है",
    es: "Ahorraste ${amount} — eso es dinero que cambia vidas y se queda en la familia",
    tl: "Nakatipid ka ng ${amount} — pera iyan na nagbabago ng buhay at nananatili sa pamilya",
    sw: "Umeokoa ${amount} — hiyo ni pesa inayobadilisha maisha na kubaki kwenye familia",
  },
  "savings.milestone_10": {
    en: "You've saved ${amount} with SendFlow. Tell a friend.",
    hi: "आपने SendFlow के साथ ${amount} बचाया है। किसी दोस्त को बताएं।",
    es: "Has ahorrado ${amount} con SendFlow. Cuéntaselo a un amigo.",
    tl: "Nakatipid ka na ng ${amount} gamit ang SendFlow. Sabihan ang kaibigan.",
    sw: "Umeokoa ${amount} na SendFlow. Mwambie rafiki.",
  },
  "savings.milestone_50": {
    en: "You've saved ${amount} — that's ${equiv}. Share your link: ${link}",
    hi: "आपने ${amount} बचाया — यह ${equiv} है। अपना लिंक साझा करें: ${link}",
    es: "Has ahorrado ${amount} — eso es ${equiv}. Comparte tu enlace: ${link}",
    tl: "Nakatipid ka ng ${amount} — ${equiv} iyan. I-share ang link mo: ${link}",
    sw: "Umeokoa ${amount} — hiyo ni ${equiv}. Shiriki kiungo chako: ${link}",
  },
  "savings.milestone_50_nolink": {
    en: "(open the bot menu for your referral link)",
    hi: "(रेफ़रल लिंक के लिए बॉट मेनू खोलें)",
    es: "(abre el menú del bot para tu enlace de referido)",
    tl: "(buksan ang bot menu para sa referral link)",
    sw: "(fungua menyu ya bot kwa kiungo cha rufaa)",
  },
  "savings.milestone_50_equiv": {
    en: "a week of groceries for a family",
    hi: "एक परिवार के लिए एक हफ्ते की किराना",
    es: "una semana de comestibles para una familia",
    tl: "isang linggo ng groceries para sa isang pamilya",
    sw: "wiki ya chakula kwa familia",
  },
  "savings.milestone_100": {
    en: "You've saved ${amount} with SendFlow. You're a power user.",
    hi: "आपने SendFlow के साथ ${amount} बचाया है। आप एक पावर यूज़र हैं।",
    es: "Has ahorrado ${amount} con SendFlow. Eres un usuario avanzado.",
    tl: "Nakatipid ka na ng ${amount} gamit ang SendFlow. Power user ka na.",
    sw: "Umeokoa ${amount} na SendFlow. Wewe ni mtumiaji hodari.",
  },
  "savings.lifetime_reply": {
    en: "Since you started using SendFlow, you've saved a total of ${total} compared to Western Union. Across ${count} transfers. That's money that stayed with your family.",
    hi: "जब से आप SendFlow इस्तेमाल कर रहे हैं, आपने Western Union की तुलना में कुल ${total} बचाया है। ${count} ट्रांसफर में। वह पैसा आपके परिवार के पास ही रहा।",
    es: "Desde que usas SendFlow, has ahorrado un total de ${total} frente a Western Union. En ${count} transferencias. Ese dinero se quedó en tu familia.",
    tl: "Simula nang gamitin mo ang SendFlow, nakapag-ipon ka na ng ${total} kumpara sa Western Union. Sa ${count} na transfer. Pera iyon na nanatili sa pamilya mo.",
    sw: "Tangu uanze kutumia SendFlow, umeokoa jumla ya ${total} ukilinganisha na Western Union. Katika uhamisho ${count}. Pesa hizo zilibaki kwenye familia yako.",
  },
};

export function detectLanguage(text: string, telegramLangCode?: string): Language {
  const lower = text.toLowerCase();
  if (/\bswitch\s+to\s+hindi\b|\bhindi\b/.test(lower)) return "hi";
  if (/\bswitch\s+to\s+spanish\b|\bespañol\b/.test(lower)) return "es";
  if (/\bswitch\s+to\s+tagalog\b|\bfilipino\b/.test(lower)) return "tl";
  if (/\bswitch\s+to\s+swahili\b/.test(lower)) return "sw";
  if (/\bswitch\s+to\s+english\b/.test(lower)) return "en";

  if (telegramLangCode) {
    const code = telegramLangCode.toLowerCase().slice(0, 2);
    if (code === "hi") return "hi";
    if (code === "es") return "es";
    if (code === "tl" || code === "fil") return "tl";
    if (code === "sw") return "sw";
  }

  return "en";
}

export function t(key: string, lang: Language, vars?: Record<string, string>): string {
  const translations = TRANSLATIONS[key];
  if (!translations) return key;
  let text = translations[lang] ?? translations.en ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\$\\{${k}\\}`, "g"), v);
    }
  }
  return text;
}

export function setUserLanguage(userId: string, lang: Language): void {
  userLanguages.set(userId, lang);
}

export function getUserLanguage(userId: string): Language {
  return userLanguages.get(userId) ?? "en";
}
