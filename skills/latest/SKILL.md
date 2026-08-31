---
name: latest
description: Find the NEWEST sources on any changeable fact — prices, plans, usage limits, model/tool versions, features, rules, schedules, "what's the latest/current/new". Runs a date-laddered search (newest first, walking back only when nothing newer exists) and returns dated results. Use BEFORE any plain web search on a changeable fact, whenever the user asks what is current/latest/new, and self-invoke when a search answer could be older than the newest change. Not for measured evidence (papers, benchmarks) — that never expires.
---

# /latest — search for today, not for your cutoff

**Why this exists:** your memory ends at your training cutoff, so every product name, version, price, limit, rule, or date you "know" is old by default — and a page fetched today is only as current as its *publish* date. Generic web search tools return results with no dates and rank long-established (old) pages high, so they happily re-serve last generation's help page as current. The default is **today's newest**; walk back only when nothing newer exists. There is no fixed freshness window — "recent enough" is defined by the newest source that exists, not by a calendar.

## Scope
- **Use for changeable facts:** versions, models, prices, limits, plans, features, rules/laws, schedules, availability, "latest/best", news.
- **Not for measured evidence** (papers, benchmarks, studies, taxonomies) — evidence never expires. Judge it by the generation rule: every AI capability/limitation claim names the model it was measured on; a limitation measured on an older generation is a hypothesis to re-test, never a fact; a demonstrated ability may be assumed to carry forward; old failure modes stay risks to measure, not rates to quote.

## Two modes — the script always works

**Mode A — the ladder script.** It needs NO setup: with no config it rides the public Google News RSS feed — free, keyless, real dates (news sites only). With a free API key in `~/.latest-search/config.json` (Tavily/Serper/Brave — see the README) the same ladder covers the full web. A keyed engine that errors falls back to the news feed by itself and prints a `FALLBACK:` line.

**Mode B — manual discipline** on the built-in WebSearch/WebFetch: used for the detail phase after the ladder, and as the whole procedure only when the script cannot run at all (no Node, or every engine blocked). Weaker — no true date filter — but the rules still hold.

Check the engine with: `node "${CLAUDE_PLUGIN_ROOT}/scripts/latest-search.mjs" --check`. If `CLAUDE_PLUGIN_ROOT` is not set in your environment, the script lives at `../../scripts/latest-search.mjs` relative to this file.

## Procedure — Mode A (the ladder)

1. **Ladder first, by machine.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/latest-search.mjs" "<topic>"`. It walks past hour (news/Serper) → day → week → month → year → any time and stops at the first rung with hits. On the keyless news engine, cite results by title + source (the links are Google News redirects — open the article via WebFetch when you need its text). Output: a `SOURCE | RUNG | tried` line, `NEWEST: <age>`, then numbered rows `date | title | url` + snippet. The `NEWEST` age and the names/versions inside the rows are the **current anchor**. One run per topic per session; reuse it for follow-ups. Flags: `--rung h|d|w|m|y|any` (force one rung), `--max 20`, `--json`.
2. **Primary page + its date.** Open the official page (help center, pricing page, release notes, changelog) and read its "Updated …" / published line. The official page beats every aggregator.
3. **Detail searches anchored.** Follow-up WebSearch/WebFetch queries now carry the version/date the ladder found (or the current month + year — never a year you remember). A source naming an older version/year than the ladder found is stale → re-search; never patch an old number into the answer.
4. **Newest wins; stamp it.** A newer dated source beats an older one unless it is an unconfirmed rumor; say which you took. Every changing fact in the answer carries "as of \<date\>, \<version\>". If the ladder only found hits at month/year/any-time, lead with "newest source found is from \<date\>", say the fact may have changed since, and still answer in full — only *silent* staleness is banned.

## Procedure — Mode B (no adapter, built-in search only)

Same rules, done by hand:

1. **Search newest-first.** Run WebSearch for the topic. For every result you intend to use, find its publish/updated date (on the page — never trust the URL slug). If the top results are undated or old, re-search with the current month + year appended (today's real date — it is in your environment context, use that, never a remembered year).
2. **Prefer primary, dated pages** — official changelogs, release notes, pricing pages, newsrooms. An undated page is a weak source *for a changeable fact* (for evidence it is not — see Scope).
3. **Anchor and stamp exactly as in Mode A** steps 3–4.
4. **Label honestly when verification fails.** If you cannot establish a date for a claim you must still make, label it explicitly: `undated/unverified as of <today>`. Never fall back to "what I remember" silently — memory is the oldest source in the room.

## When the script complains
- `ENGINE ERROR` + `FALLBACK:` line (exit 0): the keyed engine failed and the news feed answered instead — use those results; they are real and dated, just news-only.
- Exit 2 means EVERY engine failed (keyed engine AND the news feed); the stamp says `mode:"blocked"`. Fall back to Mode B and label every changeable-fact claim `undated/unverified — ladder blocked`. Never retry a rate-limited API in a loop.
- `COUNT: 0` at any-time: the topic genuinely has no coverage — say so; do not invent.

## Sub-agents / research fleets
Delegated research agents skip disciplines they were not built with. If you delegate web research, use the bundled `web-researcher` agent (this skill preloaded, ladder-first order of work, honest-labeling rules). For hard enforcement, the README documents a **freshness gate**: a PreToolUse hook that denies WebSearch/WebFetch to the researcher agent until the ladder stamp (`~/.latest-search/last-run.json`) is under 30 minutes old, and opens with a mandatory-labeling warning when the stamp says the ladder was tried but blocked. The gate catches "never ran", not "ran for a different topic" — each researcher must run the ladder for its *own* topic.
