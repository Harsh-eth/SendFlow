import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Connection } from "@solana/web3.js";
import type { IAgentRuntime } from "@elizaos/core";
import { log } from "../utils/structuredLogger";
import { getPaymentPageHtml } from "../utils/paymentPage";
import { buildSendFlowMetrics } from "../utils/growthMetrics";
import { getAllSeenUserIds } from "../utils/userRegistry";
import { renderPrometheusMetrics } from "../utils/metricsState";
import { landingPage } from "./landingPage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ogImagePath = join(__dirname, "static", "og-image.png");

export interface HealthMetrics {
  totalTransfers: number;
  totalUsers: number;
  activeSchedules: number;
  activeWatches: number;
}

export const metrics: HealthMetrics & { startedAt: number; errors: string[] } = {
  totalTransfers: 0,
  totalUsers: 0,
  activeSchedules: 0,
  activeWatches: 0,
  startedAt: Date.now(),
  errors: [],
};

export function recordError(msg: string): void {
  metrics.errors.push(`${new Date().toISOString()} ${msg}`);
  if (metrics.errors.length > 10) metrics.errors.shift();
}

export function startHealthServer(opts: {
  connection: Connection;
  runtime?: IAgentRuntime;
  getQueueSize?: () => number;
  getEscrowBalance?: () => Promise<number | null>;
  ollamaOk?: () => boolean;
  getP2pSnapshot?: () => {
    openOffers: number;
    openSellOffers: number;
    openBuyOffers: number;
    activeTrades: number;
    completedToday: number;
    volumeTodayUsdc: number;
    disputeCount: number;
  };
}): Server | null {
  const port = Number(process.env.PORT ?? 3000);
  const webappPath = join(__dirname, "..", "..", "..", "sendflow-webapp", "index.html");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/health") {
        let solanaOk = false;
        try {
          await opts.connection.getVersion();
          solanaOk = true;
        } catch {
          solanaOk = false;
        }
        const escrowBal = opts.getEscrowBalance ? await opts.getEscrowBalance() : null;
        const uptimeSec = Math.floor((Date.now() - metrics.startedAt) / 1000);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            uptime: uptimeSec,
            uptimeSec,
            solanaConnected: solanaOk,
            ollamaConnected: opts.ollamaOk?.() ?? false,
            escrowBalance: escrowBal,
            queueSize: opts.getQueueSize?.() ?? 0,
            p2p: opts.getP2pSnapshot?.() ?? null,
          })
        );
        return;
      }
      if (url.pathname.startsWith("/pay/")) {
        const pageId = (url.pathname.slice("/pay/".length) || "").split("?")[0] ?? "";
        const html = getPaymentPageHtml(pageId);
        if (html) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Payment page not found");
        return;
      }
      if (url.pathname === "/og-image.png") {
        try {
          const buf = await readFile(ogImagePath);
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
          });
          res.end(buf);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("OG image missing — run: bun run gen:og");
        }
        return;
      }
      if (url.pathname === "/metrics") {
        const wantJson =
          url.searchParams.get("format") === "json" ||
          (req.headers.accept && req.headers.accept.includes("application/json"));
        if (wantJson) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          const totalUsers = getAllSeenUserIds().length;
          const growth = buildSendFlowMetrics(totalUsers);
          res.end(
            JSON.stringify({
              totalUsers: metrics.totalUsers,
              totalTransfers: metrics.totalTransfers,
              activeSchedules: metrics.activeSchedules,
              activeWatches: metrics.activeWatches,
              uptimeSec: Math.floor((Date.now() - metrics.startedAt) / 1000),
              sendflow: growth,
            })
          );
          return;
        }
        const body = renderPrometheusMetrics();
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(body);
        return;
      }
      if (url.pathname === "/api/balance") {
        const userId = url.searchParams.get("userId");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ balance: 0, userId, note: "Use bot balance command for live USDC" }));
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(landingPage());
        return;
      }
      if (url.pathname === "/webapp") {
        try {
          const html = await readFile(webappPath, "utf8");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } catch (err) {
          log.error("health.webapp_read_failed", { path: webappPath }, err as Error);
          res.writeHead(404);
          res.end("WebApp: add sendflow-webapp/index.html");
        }
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (e) {
      log.error("health.request_failed", {}, e instanceof Error ? e : new Error(String(e)));
      res.writeHead(500);
      res.end(String(e));
    }
  });

  try {
    server.listen(port, () => {
      log.info("health.listen", { port });
    });
    return server;
  } catch (e) {
    log.warn("health.server_failed", { error: String(e) });
    return null;
  }
}
