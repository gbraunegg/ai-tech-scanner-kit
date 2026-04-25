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

// Twitter accounts to monitor for AI/model releases
const TWITTER_ACCOUNTS = [
  { handle: 'thestreamingdev', focus: 'local models, Mac AI' },
  { handle: 'karpathy', focus: 'foundational AI research' },
  { handle: 'ggerganov', focus: 'llama.cpp, local inference' },
  { handle: 'simonw', focus: 'AI tools, LLM practical use' },
  { handle: 'swyx', focus: 'AI engineering, new tools' },
  { handle: 'mattshumer_', focus: 'AI products, Claude' },
  { handle: 'OpenAI', focus: 'OpenAI releases' },
  { handle: 'AnthropicAI', focus: 'Anthropic releases' },
  { handle: 'ollama', focus: 'local model serving' },
  { handle: 'GoogleDeepMind', focus: 'frontier model research' },
];

// Reddit communities to scan
const SUBREDDITS = [
  { name: 'LocalLLaMA', focus: 'local model releases and benchmarks' },
  { name: 'MachineLearning', focus: 'new model releases' },
  { name: 'ClaudeAI', focus: 'Anthropic updates' },
  { name: 'OpenAI', focus: 'OpenAI releases' },
];

// HackerNews "Show HN" — builders post new tools here before Twitter
const HN_QUERIES = [
  'Show HN: llm', 'Show HN: AI', 'Show HN: claude', 'Show HN: local model',
  'Show HN: agent', 'Show HN: mac'
];

// Changelog sources to monitor (Anthropic, OpenClaw, OpenAI, Ollama)
const CHANGELOG_URLS = [
  {
    url: 'https://www.anthropic.com/news',
    name: 'Anthropic News',
    stateKey: 'anthropic_last_item'
  },
  {
    url: 'https://ollama.com/blog',
    name: 'Ollama Blog',
    stateKey: 'ollama_last_item'
  },
  {
    url: 'https://openai.com/news/',
    name: 'OpenAI News',
    stateKey: 'openai_last_item'
  },
];

// Official GitHub releases to monitor. These are higher-signal than social feeds.
const GITHUB_RELEASE_REPOS = [
  { repo: 'openclaw/openclaw', name: 'OpenClaw GitHub Releases', impact: 'agent platform' },
  { repo: 'ollama/ollama', name: 'Ollama GitHub Releases', impact: 'local inference' },
  { repo: 'ggerganov/llama.cpp', name: 'llama.cpp GitHub Releases', impact: 'local inference runtime' },
  { repo: 'openai/openai-node', name: 'OpenAI SDK Releases', impact: 'OpenAI API integration' },
  { repo: 'anthropics/anthropic-sdk-typescript', name: 'Anthropic SDK Releases', impact: 'Anthropic API integration' },
];

const BUSINESS_IMPACT_WEIGHTS = {
  codingSpeed: ['coding', 'code', 'developer', 'agent', 'codex', 'claude code', 'cursor', 'refactor', 'debug'],
  localPrivacy: ['local', 'on-device', 'mac', 'mlx', 'ollama', 'llama.cpp', 'gguf', 'privacy', 'offline'],
  clientDashboardLeverage: ['dashboard', 'analytics', 'reporting', 'workflow', 'automation', 'spreadsheet', 'data pipeline', 'bi'],
  cpgUseCases: ['cpg', 'retail', 'inventory', 'sales', 'forecast', 'trade spend', 'shopify', 'amazon', 'sku'],
};

// Model spec sheet path — living doc that gets updated weekly
const MODEL_SPEC_FILE = path.join(WORKSPACE, 'model-spec-sheet.md');

// Keywords that signal something worth evaluating
const SIGNAL_KEYWORDS = [
  // Model releases
  'release', 'launches', 'new model', 'just released', 'now available', 'open source',
  'llama', 'gemma', 'claude', 'gpt', 'mistral', 'qwen', 'phi', 'deepseek',
  'ollama', 'llama.cpp', 'gguf', 'mlx', 'quantization',
  // Capability signals
  'beats', 'outperforms', 'state of the art', 'sota', 'best', 'faster',
  'multimodal', 'vision', 'coding', 'agentic', 'tool use', 'function calling',
  // Mac/local specific
  'mac mini', 'm4', 'apple silicon', 'metal', 'core ml', 'local', 'on-device',
  // Tools/APIs
  'api', 'mcp', 'tool', 'plugin', 'integration', 'workflow', 'automation',
  'openclaw', 'claude code', 'codex', 'cursor', 'agent',
];

// Keywords that make something likely NOT worth posting (noise filter)
const NOISE_KEYWORDS = [
  'papers', 'survey', 'theoretical', 'academic', 'dataset', 'benchmark only',
  'requires a100', 'requires h100', 'requires 80gb', 'cloud only',
  'political', 'layoffs', 'valuation', 'stock', 'ipo',
  'should i continue', 'subscription', 'rumor', 'leak', 'anyone else',
  'is a decent', 'when will', 'coming or should', 'what do you think',
];

// Our current tech stack — used for relevance evaluation
const OUR_STACK = {
  primaryModel: 'openai-codex/gpt-5.5',
  fallbacks: [
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4-6',
    'ollama/qwen3.6',
  ],
  localModels: ['ollama/qwen3.6'],
  macMini: '16GB M4 — can run up to ~26B MoE or ~13B dense models well',
  tools: ['OpenClaw', 'Codex', 'Claude Code', 'gog (Gmail/Calendar)', 'gh (GitHub)', 'Apify'],
  usesCases: ['CPG advisory', 'content generation', 'code generation', 'email drafts', 'AI audits', 'client dashboards'],
};

function scoreBusinessImpact(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [key, terms] of Object.entries(BUSINESS_IMPACT_WEIGHTS)) {
    scores[key] = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
  }
  const total = (scores.codingSpeed * 3) + (scores.localPrivacy * 3) + (scores.clientDashboardLeverage * 2) + (scores.cpgUseCases * 2);
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'codingSpeed';
  return { ...scores, total, top };
}

function summarizeBusinessImpact(impact) {
  const labels = {
    codingSpeed: 'coding speed',
    localPrivacy: 'local privacy',
    clientDashboardLeverage: 'client dashboard leverage',
    cpgUseCases: 'CPG use cases',
  };
  const ordered = Object.entries(impact)
    .filter(([k, v]) => ['codingSpeed', 'localPrivacy', 'clientDashboardLeverage', 'cpgUseCases'].includes(k) && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => labels[k]);
  return ordered.length ? ordered.slice(0, 2).join(' + ') : 'general AI stack awareness';
}

// Relevance scoring — how much does this matter for us?
function scoreRelevance(text, source) {
  let score = 0;
  const lower = text.toLowerCase();
  const officialSource = /Anthropic|OpenAI|Ollama|GitHub|HackerNews/i.test(source || '');

  // Official release/changelog sources are more actionable than speculation.
  if (officialSource) score += 2;

  // Question/speculation threads are usually noisy unless they include hard release details.
  const speculative = /\b(should i|is .* coming|anyone else|what do you think|rumou?r|leak|subscription)\b/i.test(lower);
  if (speculative && !/released|launch|available|github|benchmark|paper|repo/i.test(lower)) score -= 4;

  // High value: local Mac models
  if (lower.includes('mac') || lower.includes('apple silicon') || lower.includes('mlx')) score += 3;
  if (lower.includes('llama.cpp') || lower.includes('ollama') || lower.includes('gguf')) score += 3;
  if (lower.includes('m4') || lower.includes('m3') || lower.includes('16gb')) score += 2;

  // High value: Claude/Anthropic updates
  if (lower.includes('claude') || lower.includes('anthropic')) score += 3;
  if (lower.includes('mcp') || lower.includes('model context protocol')) score += 3;

  // Medium value: new capable models we could switch to
  if (lower.includes('new model') || lower.includes('release') || lower.includes('launches')) score += 2;
  if (lower.includes('coding') || lower.includes('agentic') || lower.includes('tool use')) score += 2;
  if (lower.includes('faster') || lower.includes('cheaper') || lower.includes('free')) score += 2;

  // Medium value: workflow/automation tools
  if (lower.includes('workflow') || lower.includes('automation') || lower.includes('agent')) score += 2;
  if (lower.includes('openclaw') || lower.includes('cursor') || lower.includes('codex')) score += 2;

  // Low value but worth tracking
  if (lower.includes('gemini') || lower.includes('openai') || lower.includes('gpt')) score += 1;
  if (lower.includes('multimodal') || lower.includes('vision')) score += 1;

  // Business impact: reward items that map to revenue-relevant use cases.
  score += Math.min(5, scoreBusinessImpact(text).total);

  // Noise reduction
  if (NOISE_KEYWORDS.some(n => lower.includes(n))) score -= 3;
  if (lower.includes('requires') && (lower.includes('a100') || lower.includes('h100') || lower.includes('80gb'))) score -= 5;

  return score;
}

function generateVerdict(text, score) {
  const lower = text.toLowerCase();

  if (score >= 6) {
    // High relevance — specific recommendation
    if (lower.includes('mac') && (lower.includes('llama.cpp') || lower.includes('ollama') || lower.includes('mlx'))) {
      return { action: '🔴 TEST NOW', reason: 'Directly relevant to local model stack. Test on Mac Mini M4.' };
    }
    if (lower.includes('claude') || lower.includes('anthropic') || lower.includes('mcp')) {
      return { action: '🔴 EVALUATE', reason: 'Directly affects our primary model or tooling.' };
    }
    return { action: '🟡 EVALUATE', reason: 'High relevance to our stack. Worth testing.' };
  }

  if (score >= 3) {
    if (lower.includes('coding') || lower.includes('agent')) {
      return { action: '🟡 MONITOR', reason: 'Could improve coding workflow. Watch for adoption.' };
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
        });
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    console.error('HN scrape error:', e.message);
  }
  return results;
}

async function checkGitHubReleases(state) {
  const alerts = [];
  for (const source of GITHUB_RELEASE_REPOS) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${source.repo}/releases?per_page=3`, {
        headers: { 'User-Agent': 'OpenClaw-AI-Tech-Scanner/1.0', 'Accept': 'application/vnd.github+json' },
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
| Main assistant | openai-codex/gpt-5.5 | OpenClaw default agent config | varies |
| Fallback 1 | anthropic/claude-sonnet-4-6 | Anthropic API | ~$3/1M tokens |
| Fallback 2 | anthropic/claude-haiku-4-5-20251001 | Anthropic API | ~$0.80/1M tokens |
| Fallback 3 | anthropic/claude-opus-4-6 | Anthropic API | premium |
| Local (planned) | Llama 3.3 70B | Mac mini M4 Pro 48GB | $0 |

## Mac Mini M4 16GB — What Runs Well
| Model | Quant | Size | Speed | Quality | Use Case |
|---|---|---|---|---|---|
| Gemma 4-26B (MoE) | IQ2_M | 9.3GB | 36 tok/s | Good | Fast general use |
| Gemma 4-26B (MoE) | Q4_K_M | 16.9GB | 5 tok/s | Better | Quality-sensitive tasks |
| Llama 3.2 11B | Q4_K_M | 7GB | ~40 tok/s | Good | Fast inference |
| Phi-4 14B | Q4_K_M | 9GB | ~25 tok/s | Very good | Coding, reasoning |

## Mac mini M4 Pro 48GB (Artesian target) — What Runs Well
| Model | Quant | Size | Speed | Quality | Use Case |
|---|---|---|---|---|---|
| Llama 3.3 70B | Q4_K_M | 42GB | ~15 tok/s | Excellent | All tasks, sensitive data |
| Llama 3.3 70B | IQ2_M | 22GB | ~35 tok/s | Very good | Faster, slightly lower quality |
| Gemma 4 27B | Q8_0 | 27GB | ~20 tok/s | Excellent | General + coding |

## Best Models by Use Case (as of ${today})
| Use Case | Best Cloud | Best Local (48GB) | Best Local (16GB) |
|---|---|---|---|
| Code generation | claude-sonnet-4-6 | Llama 3.3 70B | Phi-4 14B |
| Long context / docs | gemini-2.5-pro | Llama 3.3 70B | Gemma 4-26B Q4 |
| Fast chat | claude-haiku | Gemma 4-26B IQ2 | Gemma 4-26B IQ2 |
| Financial analysis | claude-sonnet-4-6 | Llama 3.3 70B | Llama 3.2 11B |
| Embeddings | text-embedding-3-small | nomic-embed-text | nomic-embed-text |

## Tools to Watch
| Tool | Status | Relevance |
|---|---|---|
| MCP (Model Context Protocol) | Active — Anthropic standard | High — OpenClaw uses this |
| MLX (Apple) | Active — v0.21+ | High — native Mac acceleration |
| Ollama | Active — v0.5+ | High — local model serving |
| llama.cpp | Active | High — GGUF format, MoE support |
| LM Studio | Active | Medium — local model GUI |

*This file is auto-updated weekly. Gherkin reviews scanner output and updates when significant model releases occur.*
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
  const localHits = alerts.filter(a => (a.businessImpact?.localPrivacy || 0) > 0 || /ollama|llama|mlx|gguf|local/i.test(a.text || ''));
  const codingHits = alerts.filter(a => (a.businessImpact?.codingSpeed || 0) > 0 || /coding|agent|codex|claude code/i.test(a.text || ''));
  const officialHits = alerts.filter(a => /GitHub Releases|News|Blog|OpenAI|Anthropic|Ollama|OpenClaw/i.test(a.source || ''));
  return {
    date: today,
    recommendation: 'Keep GPT-5.5/Codex as primary. Evaluate official SDK/runtime releases immediately; only test local models/tools when they improve coding speed, privacy, or client-dashboard delivery.',
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

  const MAX_POSTS_PER_DAY = 3; // Don't spam — max 3 alerts per day
  if (state.postsToday >= MAX_POSTS_PER_DAY) {
    console.log(`Already posted ${state.postsToday} times today. Skipping.`);
    saveState(state);
    writeFileSync(OUTPUT_FILE, JSON.stringify({ alerts: [] }, null, 2));
    return;
  }

  // Collect all content
  const allItems = [];
  const sourceStats = { reddit: 0, hackerNews: 0, x: 0, github: 0, changelog: 0 };

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

  // Sort by relevance, take top 3
  alerts.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topAlerts = alerts.slice(0, 3);

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
