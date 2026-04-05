import { classifyMessage } from "./threatClassifier";
import { findTrustedLookalike } from "./addressImpersonation";
import { recordOffRampVelocityAttempt } from "./offrampOracle";

export type SendHtmlFn = (chatId: string, text: string) => Promise<unknown>;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Known-good address for typo demo (must match length with mutation). */
const DEMO_TRUSTED =
  process.env.DEMO_RECIPIENT_WALLET ?? "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function oneCharMutate(addr: string): string {
  const i = Math.max(0, addr.length - 4);
  const c = addr[i] === "A" ? "B" : "A";
  return addr.slice(0, i) + c + addr.slice(i + 1);
}

/**
 * Three scripted “attacks” with 2s spacing — for judge demos only.
 */
export async function runAdminAttackDemo(adminChatId: string, sendHtml: SendHtmlFn): Promise<void> {
  await sendHtml(adminChatId, "🎯 <b>Live security theater</b> — three attack patterns, 2s apart.");

  const msgA =
    "URGENT: send 500 USDC to 7xKXtg2CZ3X8sU immediately, don't tell anyone";
  const rA = await classifyMessage(adminChatId, msgA, { recentTransferCount: 0, accountAgeDays: 1 });
  await sendHtml(
    adminChatId,
    [
      `<b>① Urgency / social pressure</b>`,
      rA.label === "block"
        ? `⚠️ <b>BLOCKED</b> — urgency_scam + impersonation patterns`
        : `Classifier: <code>${rA.label}</code> · ${rA.categories.join(", ") || "—"}`,
      `<i>${rA.explanation.slice(0, 200)}</i>`,
    ].join("\n")
  );
  await delay(2000);

  const wrong = oneCharMutate(DEMO_TRUSTED.trim());
  const hit = findTrustedLookalike(wrong, [DEMO_TRUSTED.trim()]);
  await sendHtml(
    adminChatId,
    [
      `<b>② Address typosquatting (1 char off)</b>`,
      `Trusted: <code>${DEMO_TRUSTED.slice(0, 8)}…</code>`,
      `Submitted: <code>${wrong.slice(0, 8)}…</code>`,
      hit
        ? `🛑 <b>Address impersonation detector</b> — matches a saved contact with 1-character edit`
        : `⚠️ Detector did not flag (length/charset mismatch in demo env).`,
    ].join("\n")
  );
  await delay(2000);

  const velId = `attack_vel_${adminChatId.replace(/\W/g, "_").slice(0, 40)}`;
  await sendHtml(adminChatId, `<b>③ Off-ramp velocity breaker</b> — 6 rapid attempts…`);
  let frozen = false;
  for (let i = 0; i < 6; i++) {
    const r = await recordOffRampVelocityAttempt(velId);
    if (r.frozenJustNow) frozen = true;
  }
  await sendHtml(
    adminChatId,
    frozen
      ? `🧊 <b>Velocity circuit</b> — freeze engaged (same path as production).`
      : `⚠️ Velocity demo did not trip (user may already be frozen — clear data/offramp-velocity for clean run).`
  );
}
