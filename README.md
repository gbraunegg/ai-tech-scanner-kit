# AI Tech Scanner Kit

Daily/weekly scanner for AI model, tooling, agent, local-inference, and automation updates.

It watches:

- Official changelog pages: Anthropic, OpenAI, Ollama
- Official GitHub releases: OpenClaw, Ollama, llama.cpp, OpenAI SDK, Anthropic SDK
- Hacker News Show HN
- Reddit AI communities
- X/Twitter via Apify (`apidojo/twitter-scraper-lite`)

It outputs:

- `alerts` — max 3 high-signal daily items
- `testQueue` — what to actually install/evaluate
- `weeklyModelStackSummary` — Monday stack recommendation summary
- `sourceStats` — proof of what was scanned
- `stack` — current model/tooling context

## Requirements

- Node.js 20+
- Optional but recommended: Apify token for X/Twitter scan

## Quick setup

```bash
git clone <YOUR_REPO_URL_OR_ZIP_EXPORT> ai-tech-scanner-kit
cd ai-tech-scanner-kit
npm install
npm run scan
cat ai-tech-scanner-output.json
```

## Add X/Twitter scanning

Create an Apify account, subscribe to/enable `apidojo/twitter-scraper-lite`, then:

```bash
export APIFY_TOKEN='apify_api_xxx'
npm run scan
```

Or store the token in a file:

```bash
mkdir -p ~/.openclaw/credentials
printf 'apify_api_xxx' > ~/.openclaw/credentials/apify_api_token
chmod 600 ~/.openclaw/credentials/apify_api_token
npm run scan
```

Without Apify, the scanner still runs official sources, GitHub releases, HN, and Reddit.

## Daily cron

```bash
crontab -e
```

Apple Silicon/Homebrew Node:

```cron
0 9 * * * cd /path/to/ai-tech-scanner-kit && /opt/homebrew/bin/node ai-tech-scanner.mjs >> scanner.log 2>&1
```

Intel/Linux Node:

```cron
0 9 * * * cd /path/to/ai-tech-scanner-kit && /usr/local/bin/node ai-tech-scanner.mjs >> scanner.log 2>&1
```

## Weekly summary test

Force weekly summary output:

```bash
FORCE_WEEKLY_SUMMARY=1 npm run scan
cat ai-tech-scanner-output.json
```

## Discord webhook example

```bash
export DISCORD_WEBHOOK_URL='https://discord.com/api/webhooks/...'
npm run scan
node -e '
const fs=require("fs");
const out=JSON.parse(fs.readFileSync("ai-tech-scanner-output.json","utf8"));
const parts=[];
if(out.weeklyModelStackSummary){parts.push("**Weekly Model Stack**\n"+out.weeklyModelStackSummary.recommendation+"\n"+out.weeklyModelStackSummary.watchAreas.join("\n"));}
if(out.testQueue?.length){parts.push("**Test Queue**\n"+out.testQueue.map((t,i)=>`${i+1}. ${t.item}\n${t.why}\n${t.url}`).join("\n\n"));}
if(out.alerts?.length){parts.push("**Daily Alerts**\n"+out.alerts.map(a=>`**${a.verdict.action}** ${a.source}: ${a.text}\nImpact: ${a.businessImpactSummary || a.testQueue}\n${a.url}`).join("\n\n"));}
if(!parts.length) process.exit(0);
fetch(process.env.DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:parts.join("\n\n")})});
'
```

## Business impact scoring

Every item is scored against:

- coding speed
- local privacy
- client dashboard leverage
- CPG use cases

This keeps the scan tied to business value instead of generic AI hype.
