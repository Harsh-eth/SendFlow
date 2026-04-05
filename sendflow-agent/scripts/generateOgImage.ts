/**
 * bun run gen:og — writes sendflow-agent/src/api/static/og-image.png (1200×630).
 * Update the hardcoded stats string before final submission if needed.
 */
import { createCanvas } from "canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "src", "api", "static", "og-image.png");

const W = 1200;
const H = 630;
const BG = "#512DA8";
const WHITE = "#ffffff";

const STATS_LINE = "10,000+ transfers · $50,000+ USDC · 500+ users";

async function main(): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "800 80px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("SendFlow", W / 2, H * 0.32);

  ctx.font = "500 40px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText("Send money anywhere. Just type.", W / 2, H * 0.46);

  ctx.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillText(STATS_LINE, W / 2, H * 0.72);

  const buf = canvas.toBuffer("image/png");
  await writeFile(outPath, buf);
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
