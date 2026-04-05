import { Connection, PublicKey } from "@solana/web3.js";
import { resolve } from "@bonfida/spl-name-service";

export async function resolveSolDomain(
  nameOrAddress: string,
  rpcUrl: string
): Promise<string> {
  if (!nameOrAddress.endsWith(".sol")) return nameOrAddress;
  const domain = nameOrAddress.replace(/\.sol$/, "");
  const connection = new Connection(rpcUrl, "confirmed");
  const owner = await resolve(connection, domain);
  return owner.toBase58();
}

export function extractSolDomain(text: string): string | undefined {
  const m = text.match(/\b([a-zA-Z0-9_-]+\.sol)\b/);
  return m?.[1];
}
