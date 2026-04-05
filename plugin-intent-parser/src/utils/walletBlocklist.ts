import { PublicKey } from "@solana/web3.js";

function normalizeAddress(a: string): string | null {
  try {
    return new PublicKey(a.trim()).toBase58();
  } catch {
    return null;
  }
}

function loadEnvBlocklist(): Set<string> {
  const raw = process.env.SCAN_WALLET_BLOCKLIST ?? "";
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const n = normalizeAddress(part);
    if (n) set.add(n);
  }
  return set;
}

/** Refreshed at process start; env changes require restart. */
let envBlocklist = loadEnvBlocklist();

/** @internal tests */
export function __resetWalletBlocklistForTests(): void {
  envBlocklist = loadEnvBlocklist();
}

/** @internal tests */
export function __setWalletBlocklistForTests(addresses: string[]): void {
  envBlocklist = new Set(addresses.map((a) => normalizeAddress(a)).filter((x): x is string => Boolean(x)));
}

export function isBlocklistedWallet(address: string): boolean {
  const n = normalizeAddress(address);
  if (!n) return false;
  return envBlocklist.has(n);
}
