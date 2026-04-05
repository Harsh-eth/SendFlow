import { createCanvas } from "canvas";

export async function generateStatusCard(
  userId: string,
  balance: number,
  totalSent: number,
  totalReceived: number,
  creditScore: number,
  username?: string
): Promise<Buffer> {
  const canvas = createCanvas(400, 220);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 400, 220);
  grad.addColorStop(0, "#0f0c29");
  grad.addColorStop(1, "#302b63");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 400, 220);

  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("⚡ SendFlow", 20, 35);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px sans-serif";
  ctx.fillText(username ? `sendflow/${username}` : `User ${userId.slice(0, 8)}`, 20, 60);

  ctx.fillStyle = "#00ff88";
  ctx.font = "bold 36px sans-serif";
  ctx.fillText(`${balance.toFixed(2)} USDC`, 20, 110);

  ctx.fillStyle = "#aaaaaa";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Sent: ${totalSent.toFixed(2)} USDC`, 20, 145);
  ctx.fillText(`Received: ${totalReceived.toFixed(2)} USDC`, 150, 145);
  ctx.fillText(`Credit: ${creditScore}/100`, 300, 145);

  ctx.fillStyle = "#9945ff";
  ctx.fillRect(20, 170, 100, 28);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("Built on Solana", 28, 188);

  ctx.fillStyle = "#00ff88";
  ctx.fillRect(130, 170, 120, 28);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText("Powered by Nosana", 136, 188);

  return canvas.toBuffer("image/png");
}
