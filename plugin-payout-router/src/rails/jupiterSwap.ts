import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";

const DEFAULT_JUPITER = "https://quote-api.jup.ag/v6";

export async function jupiterSwapFromEscrow(params: {
  connection: Connection;
  escrowKeypair: Keypair;
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  jupiterApiUrl?: string;
}): Promise<{ txHash: string; explorerUrl: string; payoutConfirmed: boolean }> {
  const base = (params.jupiterApiUrl ?? DEFAULT_JUPITER).replace(/\/$/, "");
  const q = new URL(`${base}/quote`);
  q.searchParams.set("inputMint", params.inputMint);
  q.searchParams.set("outputMint", params.outputMint);
  q.searchParams.set("amount", params.amountRaw.toString());
  q.searchParams.set("slippageBps", "50");

  let quote: unknown;
  try {
    const quoteRes = await fetch(q.toString(), { headers: { Accept: "application/json" } });
    if (!quoteRes.ok) throw new Error(`quote ${quoteRes.status}`);
    quote = await quoteRes.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Jupiter quote failed: ${msg}`);
  }

  try {
    const swapRes = await fetch(`${base}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: params.escrowKeypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    });
    if (!swapRes.ok) throw new Error(`swap ${swapRes.status}`);
    const swapJson = (await swapRes.json()) as { swapTransaction?: string };
    const b64 = swapJson.swapTransaction;
    if (!b64) throw new Error("missing swapTransaction");

    const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    tx.sign([params.escrowKeypair]);

    const signature = await params.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const latest = await params.connection.getLatestBlockhash("confirmed");
    await params.connection.confirmTransaction(
      { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );

    return {
      txHash: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
      payoutConfirmed: true,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Jupiter swap failed: ${msg}`);
  }
}
