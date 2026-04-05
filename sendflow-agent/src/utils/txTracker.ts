import { Connection } from "@solana/web3.js";
import { loggerCompat as logger } from "./structuredLogger";

export async function trackTransactionStatus(
  connection: Connection,
  txHash: string,
  chatId: string,
  botToken: string,
  initialMessageId: number
): Promise<void> {
  const solscanUrl = `https://solscan.io/tx/${txHash}`;
  const maxPolls = 30;
  const pollInterval = 2_000;

  const editMessage = async (text: string) => {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: initialMessageId,
          text,
          parse_mode: "HTML",
        }),
      });
    } catch {
      /* best effort */
    }
  };

  const startTime = Date.now();

  await editMessage(
    `⏳ <b>Transaction submitted...</b>\n🔗 <a href="${solscanUrl}">View on Solscan</a>`
  );

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    try {
      const status = await connection.getSignatureStatus(txHash, {
        searchTransactionHistory: false,
      });

      const confirmations = status?.value?.confirmations;
      const isFinalized = status?.value?.confirmationStatus === "finalized";
      const isConfirmed =
        status?.value?.confirmationStatus === "confirmed" || isFinalized;

      if (status?.value?.err) {
        await editMessage(
          `❌ <b>Transaction Failed</b> (${elapsed}s)\n🔗 <a href="${solscanUrl}">View on Solscan</a>\n💡 Please try again.`
        );
        return;
      }

      if (isFinalized) {
        await editMessage(
          `✅ <b>Confirmed!</b> (32/32 confirmations)\n⚡ Speed: ${elapsed}s\n🔗 <a href="${solscanUrl}">View on Solscan</a>`
        );
        return;
      }

      if (isConfirmed) {
        await editMessage(
          `🔄 <b>Processing...</b> (${confirmations ?? "?"}/32 confirmations)\n⏱ ${elapsed}s\n🔗 <a href="${solscanUrl}">View on Solscan</a>`
        );
      } else if (confirmations != null) {
        await editMessage(
          `🔄 <b>Confirming...</b> (${confirmations}/32)\n⏱ ${elapsed}s\n🔗 <a href="${solscanUrl}">View on Solscan</a>`
        );
      }
    } catch (err) {
      logger.warn(`TxTracker poll error: ${err}`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  await editMessage(
    `⏱ <b>Awaiting finalization</b> (${totalElapsed}s)\n🔗 <a href="${solscanUrl}">View on Solscan</a>\nTransaction may still complete.`
  );
}
