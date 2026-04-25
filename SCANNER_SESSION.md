# AI Tech Scanner — Morning Session Instructions

This file is the playbook for the daily 7:00am scanner session. A fresh
Claude Code session fires, reads this file, and executes the steps below.
Goal: one well-formatted email digest in George's inbox by 7:01am.

## Audience
George (Director, Xero Solar). Technical operator. Runs Claude Code daily
on Windows 11 for: Procurement Agent, Personal Assistant, Existing Client
agents (SCE + LADWP), Non Export Agent, Business Development Agent, USC
and Capstone graders. No Mac Mini in the stack. Primary model: Claude (via
Max subscription). Local LLMs not currently in production.

## What "signal" means for George
- **High signal:** Anthropic / Claude Code releases, post-mortems, pricing
  changes, agent SDK features. New tools that could replace or augment one
  of the agents. Slack-bot frameworks. Excel/Python automation
  breakthroughs. Solar industry AI tooling (rare but always relevant).
- **Medium signal:** Cursor / Codex / OpenAI dev-tool news. New code-gen
  benchmarks. GitHub Actions / scheduling / cron tooling.
- **Low signal (skip unless quiet day):** Generic LLM benchmark posts,
  rumor/leak threads with no source, beginner Q&A, "Show HN" demos with
  no clear use case, model-spec sheet updates already covered last week.
- **Zero signal (always skip):** Crypto, NFT, generic AI ethics op-eds,
  marketing fluff, Reddit relationship advice, anything Mac-Mini-specific
  unless George has bought one.

## Steps

1. **Run the scanner** (15-30 sec):
   ```
   cd "C:/XeroSolar/run/ai-tech-scanner"
   node ai-tech-scanner.mjs
   ```

2. **Read** `ai-tech-scanner-output.json`. The scanner produces an `alerts`
   array of items it considers high-relevance. There may be 0-15 items.

3. **Apply judgment.** The scanner's heuristic scoring is partly tuned for
   the original author's stack, not George's. Override freely:
   - Drop items in "low" or "zero signal" buckets above.
   - Promote items that hit George's stack but the scanner missed (rare —
     it's usually over-inclusive, not under).
   - Aim for 5-10 items in the email. Cap at 12 — anything more means the
     scanner was too lenient and you should tighten judgment.

4. **Fetch + summarize each kept item.** For each one:
   - Use WebFetch to pull the article body. If the URL is reachable:
     write a 2-3 sentence summary in plain English (no jargon, no
     "leverages" / "synergies" / "ecosystem").
   - Sentence 1: what it is. Sentence 2: why George should care. Optional
     sentence 3: concrete next step or implication.
   - If WebFetch fails (Reddit, paywalled posts), use the scanner's
     snippet text + your own knowledge. Append "(headline only)" so
     George knows you didn't read the body.

5. **Pick the top story.** Across the kept items, choose one as the lead.
   Criteria: most likely to change something George does this week. If
   nothing meets that bar (very common — most days have no "lead-worthy"
   item), the top item is just the highest-relevance one and the email
   tag stays "📈 Today's News" instead of "🔥 Top Story."

6. **Pick 1-2 YouTube videos.** The scanner emits a separate `videos`
   array in the output JSON (channels: AI Explained, Matthew Berman,
   Indy Dev Dan, Sam Witteveen, Anthropic, Wes Roth, All About AI).
   - Drop sponsored content (giveaways: "sign up for free", "try X
     here", promo-code reads). All About AI heavily sponsors — be
     skeptical of their videos.
   - Drop Mac-Mini-specific content unless George has bought a Mac.
   - Drop generic AI hype reaction videos.
   - Keep: Anthropic / Claude releases, agent-pattern tutorials, deep
     paper breakdowns, "this is how to use Claude Code for X" content.
   - Cap at 2 videos. If only 1 is good, just use 1. If none are good,
     skip the section entirely (don't fabricate a recommendation).
   - For each kept video, write a 2-3 sentence summary using the title +
     description text (already in the JSON). Don't try to fetch the
     transcript — title + description is enough.

7. **Build the email HTML.** Template lives at
   `email_template.html` — read it, do string-substitution. Required
   sections:
   - **Header:** "AI Radar — <Day>, <Month> <D>, <YYYY>" + a one-line
     meta ("Daily digest · N surfaced · M filtered")
   - **Lead item card** with red 🔥 tag if it's a real top story, blue
     📈 tag otherwise. Headline, 2-3 sentence summary, source line,
     "Read →" link.
   - **Subsequent item cards** with blue 📈 tag, same shape.
   - **Filtered list** (optional, only if items were dropped) — gray
     box with one-liners on what got filtered and why. Keeps George
     honest about what's getting cut.
   - **Worth Watching section** (optional — only if 1-2 videos kept).
     Heading "📺 Worth Watching", then per-video cards with a video
     tag (📺), title in bold, 2-3 sentence summary, channel name as
     source line, "Watch →" link.
   - **Footer:** sign-off line, source attribution.

7. **Save the HTML to disk:**
   ```
   digests/<YYYY-MM-DD>.html
   ```
   This is the on-disk archive. Don't email a path — just keep it.

8. **Send via Gmail SMTP:**
   ```
   "C:/XeroSolar/Procurement Agent (Claude)/.venv/Scripts/python.exe" send_email.py "AI Radar — <Day> <Month> <D>" "digests/<YYYY-MM-DD>.html"
   ```
   The Python sender reads `GMAIL_USER` and `GMAIL_APP_PASSWORD` from
   `.env`, sends via `smtp.gmail.com:587`, recipient is the same as sender
   (gbraunegg12@gmail.com). On success it prints `sent: <subject>`.

9. **Verify.** Check that `send_email.py` exited 0 and printed `sent:`. If
   not, try once more after 30 sec. If still failing, write the error to
   `logs/<YYYY-MM-DD>.log`. Don't retry endlessly.

10. **Quiet-day handling.** If after judgment there are zero items worth
    surfacing, send a short email body: "Quiet day — nothing in the
    feeds worth your time this morning. The scanner will run again
    tomorrow at 7am." Don't fabricate signal.

11. **Failure handling.** If the scanner script errors out, send an
    email with body "AI Radar failed: <error>." Then write the error to
    `logs/<YYYY-MM-DD>.log` and exit. Don't retry the scanner itself.

## Tone (per the Slack plain-English rule)
- Conversational, short sentences, one idea per line
- No banned terms (MPN, PUP, schema, normalize, cascade — see
  `.claude/rules/slack-plain-english.md`)
- Define acronyms on first use
- Write like you're DM'ing a colleague, not writing marketing copy

## Recalibration
Once a week (Sunday session), spot-check the previous 7 daily digests:
- Did George miss anything? (check Slack DMs for "did you see X?" — if
  yes and we didn't surface it, tune the scoring)
- Did we over-surface noise? (3+ days of "wasn't worth it" items → tighten)
- Update this file's "signal" lists if the patterns shift.

## Out of scope
- **Don't post to Slack.** Email only.
- **Don't send Pushover notifications.** That transport was retired.
- **Don't write to any other agent's folders.**
- **Don't call the Anthropic API.** The current session IS Claude — do
  the summarization inline. (Per the root CLAUDE.md sub-agent credential
  rules: scheduled tasks running outside Claude Code may call the API,
  but this session IS Claude Code, so inline reasoning is the right path
  and uses the Max subscription, not API credits.)

## Files in this folder
- `ai-tech-scanner.mjs` — the scanner script (Node 20+, zero deps)
- `ai-tech-scanner-state.json` — seen-items dedupe state, auto-managed
- `ai-tech-scanner-output.json` — latest run's alert list (read this)
- `model-spec-sheet.md` — auto-updated weekly model reference
- `send_email.py` — Gmail SMTP sender (uses .env, stdlib only)
- `email_template.html` — the HTML shell to fill in
- `.env` — credentials (gitignored: PUSHOVER_*, GMAIL_*)
- `digests/` — daily HTML archive (gitignored)
- `logs/` — failure log archive (gitignored)
- `SCANNER_SESSION.md` — this file
