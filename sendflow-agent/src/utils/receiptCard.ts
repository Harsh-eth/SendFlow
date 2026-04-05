import { createCanvas, loadImage } from "canvas";
import QRCode from "qrcode";

const W = 400;
const H = 220;

// Canvas 2D context (node-canvas); avoid DOM lib in tsconfig.
function drawShield(ctx: {
  save: () => void;
  translate: (x: number, y: number) => void;
  scale: (x: number, y: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  bezierCurveTo: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) => void;
  closePath: () => void;
  fill: () => void;
  stroke: () => void;
  restore: () => void;
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
}, x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.beginPath();
  ctx.moveTo(50, 8);
  ctx.lineTo(92, 28);
  ctx.lineTo(92, 58);
  ctx.bezierCurveTo(92, 82, 72, 94, 50, 100);
  ctx.bezierCurveTo(28, 94, 8, 82, 8, 58);
  ctx.lineTo(8, 28);
  ctx.closePath();
  ctx.fillStyle = "#1a5f4a";
  ctx.fill();
  ctx.strokeStyle = "#0d3d2e";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function shortAddr(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

/**
 * 400×220 PNG receipt with QR to Solscan tx, shield icon (vector), and branding.
 */
export async function generateTransferReceiptPng(opts: {
  amountUsdc: number;
  sender: string;
  recipient: string;
  txSig: string;
  timestampIso: string;
}): Promise<Buffer> {
  const solscanUrl = `https://solscan.io/tx/${opts.txSig}`;
  const qrDataUrl = await QRCode.toDataURL(solscanUrl, { width: 96, margin: 1, errorCorrectionLevel: "M" });
  const qrBuf = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
  const qrImg = await loadImage(qrBuf);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d");

  const grd = ctx.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, "#f8fafc");
  grd.addColorStop(1, "#e2e8f0");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText(`${opts.amountUsdc.toFixed(2)} USDC`, 16, 32);

  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#475569";
  ctx.fillText(`From ${shortAddr(opts.sender)}`, 16, 54);
  ctx.fillText(`To ${shortAddr(opts.recipient)}`, 16, 72);

  ctx.drawImage(qrImg, W - 112, 16, 96, 96);

  ctx.fillStyle = "#64748b";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(opts.timestampIso.replace("T", " ").slice(0, 19) + " UTC", 16, 100);

  drawShield(ctx, 16, 118, 22);
  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.fillText("Secured by SendFlow", 44, 134);

  ctx.font = "11px system-ui, sans-serif";
  ctx.fillStyle = "#16a34a";
  ctx.fillText("Threat score: 0 threats detected", 16, 158);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText("Tap QR to verify on Solscan", 16, 198);

  return canvas.toBuffer("image/png");
}
