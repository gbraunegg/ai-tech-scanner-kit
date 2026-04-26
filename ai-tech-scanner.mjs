#!/usr/bin/env node
/**
 * AI Tech Stack Scanner
 * Monitors Twitter/X accounts + Reddit for new AI models, tools, and capabilities
 * that could improve our stack or make us money.
 *
 * Sources:
 * - Twitter: @thestreamingdev, @karpathy, @sama, @demishassabis, @anthropic,
 *             @ggerganov, @ollama, @OpenAI, @GoogleDeepMind, @huggingface
 * - Reddit: r/LocalLLaMA, r/MachineLearning, r/artificial
 *
 * Evaluates each finding against our tech stack context and posts actionable
 * recommendations to #dev-updates. Noise is filtered — only post if it's
 * genuinely relevant to: (1) local models, (2) CPG tools, (3) our SaaS stack,
 * (4) coding agents, (5) automation/workflow tools.
 *
 * Run: node scripts/ai-tech-scanner.mjs
 * Cron: Daily at 8 AM ET
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.AI_TECH_SCANNER_WORKSPACE || __dirname;
const STATE_FILE = path.join(WORKSPACE, 'ai-tech-scanner-state.json');
const OUTPUT_FILE = path.join(WORKSPACE, 'ai-tech-scanner-output.json');
const APIFY_TOKEN_FILE = process.env.APIFY_TOKEN_FILE || path.join(process.env.HOME || '.', '.openclaw/credentials/apify_api_token');

// Twitter accounts to monitor for AI/model releases (used in Pass 2 via Apify)
const TWITTER_ACCOUNTS = [
  { handle: 'AnthropicAI', focus: 'Anthropic releases (primary)' },
  { handle: 'claude_code', focus: 'Claude Code product updates' },
  { handle: 'simonw', focus: 'practical LLM tooling, Claude assessments' },
  { handle: 'swyx', focus: 'AI engineering, agent patterns' },
  { handle: 'mattshumer_', focus: 'Claude-based products' },
  { handle: 'karpathy', focus: 'foundational AI research' },
  { handle: 'OpenAI', focus: 'OpenAI releases (secondary)' },
  { handle: 'GoogleDeepMind', focus: 'frontier model research' },
];

// Reddit communities to scan
const SUBREDDITS = [
  { name: 'ClaudeAI', focus: 'Anthropic updates, Claude Code patterns' },
  { name: 'AI_Agents', focus: 'agent frameworks and patterns' },
  { name: 'MachineLearning', focus: 'major model releases (filtered hard)' },
  { name: 'OpenAI', focus: 'OpenAI releases (secondary)' },
];

// HackerNews "Show HN" — builders post new tools here before Twitter
const HN_QUERIES = [
  'Show HN: claude', 'Show HN: agent', 'Show HN: slack',
  'Show HN: AI', 'Show HN: llm',
];

// YouTube channels to monitor. Each channel publishes an RSS feed at
// https://www.youtube.com/feeds/videos.xml?channel_id=UC...
// Morning session filters out Shorts via title heuristics + judgment.
const YOUTUBE_CHANNELS = [
  { channelId: 'UCNJ1Ymd5yFuUPtn21xtRbbw', name: 'AI Explained', focus: 'paper breakdowns, deep AI announcements' },
  { channelId: 'UCawZsQWqfGSbCI5yjkdVkTA', name: 'Matthew Berman', focus: 'daily AI news roundups, agent demos' },
  { channelId: 'UC_x36zCEGilGpB1m-V4gmjg', name: 'Indy Dev Dan', focus: 'Claude Code / agent workflow tutorials' },
  { channelId: 'UC55ODQSvARtgSyc8ThfiepQ', name: 'Sam Witteveen', focus: 'practical agent / LangChain tutorials' },
  { channelId: 'UCrDwWp7EBBv4NwvScIpBDOA', name: 'Anthropic', focus: 'official Claude launches and demos' },
  { channelId: 'UCqcbQf6yw5KzRoDDcZ_wBSw', name: 'Wes Roth', focus: 'AI news with depth' },
  { channelId: 'UCR9j1jqqB5Rse69wjUnbYwA', name: 'All About AI', focus: 'agent tutorials, automation walkthroughs' },
  { channelId: 'UCPjNBjflYl0-HQtUvOx0Ibw', name: 'Greg Isenberg', focus: 'AI startup / product ideas, founder interviews, indie hacking' },
  { channelId: 'UCfQNB91qRP_5ILeu_S_bSkg', name: 'Alex Finn', focus: 'AI tools, prompts, agent demos, vibe coding' },
];

// RSS / Atom feeds — high-signal AI engineering sources.
// These return structured items so we can pull title + URL + body cleanly.
const RSS_FEEDS = [
  {
    url: 'https://www.latent.space/feed',
    name: 'Latent Space',
    focus: 'AI engineering daily digest (swyx + Alessio)',
  },
  {
    url: 'https://simonwillison.net/atom/everything/',
    name: 'Simon Willison',
    focus: 'practical LLM tooling, Claude assessments, agent patterns',
  },
];

// Changelog sources to monitor (Anthropic primary, OpenAI secondary)
const CHANGELOG_URLS = [
  {
    url: 'https://www.anthropic.com/news',
    name: 'Anthropic News',
    stateKey: 'anthropic_last_item'
  },
  {
    url: 'https://docs.claude.com/en/release-notes/claude-code',
    name: 'Claude Code Release Notes',
    stateKey: 'claude_code_release_notes'
  },
  {
    url: 'https://openai.com/news/',
    name: 'OpenAI News',
    stateKey: 'openai_last_item'
  },
];

// Official GitHub releases to monitor. These are higher-signal than social feeds.
const GITHUB_RELEASE_REPOS = [
  { repo: 'anthropics/claude-code', name: 'Claude Code GitHub Releases', impact: 'primary CLI' },
  { repo: 'anthropics/anthropic-sdk-python', name: 'Anthropic Python SDK Releases', impact: 'Python integration' },
  { repo: 'anthropics/anthropic-sdk-typescript', name: 'Anthropic TS SDK Releases', impact: 'TS integration' },
  { repo: 'modelcontextprotocol/servers', name: 'MCP Servers Releases', impact: 'tool integrations' },
  { repo: 'slackapi/bolt-python', name: 'slack-bolt Python Releases', impact: 'Slack bot framework' },
];

// Business-impact axes — what actually moves the needle for Xero Solar's agent stack
const BUSINESS_IMPACT_WEIGHTS = {
  // Anything that makes Claude Code / sub-agents / orchestration faster or more reliable
  agentVelocity: ['claude code', 'sub-agent', 'subagent', 'agent sdk', 'mcp', 'tool use', 'tool call', 'function calling', 'agent', 'orchestrat', 'skill', 'hook'],
  // Anything that touches the Slack bot framework, Python automation, Excel pipeline
  pythonAutomation: ['python', 'slack', 'slack-bolt', 'socket mode', 'openpyxl', 'excel', 'pywin32', 'windows', 'pdfplumber', 'automation', 'workflow', 'cron', 'schedul'],
  // Anything Anthropic-specific (model releases, post-mortems, pricing, API changes)
  anthropicNews: ['anthropic', 'claude', 'sonnet', 'opus', 'haiku', 'post-mortem', 'postmortem', 'pricing', 'rate limit', 'context window'],
  // Solar-industry AI tooling — rare but always relevant
  solarDomain: ['solar', 'photovoltaic', 'pv ', 'nem ', 'tou-', 'utility', 'sce ', 'ladwp', 'tariff', 'energy storage', 'battery'],
};

// Model spec sheet path — living doc that gets updated weekly
const MODEL_SPEC_FILE = path.join(WORKSPACE, 'model-spec-sheet.md');

// Keywords that signal something worth evaluating
const SIGNAL_KEYWORDS = [
  // Anthropic / Claude (primary stack)
  'claude', 'anthropic', 'sonnet', 'opus', 'haiku', 'claude code',
  // Releases / changes worth knowing about
  'release', 'launches', 'new model', 'just released', 'now available',
  'post-mortem', 'postmortem', 'incident', 'pricing', 'rate limit',
  // Agent / SDK capability signals
  'agent', 'agentic', 'sub-agent', 'subagent', 'agent sdk', 'mcp', 'model context protocol',
  'tool use', 'tool call', 'function calling', 'skill', 'hook', 'orchestrator',
  // Automation stack relevant to Xero Solar
  'slack', 'slack-bolt', 'socket mode', 'python', 'openpyxl', 'excel', 'pywin32', 'cron', 'scheduled',
  // Other models worth tracking (secondary)
  'gpt', 'gemini', 'deepseek', 'qwen',
  // Capability signals
  'beats', 'outperforms', 'sota', 'faster', 'cheaper',
  'multimodal', 'vision', 'coding', 'long context',
];

// Keywords that make something likely NOT worth posting (noise filter)
const NOISE_KEYWORDS = [
  // Academic / theoretical (not actionable for an internal-tooling shop)
  'papers', 'survey', 'theoretical', 'academic', 'dataset', 'benchmark only',
  // GPU-only / cloud-only that doesn't apply to a Windows + Claude Code stack
  'requires a100', 'requires h100', 'requires 80gb', 'cloud only',
  // Mac-only content (George runs Windows, no Mac Mini)
  'mac mini', 'apple silicon', 'mlx', 'core ml', 'metal performance',
  // Local-LLM hardware content (no local LLMs in production)
  'llama.cpp', 'gguf', 'ollama', 'lm studio', 'local model', 'local inference',
  // Business / political noise
  'political', 'layoffs', 'valuation', 'stock', 'ipo', 'fundraise',
  // Speculation / vibes / rumors
  'should i continue', 'subscription', 'rumor', 'leak', 'anyone else',
  'is a decent', 'when will', 'coming or should', 'what do you think',
  // Beginner Q&A noise (e.g. "How to start with Claude Code", "first things to do")
  'how to start', 'first things to do', 'recommendations for me',
  'help me get started', 'best way to learn', 'where do i begin',
  'how do you learn', 'tips for a beginner', 'just getting started',
  // Sponsored YouTube content
  'sign up for free to', 'this video is sponsored', 'try out freebuff',
  'use code', 'promo code', 'limited time offer', 'affiliate link',
  // Crypto / NFT / generic AI ethics op-eds
  'crypto', 'nft', 'web3', 'blockchain', 'token launch',
];

// Our current tech stack — used for relevance evaluation
const OUR_STACK = {
  primaryModel: 'anthropic/claude-sonnet (via Claude Code, Max subscription)',
  fallbacks: [
    'anthropic/claude-opus (architectural decisions)',
    'anthropic/claude-haiku (cheap lookups)',
  ],
  platform: 'Windows 11 Pro — no Mac, no local LLMs in production',
  language: 'Python 3.11+',
  tools: ['Claude Code', 'gh (GitHub CLI)', 'slack-bolt (Socket Mode)', 'openpyxl', 'pdfplumber', 'pywin32 (Excel COM)', 'python-dotenv'],
  agents: [
    'Procurement Agent (BOM, supplier approvals, catalog)',
    'Personal Assistant (executive briefings)',
    'Existing Client Agent (SCE TOU + LADWP R-1A analysis)',
    'Non Export Agent (battery-only solar valuation)',
    'Business Development Agent (lead assignment)',
    'USC + Capstone graders',
  ],
  domain: 'Solar industry — TOU rate analysis, NEM, SCE/LADWP, PV systems',
};

function scoreBusinessImpact(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [key, terms] of Object.entries(BUSINESS_IMPACT_WEIGHTS)) {
    scores[key] = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
  }
  // Weight: agent velocity + Anthropic news matter most; Python automation is direct-impact;
  // solar domain is rare-but-always-relevant.
  const total = (scores.agentVelocity * 3) + (scores.anthropicNews * 3) + (scores.pythonAutomation * 2) + (scores.solarDomain * 4);
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'agentVelocity';
  return { ...scores, total, top };
}

function summarizeBusinessImpact(impact) {
  const labels = {
    agentVelocity: 'agent / Claude Code velocity',
    pythonAutomation: 'Python + Slack + Excel automation',
    anthropicNews: 'Anthropic / Claude news',
    solarDomain: 'solar industry tooling',
  };
  const ordered = Object.entries(impact)
    .filter(([k, v]) => ['agentVelocity', 'pythonAutomation', 'anthropicNews', 'solarDomain'].includes(k) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => labels[k]);
  return ordered.length ? ordered.slice(0, 2).join(' + ') : 'general AI stack awareness';
}

// Relevance scoring — how much does this matter for George's stack?
function scoreRelevance(text, source) {
  let score = 0;
  const lower = text.toLowerCase();
  const officialSource = /Anthropic|OpenAI|GitHub|HackerNews|Latent Space|Simon Willison|YouTube\//i.test(source || '');

  // Official release/changelog sources are more actionable than speculation.
  if (officialSource) score += 2;

  // Question/speculation threads are usually noisy unless they include hard release details.
  const speculative = /\b(should i|is .* coming|anyone else|what do you think|rumou?r|leak|subscription)\b/i.test(lower);
  if (speculative && !/released|launch|available|github|post-mortem|incident|changelog/i.test(lower)) score -= 4;

  // PRIMARY STACK: Anthropic / Claude / Claude Code — top priority
  if (lower.includes('claude code')) score += 5;
  if (lower.includes('anthropic') || lower.includes('claude')) score += 3;
  if (lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku')) score += 2;
  if (lower.includes('mcp') || lower.includes('model context protocol')) score += 3;
  if (lower.includes('agent sdk') || lower.includes('sub-agent') || lower.includes('subagent')) score += 3;
  if (lower.includes('post-mortem') || lower.includes('postmortem') || lower.includes('incident')) score += 4;

  // AGENT PATTERNS — orchestration, hooks, skills, scheduled tasks
  if (lower.includes('orchestrator') || lower.includes('skill') || lower.includes('hook')) score += 2;
  if (lower.includes('tool use') || lower.includes('tool call') || lower.includes('function calling')) score += 2;

  // AUTOMATION STACK — Slack bots, Python, Excel
  if (lower.includes('slack-bolt') || lower.includes('socket mode')) score += 3;
  if (lower.includes('slack') && lower.includes('bot')) score += 2;
  if (lower.includes('python') && (lower.includes('automation') || lower.includes('agent'))) score += 2;
  if (lower.includes('openpyxl') || lower.includes('pywin32') || lower.includes('excel automation')) score += 3;
  if (lower.includes('windows') && (lower.includes('python') || lower.includes('agent'))) score += 1;

  // SOLAR DOMAIN — rare but always relevant
  if (lower.includes('solar') || lower.includes('photovoltaic')) score += 4;
  if (lower.includes('tou-') || lower.includes('nem 3') || lower.includes('ladwp') || lower.includes('sce ')) score += 4;

  // MEDIUM: capability signals, new models worth tracking
  if (lower.includes('release') || lower.includes('launches') || lower.includes('now available')) score += 2;
  if (lower.includes('faster') || lower.includes('cheaper') || lower.includes('pricing')) score += 1;

  // LOW: secondary models worth knowing about
  if (lower.includes('gpt') || lower.includes('openai')) score += 1;
  if (lower.includes('gemini') || lower.includes('deepseek')) score += 1;

  // Mac / local-LLM / hardware-specific content — actively unhelpful for this stack
  if (lower.includes('mac mini') || lower.includes('apple silicon') || lower.includes('mlx')) score -= 3;
  if (lower.includes('llama.cpp') || lower.includes('ollama') || lower.includes('gguf')) score -= 2;
  if (lower.includes('m4 max') || lower.includes('m3 ultra')) score -= 2;

  // Business-impact axes (already weighted in scoreBusinessImpact)
  score += Math.min(6, scoreBusinessImpact(text).total);

  // Noise reduction
  if (NOISE_KEYWORDS.some(n => lower.includes(n))) score -= 3;
  if (lower.includes('requires') && (lower.includes('a100') || lower.includes('h100') || lower.includes('80gb'))) score -= 5;

  return score;
}

function generateVerdict(text, score) {
  const lower = text.toLowerCase();

  if (score >= 6) {
    if (lower.includes('claude code')) {
      return { action: '🔴 EVALUATE', reason: 'Directly affects Claude Code — the primary CLI for every Xero Solar agent.' };
    }
    if (lower.includes('anthropic') || lower.includes('claude') || lower.includes('mcp')) {
      return { action: '🔴 EVALUATE', reason: 'Directly affects the Anthropic / Claude stack.' };
    }
    if (lower.includes('slack-bolt') || (lower.includes('slack') && lower.includes('bot'))) {
      return { action: '🔴 EVALUATE', reason: 'Touches the Slack bot framework used across the agent stack.' };
    }
    if (lower.includes('solar') || lower.includes('photovoltaic') || lower.includes('nem ') || lower.includes('ladwp') || lower.includes('sce ')) {
      return { action: '🔴 EVALUATE', reason: 'Solar industry tooling — rare and directly relevant.' };
    }
    return { action: '🟡 EVALUATE', reason: 'High relevance to the stack. Worth a closer look.' };
  }

  if (score >= 3) {
    if (lower.includes('agent') || lower.includes('orchestrat')) {
      return { action: '🟡 MONITOR', reason: 'Could inform the orchestrator / sub-agent patterns. Watch for adoption.' };
    }
    return { action: '🟡 MONITOR', reason: 'Relevant to our direction. Track for 30 days.' };
  }

  return { action: '🟢 FYI', reason: 'Noteworthy but not actionable for us yet.' };
}

function loadState() {
  if (!existsSync(STATE_FILE)) {
    return { seenIds: [], lastRun: null, postsToday: 0, postDate: null };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { seenIds: [], lastRun: null, postsToday: 0, postDate: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function scrapeReddit(subreddit) {
  // Use Reddit's JSON API directly — no Apify needed, free and fast
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=15`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`Reddit API failed for r/${subreddit}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const posts = data?.data?.children || [];
    return posts.map(p => ({
      id: `reddit_${subreddit}_${p.data.id}`,
      text: `${p.data.title || ''} ${p.data.selftext || ''}`.trim().slice(0, 500),
      url: `https://reddit.com${p.data.permalink}`,
      source: `r/${subreddit}`,
      score: p.data.score || 0,
      createdAtMs: (p.data.created_utc || 0) * 1000,
    }));
  } catch (e) {
    console.error(`Reddit scrape error for r/${subreddit}: ${e.message}`);
    return [];
  }
}

async function scrapeTwitterAccounts() {
  // X/Twitter scanning via Apify. Uses the no-minimum "twitter-scraper-lite" actor.
  // Cost guard: one query, max 40 items, high-signal accounts only.
  if (!existsSync(APIFY_TOKEN_FILE) && !process.env.APIFY_TOKEN) return [];
  const token = process.env.APIFY_TOKEN || readFileSync(APIFY_TOKEN_FILE, 'utf8').trim();
  const results = [];
  const handles = TWITTER_ACCOUNTS.map(a => `from:${a.handle}`).join(' OR ');
  const query = `(claude OR gpt OR openai OR anthropic OR ollama OR mlx OR llama.cpp OR agent OR codex OR "Claude Code" OR "model release") (${handles}) -filter:retweets lang:en`;

  try {
    const url = `https://api.apify.com/v2/acts/apidojo~twitter-scraper-lite/run-sync-get-dataset-items?token=${token}&timeout=90`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchTerms: [query],
        sort: 'Latest',
        maxItems: 40,
        tweetLanguage: 'en',
        includeSearchTerms: false,
      }),
      signal: AbortSignal.timeout(100000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`X scrape failed: ${response.status} ${body.slice(0, 180)}`);
      return results;
    }

    const data = await response.json();
    for (const tweet of (data || []).slice(0, 40)) {
      const handle = (tweet.author?.userName || tweet.user?.screen_name || tweet.author?.screen_name || 'unknown').toLowerCase();
      results.push({
        id: `x_${handle}_${tweet.id || tweet.tweetId || tweet.url || Date.now()}`,
        text: tweet.text || tweet.fullText || tweet.content || '',
        url: tweet.url || tweet.twitterUrl || tweet.tweetUrl || `https://x.com/${handle}`,
        source: `X/@${handle}`,
        likes: tweet.likeCount || tweet.favorite_count || 0,
        createdAtMs: tweet.createdAt ? Date.parse(tweet.createdAt) : 0,
      });
    }
  } catch (e) {
    console.error(`X batch error: ${e.message}`);
  }

  return results;
}

async function scrapeHackerNews() {
  // Use HN Algolia API — no Apify needed, fast and free
  const results = [];
  try {
    const queries = ['llm local mac', 'new AI model', 'claude anthropic', 'llama.cpp mlx', 'AI agent tool'];
    for (const q of queries.slice(0, 2)) { // limit to 2 queries
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=show_hn,story&hitsPerPage=5`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const hit of (data.hits || [])) {
        results.push({
          id: `hn_${hit.objectID}`,
          text: `${hit.title || ''} ${hit.story_text || ''}`.slice(0, 500),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: 'HackerNews Show HN',
          hnScore: hit.points || 0,
          createdAtMs: (hit.created_at_i || 0) * 1000,
        });
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    console.error('HN scrape error:', e.message);
  }
  return results;
}

async function scrapeRssFeeds() {
  // Pull recent items from RSS/Atom feeds. Zero-dep: regex extraction of
  // <item>/<entry> blocks. Good enough for Substack and standard atom feeds.
  const results = [];
  for (const feed of RSS_FEEDS) {
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-scanner/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        console.error(`RSS fetch failed for ${feed.name}: ${resp.status}`);
        continue;
      }
      const xml = await resp.text();

      // Match either <item>...</item> (RSS) or <entry>...</entry> (Atom).
      const blockRegex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let match;
      let count = 0;
      while ((match = blockRegex.exec(xml)) !== null && count < 8) {
        const block = match[2];
        const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
        // Atom uses <link href="..."/>; RSS uses <link>...</link>
        const linkAttr = (block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i) || [])[1];
        const linkText = (block.match(/<link[^>]*>([^<]+)<\/link>/i) || [])[1];
        const link = (linkAttr || linkText || '').trim();
        const description = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1]
          || (block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) || [])[1]
          || '';
        const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]
          || (block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]
          || (block.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]
          || '';

        const cleanTitle = title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
        const cleanDesc = description.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanTitle || !link) continue;

        const idHash = `${feed.name}_${link}`.replace(/[^a-z0-9_]+/gi, '_').slice(0, 120);
        results.push({
          id: `rss_${idHash}`,
          text: `${cleanTitle} — ${cleanDesc.slice(0, 400)}`.trim(),
          url: link,
          source: feed.name,
          createdAtMs: pubDate ? Date.parse(pubDate.trim()) || 0 : 0,
        });
        count++;
      }
    } catch (e) {
      console.error(`RSS error for ${feed.name}: ${e.message}`);
    }
  }
  return results;
}

async function scrapeYouTube() {
  // Pull the 3 most recent uploads from each curated channel via RSS.
  // No auth, no API key. Items get kind: 'video' so the morning session
  // can pull them into their own "Worth Watching" section.
  const results = [];
  for (const ch of YOUTUBE_CHANNELS) {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-scanner/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        console.error(`YouTube RSS failed for ${ch.name}: ${resp.status}`);
        continue;
      }
      const xml = await resp.text();
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      let count = 0;
      while ((m = entryRegex.exec(xml)) !== null && count < 3) {
        const block = m[1];
        const title = ((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim();
        const linkAttr = (block.match(/<link\s+rel="alternate"\s+href="([^"]+)"/) || [])[1] || '';
        const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1] || '';
        const published = (block.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
        const description = (block.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
        if (!title || !linkAttr) continue;

        // Heuristic: drop obvious Shorts. Hashtag in title or "shorts" in URL path.
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('#shorts') || lowerTitle.includes('#short')) continue;
        if (linkAttr.includes('/shorts/')) continue;

        const cleanDesc = description.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/\s+/g, ' ').trim();
        results.push({
          id: `yt_${videoId || ch.channelId}_${Date.parse(published) || Date.now()}`,
          text: `${title} — ${cleanDesc.slice(0, 400)}`,
          url: linkAttr,
          source: `YouTube/${ch.name}`,
          kind: 'video',
          createdAtMs: published ? Date.parse(published) || 0 : 0,
        });
        count++;
      }
    } catch (e) {
      console.error(`YouTube error for ${ch.name}: ${e.message}`);
    }
  }
  return results;
}

async function checkGitHubReleases(state) {
  const alerts = [];
  for (const source of GITHUB_RELEASE_REPOS) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${source.repo}/releases?per_page=3`, {
        headers: { 'User-Agent': 'XeroSolar-AI-Tech-Scanner/1.0', 'Accept': 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        console.error(`GitHub release check failed for ${source.repo}: ${resp.status}`);
        continue;
      }
      const releases = await resp.json();
      const latest = (releases || []).find(r => !r.draft) || releases?.[0];
      if (!latest) continue;
      const key = `github_${source.repo.replace('/', '_')}_latest`;
      const fingerprint = `${latest.id || latest.tag_name}:${latest.published_at || latest.created_at}`;
      const last = state[key] || '';
      if (fingerprint !== last && last !== '') {
        const text = `${source.name}: ${latest.name || latest.tag_name} — ${(latest.body || '').replace(/\s+/g, ' ').slice(0, 240)}`;
        const impact = scoreBusinessImpact(`${text} ${source.impact}`);
        alerts.push({
          id: `github_${source.repo}_${latest.id || latest.tag_name}`,
          text,
          url: latest.html_url,
          source: source.name,
          relevanceScore: 8 + Math.min(5, impact.total),
          businessImpact: impact,
          verdict: { action: '🔴 EVALUATE', reason: `Official ${source.name} update. Review for ${source.impact}.` },
        });
      }
      state[key] = fingerprint;
    } catch (e) {
      console.error(`GitHub release error for ${source.repo}: ${e.message}`);
    }
  }
  return alerts;
}

async function checkChangelogs(state) {
  const alerts = [];
  for (const changelog of CHANGELOG_URLS) {
    try {
      const resp = await fetch(changelog.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-scanner/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) continue;
      const text = await resp.text();

      // Simple extraction: look for article titles / h2 / h3 headings
      const matches = text.match(/<h[23][^>]*>([^<]+)<\/h[23]>/gi) || [];
      const titles = matches.slice(0, 5).map(m => m.replace(/<[^>]+>/g, '').trim());

      if (titles.length === 0) continue;

      const fingerprint = titles.join('|');
      const lastFingerprint = state[changelog.stateKey] || '';

      if (fingerprint !== lastFingerprint && lastFingerprint !== '') {
        // Something changed — new content detected
        const newTitles = titles.filter(t => !lastFingerprint.includes(t));
        if (newTitles.length > 0) {
          const alertText = `NEW from ${changelog.name}: ${newTitles.join(' | ')}`;
          const impact = scoreBusinessImpact(alertText);
          alerts.push({
            id: `changelog_${changelog.stateKey}_${Date.now()}`,
            text: alertText,
            url: changelog.url,
            source: changelog.name,
            relevanceScore: 6 + Math.min(5, impact.total),
            businessImpact: impact,
            verdict: { action: '🔴 EVALUATE', reason: `${changelog.name} published new content. Review for updates affecting our stack.` }
          });
        }
      }

      state[changelog.stateKey] = fingerprint;
    } catch (e) {
      console.error(`Changelog check error for ${changelog.name}: ${e.message}`);
    }
  }
  return alerts;
}

async function updateModelSpecSheet() {
  // Best-effort model spec update — fetch current top models from HN + LocalLLaMA context
  const today = new Date().toISOString().slice(0, 10);

  const spec = `# Model Spec Sheet — Last Updated: ${today}
*Auto-updated by ai-tech-scanner. Edit manually to add context.*

## Our Primary Stack
| Role | Model | Where | Cost |
|---|---|---|---|
| Default | anthropic/claude-sonnet | Claude Code (Max subscription) | flat-rate |
| Architectural | anthropic/claude-opus | Claude Code (Max subscription) | flat-rate |
| Cheap lookups | anthropic/claude-haiku | Claude Code (Max subscription) | flat-rate |

## Platform
- **OS:** Windows 11 Pro
- **Shell:** PowerShell for startup scripts
- **Python:** 3.11+ across all agents
- **Excel automation:** pywin32 (Excel COM) — Procurement, Existing Client agents
- **Slack framework:** slack-bolt (Socket Mode)
- **No Mac, no local LLMs in production**

## Active Agents
| Agent | Purpose |
|---|---|
| Procurement Agent | BOM intake, supplier approvals, catalog management |
| Personal Assistant | Executive daily briefings, calendar, email triage |
| Existing Client Agent (SCE) | TOU-D-PRIME / TOU-D-4-9PM performance reviews |
| Existing Client Agent (LADWP) | R-1A rate analysis |
| Non Export Agent | Battery-only solar valuation |
| Business Development Agent | Lead assignment, prospect tracking |
| USC + Capstone graders | Marshall capstone slide-deck rubric grading |

## Best Models by Use Case (as of ${today})
| Use Case | Choice | Why |
|---|---|---|
| Code / agent work | claude-sonnet (Claude Code) | Default — Max subscription covers it |
| Cross-cutting architecture | claude-opus | Higher reasoning, used sparingly |
| Cheap lookups | claude-haiku | Sub-agent dispatch for trivial reads |
| Solar telemetry analysis | claude-sonnet | Inline reasoning over Powerhub CSVs |
| Slack bot conversations | claude-sonnet (via Claude Code session) | Same default, no separate API |

## Tools to Watch
| Tool | Status | Relevance |
|---|---|---|
| Claude Code | Active — primary CLI | High — every agent runs on it |
| MCP (Model Context Protocol) | Active — Anthropic standard | High — Slack + scheduled-tasks MCPs in use |
| Anthropic Agent SDK | Active | High — orchestrator + sub-agent patterns |
| slack-bolt (Python) | Active | High — every Slack bot uses this |
| openpyxl + pywin32 | Active | High — Excel automation across agents |

*This file is auto-updated weekly. Edit by hand to add context.*
`;

  try {
    writeFileSync(MODEL_SPEC_FILE, spec);
    console.log('Model spec sheet updated:', MODEL_SPEC_FILE);
  } catch (e) {
    console.error('Failed to write model spec sheet:', e.message);
  }
}

function buildTestQueue(alerts) {
  return alerts
    .filter(a => /TEST NOW|EVALUATE/.test(a.verdict?.action || ''))
    .slice(0, 5)
    .map(a => ({
      item: a.text.slice(0, 140),
      source: a.source,
      url: a.url,
      why: a.verdict?.reason || 'Potentially relevant',
      businessImpact: summarizeBusinessImpact(a.businessImpact || scoreBusinessImpact(a.text || '')),
    }));
}

function buildWeeklyModelStackSummary(alerts) {
  const today = new Date().toISOString().slice(0, 10);
  const agentHits = alerts.filter(a => (a.businessImpact?.agentVelocity || 0) > 0 || /claude code|sub-agent|mcp|agent sdk/i.test(a.text || ''));
  const automationHits = alerts.filter(a => (a.businessImpact?.pythonAutomation || 0) > 0 || /slack|python|excel|openpyxl/i.test(a.text || ''));
  const officialHits = alerts.filter(a => /GitHub Releases|Anthropic News|Claude Code Release Notes|OpenAI News/i.test(a.source || ''));
  return {
    date: today,
    recommendation: 'Keep Claude Code (Max subscription) as primary. Evaluate Anthropic releases and Claude Code changelog entries immediately; weigh agent-pattern + Slack-bot tooling against the Procurement / Existing Client / Personal Assistant agents.',
    watchAreas: [
      `${officialHits.length} official-source update(s) detected`,
      `${codingHits.length} coding-agent/tooling candidate(s)`,
      `${localHits.length} local/privacy candidate(s)`,
    ],
    currentStack: OUR_STACK,
  };
}

async function main() {
  console.log('AI Tech Scanner running...');
  const state = loadState();

  // Update today's date tracking
  const today = new Date().toISOString().slice(0, 10);
  if (state.postDate !== today) {
    state.postsToday = 0;
    state.postDate = today;
  }

  const MAX_POSTS_PER_DAY = 5; // Cap re-runs per day
  if (state.postsToday >= MAX_POSTS_PER_DAY) {
    console.log(`Already posted ${state.postsToday} times today. Skipping.`);
    saveState(state);
    writeFileSync(OUTPUT_FILE, JSON.stringify({ alerts: [] }, null, 2));
    return;
  }

  // Collect all content
  const allItems = [];
  const sourceStats = { reddit: 0, hackerNews: 0, x: 0, github: 0, changelog: 0, rss: 0, youtube: 0 };

  // 1. Reddit (fast, reliable)
  for (const sub of SUBREDDITS) {
    const posts = await scrapeReddit(sub.name);
    allItems.push(...posts);
    sourceStats.reddit += posts.length;
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2. HackerNews Show HN (free, no Apify needed)
  const hnItems = await scrapeHackerNews();
  allItems.push(...hnItems);
  sourceStats.hackerNews = hnItems.length;

  // 2b. RSS feeds — Latent Space, Simon Willison
  const rssItems = await scrapeRssFeeds();
  allItems.push(...rssItems);
  sourceStats.rss = rssItems.length;

  // 2c. YouTube — curated channel uploads (full-length only; Shorts filtered)
  const ytItems = await scrapeYouTube();
  allItems.push(...ytItems);
  sourceStats.youtube = ytItems.length;

  // 3. Twitter (slower, may fail — that's OK)
  try {
    const tweets = await scrapeTwitterAccounts();
    allItems.push(...tweets);
    sourceStats.x = tweets.length;
  } catch (e) {
    console.log('Twitter scrape skipped:', e.message);
  }

  // 4. Official GitHub releases
  const githubAlerts = await checkGitHubReleases(state);
  sourceStats.github = githubAlerts.length;

  // 5. Changelog monitoring (Anthropic, Ollama, OpenAI)
  const changelogAlerts = await checkChangelogs(state);
  sourceStats.changelog = changelogAlerts.length;
  // Official/changelog alerts skip the normal filter and go straight to output

  // 6. Update model spec sheet weekly
  const lastSpecUpdate = state.lastSpecUpdate || '';
  const scanDate = new Date().toISOString().slice(0, 10);
  const dayOfWeek = new Date().getDay(); // 0=Sunday
  if (dayOfWeek === 1 || lastSpecUpdate !== scanDate) { // Update on Mondays or first run
    await updateModelSpecSheet();
    state.lastSpecUpdate = scanDate;
  }

  console.log(`Collected ${allItems.length} items + ${githubAlerts.length} GitHub alerts + ${changelogAlerts.length} changelog alerts`);

  // Filter + score
  const alerts = [];
  for (const item of allItems) {
    // Skip if already seen
    if (state.seenIds.includes(item.id)) continue;
    state.seenIds.push(item.id);

    // Skip stale social/HN items; the cron is for staying current, not rediscovering old launches.
    const maxAgeMs = item.source?.startsWith('r/') ? 14 * 24 * 60 * 60 * 1000 : 45 * 24 * 60 * 60 * 1000;
    if (item.createdAtMs && Date.now() - item.createdAtMs > maxAgeMs) continue;

    // Must contain at least one signal keyword
    const lower = item.text.toLowerCase();
    const hasSignal = SIGNAL_KEYWORDS.some(kw => lower.includes(kw));
    if (!hasSignal) continue;

    const relevanceScore = scoreRelevance(item.text, item.source);
    // Filter noisy low-signal social posts even when they mention Claude/GPT.
    if (item.source?.startsWith('r/') && (item.score || 0) < 10 && relevanceScore < 6) continue;
    if (relevanceScore < 3) continue; // Too low — skip

    const verdict = generateVerdict(item.text, relevanceScore);
    const businessImpact = scoreBusinessImpact(item.text);

    alerts.push({
      source: item.source,
      text: item.text.slice(0, 300),
      url: item.url,
      kind: item.kind || 'article',
      relevanceScore,
      businessImpact,
      businessImpactSummary: summarizeBusinessImpact(businessImpact),
      verdict,
    });
  }

  // Add official/changelog alerts (pre-scored, high priority)
  const officialAlerts = [...githubAlerts, ...changelogAlerts];
  alerts.push(...officialAlerts.filter(a => !state.seenIds.includes(a.id)));
  for (const a of officialAlerts) {
    if (!state.seenIds.includes(a.id)) state.seenIds.push(a.id);
  }

  // Sort by relevance, then split into articles + videos so the morning
  // session can build the email's "Worth Watching" section separately.
  alerts.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const articles = alerts.filter(a => a.kind !== 'video').slice(0, 12);
  const videos = alerts.filter(a => a.kind === 'video').slice(0, 5);
  const topAlerts = articles; // backwards compat for state.postsToday counter below

  // Trim state.seenIds to last 1000 to avoid unbounded growth
  if (state.seenIds.length > 1000) {
    state.seenIds = state.seenIds.slice(-800);
  }

  state.lastRun = new Date().toISOString();
  saveState(state);

  if (topAlerts.length > 0) {
    state.postsToday = (state.postsToday || 0) + 1;
    saveState(state);
  }

  const weeklyDue = dayOfWeek === 1 || process.env.FORCE_WEEKLY_SUMMARY === '1';
  const output = {
    alerts: topAlerts,
    videos,
    testQueue: buildTestQueue(topAlerts),
    weeklyModelStackSummary: weeklyDue ? buildWeeklyModelStackSummary(topAlerts) : null,
    sourceStats,
    scannedAt: new Date().toISOString(),
    stack: OUR_STACK,
  };
  writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`Done. ${topAlerts.length} alerts to post.`);
}

main().catch(console.error);
