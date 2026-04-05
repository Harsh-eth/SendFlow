import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { getCustodialWallet } from "./custodialWallet";
import { getHealthyConnection } from "./rpcManager";

export async function getUsdcBalanceHuman(userId: string): Promise<number> {
  const w = await getCustodialWallet(userId);
  if (!w) return 0;
  const connection = await getHealthyConnection();
  const mint = new PublicKey(process.env.USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  const ata = await getAssociatedTokenAddress(mint, new PublicKey(w.publicKey));
  const info = await connection.getTokenAccountBalance(ata).catch(() => null);
  if (!info?.value?.uiAmount) return 0;
  return Number(info.value.uiAmount);
}
