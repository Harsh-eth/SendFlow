#!/usr/bin/env node
/**
 * @elizaos/plugin-telegram only subscribes to message + message_reaction.
 * SendFlow handles inline keyboards via Telegraf on the same bot — Telegram allows only
 * one getUpdates long-poll per bot, so we must include callback_query in allowedUpdates.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const candidates = [
  join(root, "node_modules", "@elizaos", "plugin-telegram", "dist", "index.js"),
  join(root, "sendflow-agent", "node_modules", "@elizaos", "plugin-telegram", "dist", "index.js"),
];

const from = 'allowedUpdates: ["message", "message_reaction"]';
const to = 'allowedUpdates: ["message", "message_reaction", "callback_query"]';

for (const p of candidates) {
  if (!existsSync(p)) continue;
  let s = readFileSync(p, "utf8");
  if (!s.includes(from)) continue;
  s = s.replace(from, to);
  writeFileSync(p, s);
  console.log("[patch] @elizaos/plugin-telegram allowedUpdates +callback_query:", p);
}
