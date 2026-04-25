// Send a Pushover notification with proper UTF-8 + HTML formatting.
// Reads PUSHOVER_USER_KEY and PUSHOVER_APP_TOKEN from .env in this folder.
// Usage: node send_pushover.mjs <title> <message-html-file> [<top-url>] [<top-url-title>]

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const lines = readFileSync(resolve(HERE, ".env"), "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const [, , title, msgFile, topUrl, topUrlTitle] = process.argv;
  if (!title || !msgFile) {
    console.error("Usage: node send_pushover.mjs <title> <message-file> [<url>] [<url-title>]");
    process.exit(2);
  }

  const env = loadEnv();
  const message = readFileSync(resolve(msgFile), "utf8");

  const body = new URLSearchParams({
    token: env.PUSHOVER_APP_TOKEN,
    user: env.PUSHOVER_USER_KEY,
    title,
    message,
    html: "1",
    priority: "0",
  });
  if (topUrl) body.set("url", topUrl);
  if (topUrlTitle) body.set("url_title", topUrlTitle);

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: body.toString(),
  });
  const json = await res.json();
  console.log(JSON.stringify(json));
  if (json.status !== 1) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
