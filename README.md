# latest — search for today, not for your cutoff

A Claude Code plugin that teaches your agent a **freshness discipline** for web research.

**Completely free, and it works completely free.** No API key, no account, no credit card: out of the box the date ladder rides a public news feed, and the rest of the discipline runs on Claude's built-in search. Free-tier API keys are an optional upgrade for full-web date filtering — never a requirement.

## The problem

An AI model's memory ends at its training cutoff, so every product name, version, price, limit, and rule it "knows" is old by default. Worse: generic web search tools return results **with no dates** and rank long-established pages high — so they re-serve last generation's help page as the current answer, and the model repeats it with full confidence. The page is real, the fetch happened today, and the answer is still wrong.

Two real failures from the daily agent work this plugin grew out of:

- **The stale page served as current.** Asked for a chatbot subscription's *current* usage limits, the agent's built-in search returned the help page for the **previous model generation** — undated, top-ranked, official-looking. The agent quoted the old limits with full confidence. It happened again, same query, two days later. A user making a paid-plan decision on that answer would have bought the wrong thing.
- **The plan built on a dead API.** An agent recommended building a feature on a well-known Google search API, based on a note verified only three days earlier. The API had been **closed to new customers seven months before** — every call from a new project fails. A newest-first search would have surfaced the closure announcement before a line of code was written; instead the discovery came after the build.

Both failures share a root: the agent searched *what it remembered* instead of *what is newest*. Old queries find old pages, and old pages read as confident answers.

This plugin exists because those failures kept happening to its author's agent — including once *while the discipline was being written*.

## What it does

The method is the product:

- **Newest-first date ladder.** Search the past day first; walk back to week → month → year → any time only when nothing newer exists. The first rung with hits anchors the answer. There is no fixed freshness window — "current" means the newest source that exists.
- **Every source dated.** A page's publish/updated date is part of the citation. An undated page is a weak source for a changeable fact (and explicitly NOT weak for measured evidence — see below).
- **Every answer stamped.** Changing facts carry "as of \<date\>, \<version\>". If the newest source found is months old, the answer says so up front — only *silent* staleness is banned.
- **Evidence is exempt.** Papers, benchmarks, studies, and guidelines never expire; they are judged by quality and authority, not recency. The bundled researcher agent has an explicit "evidence jobs" lane so freshness rules never shrink real research.
- **Graceful degradation.** No search API? Rate-limited? The discipline still runs on the built-in WebSearch with honest `undated/unverified` labels instead of dead-ending — or worse, silently answering from memory.

## What's in the box

| Piece | What it is |
|---|---|
| `skills/latest/SKILL.md` | The discipline itself — the `/latest` skill Claude loads and follows |
| `scripts/latest-search.mjs` | The date ladder as a script — works keyless out of the box (public news feed), pluggable engines (Tavily / Serper / Brave) for full-web coverage; no dependencies, Node 18+ |
| `agents/web-researcher.md` | A delegate researcher agent with the skill preloaded, ladder-first order of work, and the evidence-jobs lane |
| `hooks/freshness-gate.mjs` | Optional hard gate: denies the researcher agent's WebSearch/WebFetch until the ladder actually ran (recipe below) |
| `hooks/freshness-reminder.mjs` | Optional soft version for the main thread: warn-only freshness reminder on every web call |

## Install

```
/plugin marketplace add yehudakessler/latest-skill
/plugin install latest@latest-skill
```

Then use it: ask anything with a changeable fact in it ("what are the current X limits", "latest version of Y") — or invoke `/latest` directly.

## The engines — free by default, wider with a key

With **zero setup** the ladder runs on the public Google News RSS feed: free forever, no account, no key, real publish dates, a past-hour rung. Its honest limits: news sites only, and its links are Google News redirects (the skill knows to cite title + source and fetch the article when needed).

For **full-web** date filtering, create `~/.latest-search/config.json` with a key for any one of these engines:

```json
{ "engine": "tavily", "key": "tvly-..." }
```

| Engine | Sign-up | Date filtering | Cost (as of 2026-08-31 — check the site) |
|---|---|---|---|
| `news` (default) | none | Google News `when:` **hour**/day/week/month/year | Free, always. No account. News sites only |
| `tavily` | tavily.com | `time_range` day/week/month/year | Free tier: 1,000 credits/month, no credit card |
| `serper` | serper.dev | Google `tbs=qdr:` **hour**/day/week/month/year | 2,500 free queries on signup, no credit card; then prepaid from $1/1k |
| `brave` | brave.com/search/api | `freshness` pd/pw/pm/py | $5 in credits/month ≈ 1,000 requests — credit card required |

If a keyed engine errors (rate limit, outage), the script falls back to the news feed by itself and prints a `FALLBACK:` line — a broken engine never dead-ends a research run.

Test it:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/latest-search.mjs" "your topic here"
```

The key stays in your home directory, outside every repo. The script never prints it.

## Optional: the freshness gate (hard enforcement for research fleets)

Delegated research agents are the weak point: they skip disciplines they were not built with. The bundled `web-researcher` agent has the discipline in its prompt, but a prompt is advice. The gate makes it mechanical:

1. Every ladder run writes a stamp to `~/.latest-search/last-run.json` (timestamp, query, rung, result count, mode).
2. A `PreToolUse` hook denies WebSearch/WebFetch **for the researcher agent only** unless the stamp is under 30 minutes old.
3. If the stamp says the ladder was *tried but blocked* (every engine down — rare, since the keyless news feed is the always-on floor), the gate **opens with a warning** instead: the researcher may search, but must label every changeable-fact claim `undated/unverified`. A broken engine must never dead-end a fleet — and never excuse answering from memory.

Wire it in your `settings.json` (user or project level):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "WebSearch|WebFetch",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/freshness-gate.mjs\"" }
        ]
      }
    ]
  }
}
```

Notes:
- The gate acts only when the hook input's `agent_type` is `web-researcher` (bare or plugin-namespaced). Override with the `LATEST_GATE_AGENT` env var. Everyone else passes untouched.
- Both hooks **fail open** — if anything throws, the call is allowed. A broken gate must not stop real work.
- Add `freshness-reminder.mjs` with the same matcher if you also want the warn-only nudge on the main thread.
- Known limit: the stamp is machine-wide, so one researcher's run satisfies the gate for all of them for 30 minutes. The gate catches "never ran", not "ran for a different topic" — the agent prompt covers the rest.

## The rules that survived contact

These were each learned the hard way, running this discipline in daily agent work:

- **Newest wins, no fixed window.** The default anchor is today; walk back only when nothing newer exists.
- **Never patch an old number into a new answer.** A source naming an older version than the ladder found is stale — re-search, don't reconcile.
- **Never anchor a query to a remembered year.** Use today's date from the environment, or the version the ladder just found.
- **Evidence never expires; capability claims are generation-anchored.** An AI limitation measured on an older model is a hypothesis to re-test, never a fact. A benchmark from 2024 is still a benchmark; a pricing page from 2024 is a museum piece.
- **A metric at zero is not the goal reached.** The gate catches "never ran" — the honest labels catch everything else. Don't game the stamp; the reader is the point.
- **Your own discipline applies to you.** While building an earlier version of this, the author's agent recommended an API route based on a 3-day-old test note — the provider had closed that API to new customers seven months earlier. Three days stale was already too stale. Ladder first, even for your own plans.

## FAQ

**Is it really free?** Yes — the plugin, the default engine, and the whole discipline cost nothing, ever. The only optional costs are third-party API keys you choose to add, and each of those has a free tier too.

**Doesn't recency bias hurt deep research?** That's what the evidence-jobs lane is for: measured evidence is judged by quality, not date. The freshness rules apply to *changeable* facts only.

**Why not ship a Google scraper?** Scraping is brittle, ToS-gray, and machine-specific. Hosted search APIs do date filtering properly for free-tier money. The method is portable; the plumbing should be boring.

**Does this replace WebSearch?** No — it sequences it. The ladder finds the newest anchor; WebSearch/WebFetch then fill in detail, re-anchored to what the ladder found.

## License

MIT © Yehuda Kessler
