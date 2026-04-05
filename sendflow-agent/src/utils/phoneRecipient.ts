/**
 * Phone → wallet linking and SMS helpers. Core escrow + claim flow: `phoneClaimFlow.ts`.
 */
import { sendPhoneClaimSms, buildPhoneClaimDeepLink } from "./phoneClaimFlow";

export {
  normalizePhoneNumber as normalizePhone,
  tryExtractPhoneRemittance,
  lookupLinkedWalletForPhone as lookupPhoneWallet,
  linkPhoneWallet as linkPhoneToUser,
  type PhoneRemittanceDetect,
} from "@sendflow/plugin-intent-parser";

export { buildPhoneClaimDeepLink, sendPhoneClaimSms };

export async function sendPhoneInvite(
  phone: string,
  _senderName: string,
  amount: number,
  claimLink: string
): Promise<void> {
  const codeMatch = claimLink.match(/claim_([a-f0-9]{8})/i);
  const code = codeMatch?.[1];
  if (code) {
    const { normalizePhoneNumber } = await import("@sendflow/plugin-intent-parser");
    await sendPhoneClaimSms(amount, code, normalizePhoneNumber(phone));
  }
}
