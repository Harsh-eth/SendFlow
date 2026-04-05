import { persistLoad, persistSave } from "./persistence";
import { normalizePhoneNumber } from "./phoneRemittance";

const FILE = "phone-user-links.json";

function read(): Record<string, string> {
  return persistLoad<Record<string, string>>(FILE, {});
}

function write(m: Record<string, string>): void {
  persistSave(FILE, m);
}

export function lookupLinkedWalletForPhone(phone: string): string | null {
  const n = normalizePhoneNumber(phone);
  return read()[n] ?? null;
}

export function linkPhoneWallet(phone: string, wallet: string): void {
  const n = normalizePhoneNumber(phone);
  const m = read();
  m[n] = wallet.trim();
  write(m);
}
