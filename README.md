# latest — search for today, not for your cutoff

A Claude Code plugin that teaches your agent a **freshness discipline** for web research.

## The problem

An AI model's memory ends at its training cutoff, so every product name, version, price, limit, and rule it "knows" is old by default. Worse: generic web search tools return results **with no dates** and rank long-established pages high — so they re-serve last generation's help page as the current answer, and the model repeats it with full confidence. The page is real, the fetch happened today, and the answer is still wrong.

This plugin exists because that exact failure kept happening to its author's agent — including once *while the discipline was being written*.

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
| `scripts/latest-search.mjs` | The date ladder as a script, with a pluggable engine (Tavily / Serper / Brave) — no dependencies, Node 18+ |
| `agents/web-researcher.md` | A delegate researcher agent with the skill preloaded, ladder-first order of work, and the evidence-jobs lane |
| `hooks/freshness-gate.mjs` | Optional hard gate: denies the researcher agent's WebSearch/WebFetch until the ladder actually ran (recipe below) |
| `hooks/freshness-reminder.mjs` | Optional soft version for the main thread: warn-only freshness reminder on every web call |

## Install

```
/plugin marketplace add yehudakessler/latest-skill
/plugin install latest@latest-skill
```

Then use it: ask anything with a changeable fact in it ("what are the current X limits", "latest version of Y") — or invoke `/latest` directly.

## Optional: plug in a real search engine

Out of the box the skill runs in **Mode B**: the built-in WebSearch plus the manual dating discipline. That already fixes the worst failure (silent staleness), but built-in search has no true date filter.

**Mode A** adds one: create `~/.latest-search/config.json` with a key for any one of these engines (each has a free tier — checked 2026-08-31, see each site for current terms):

```json
{ "engine": "tavily", "key": "tvly-..." }
```

| Engine | Sign-up | Date filtering |
|---|---|---|
| `tavily` | tavily.com | `time_range` day/week/month/year |
| `serper` | serper.dev | Google `tbs=qdr:` hour/day/week/month/year |
| `brave` | brave.com/search/api | `freshness` pd/pw/pm/py |

Test it:

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/latest-search.mjs" "your topic here"
```

The key stays in your home directory, outside every repo. The script never prints it.

## Optional: the freshness gate (hard enforcement for research fleets)

Delegated research agents are the weak point: they skip disciplines they were not built with. The bundled `web-researcher` agent has the discipline in its prompt, but a prompt is advice. The gate makes it mechanical:

1. Every ladder run writes a stamp to `~/.latest-search/last-run.json` (timestamp, query, rung, result count, mode).
2. A `PreToolUse` hook denies WebSearch/WebFetch **for the researcher agent only** unless the stamp is under 30 minutes old.
3. If the stamp says the ladder was *tried but blocked* (engine down, rate limit, no engine), the gate **opens with a warning** instead: the researcher may search, but must label every changeable-fact claim `undated/unverified`. A broken engine must never dead-end a fleet — and never excuse answering from memory.

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

**Doesn't recency bias hurt deep research?** That's what the evidence-jobs lane is for: measured evidence is judged by quality, not date. The freshness rules apply to *changeable* facts only.

**Why not ship a Google scraper?** Scraping is brittle, ToS-gray, and machine-specific. Hosted search APIs do date filtering properly for free-tier money. The method is portable; the plumbing should be boring.

**Does this replace WebSearch?** No — it sequences it. The ladder finds the newest anchor; WebSearch/WebFetch then fill in detail, re-anchored to what the ladder found.

## License

MIT © Yehuda Kessler
