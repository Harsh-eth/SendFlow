import { PublicKey } from "@solana/web3.js";

/** Validates a base58 Solana address using on-curve check (per project rules). */
export function isValidReceiverWallet(address: string): boolean {
  try {
    const pk = new PublicKey(address);
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}

/** Extract first base58 pubkey-like string (32-byte key) from free text. */
export function extractSolanaAddress(text: string): string | undefined {
  const re = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  const matches = text.match(re);
  if (!matches?.length) return undefined;
  for (const m of matches) {
    if (isValidReceiverWallet(m)) return m;
  }
  return undefined;
}
