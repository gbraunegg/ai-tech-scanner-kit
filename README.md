# AI Tech Scanner Kit

Daily scanner for AI/model/tooling updates. It watches Reddit, Hacker News, official changelog pages, and optionally X/Twitter via Apify. It writes actionable alerts to `ai-tech-scanner-output.json` so you can post them to Discord, Slack, email, or any cron runner.

## What it is good for

- Staying current on AI model releases and tooling changes
- Catching Mac/local model improvements
- Watching Claude/OpenAI/Ollama/OpenClaw-adjacent updates
- Filtering out low-value AI hype and speculation

## Requirements

- Node.js 20+
- Optional: Apify token if you want X/Twitter scraping

## Quick setup

```bash
git clone <YOUR_REPO_URL_OR_ZIP_EXPORT> ai-tech-scanner-kit
cd ai-tech-scanner-kit
npm install
npm run scan
cat ai-tech-scanner-output.json
```

If you have Apify:

```bash
mkdir -p ~/.openclaw/credentials
printf 'YOUR_APIFY_TOKEN' > ~/.openclaw/credentials/apify_api_token
chmod 600 ~/.openclaw/credentials/apify_api_token
npm run scan
```

No Apify is fine — Reddit, HN, and official changelog checks still run.

## Cron setup on macOS/Linux

Run daily at 9am:

```bash
crontab -e
```

Add:

```cron
0 9 * * * cd /path/to/ai-tech-scanner-kit && /usr/local/bin/node ai-tech-scanner.mjs >> scanner.log 2>&1
```

On Apple Silicon Homebrew, Node may be:

```cron
0 9 * * * cd /path/to/ai-tech-scanner-kit && /opt/homebrew/bin/node ai-tech-scanner.mjs >> scanner.log 2>&1
```

## Discord posting options

### If using OpenClaw

Create an OpenClaw cron that runs:

```bash
node /path/to/ai-tech-scanner-kit/ai-tech-scanner.mjs
```

Then read `ai-tech-scanner-output.json` and deliver the final assistant response to your Discord channel via cron delivery. Do not rely on an agent calling a message tool.

### If not using OpenClaw

Use the output JSON with a tiny webhook poster. Example:

```bash
node ai-tech-scanner.mjs
node -e '
const fs=require("fs");
const out=JSON.parse(fs.readFileSync("ai-tech-scanner-output.json","utf8"));
if(!out.alerts?.length) process.exit(0);
const body={content:"**🤖 AI Stack Scan**\n"+out.alerts.map(a=>`**${a.verdict.action}** | ${a.source} | ${a.text.slice(0,180)} | **Why:** ${a.verdict.reason} | ${a.url}`).join("\n\n")};
fetch(process.env.DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
'
```

Set your webhook once:

```bash
export DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'
```

## Recommended improvements

1. Add official release feeds first: Anthropic, OpenAI, Google DeepMind, Ollama, llama.cpp, OpenClaw.
2. Add a weekly model benchmark summary instead of only daily alerts.
3. Maintain a local `model-spec-sheet.md` with current best model by use case.
4. Require an action label for every alert: TEST NOW, EVALUATE, MONITOR, FYI.
5. Filter rumors, subscription chatter, and generic AI takes.
6. Keep max 3 alerts/day so the channel stays high-signal.

## Files

- `ai-tech-scanner.mjs` — scanner
- `ai-tech-scanner-output.json` — generated output
- `ai-tech-scanner-state.json` — generated state/deduping
- `README.md` — setup
