#!/usr/bin/env node
// latest-search.mjs — date-laddered web search with a pluggable engine.
// Walks past hour -> day -> week -> month -> year -> any time and stops at the first rung with
// hits, so the answer is anchored to the NEWEST sources that exist, not the best-ranked old page.
//
// Works with ZERO setup: the default engine is the public Google News RSS feed — free forever,
// no account, no key (news sites only; for full-web coverage add a key below).
// Optional engine config: ~/.latest-search/config.json
//   {"engine": "tavily" | "serper" | "brave", "key": "<your API key>"}
//   (or {"engine": "news"} to pin the keyless default explicitly)
// See the plugin README for sign-up links and current free allowances.
// If a keyed engine errors mid-run, the script falls back to the news feed by itself and
// prints a FALLBACK line — a broken engine never dead-ends the run.
//
// Usage:
//   node latest-search.mjs "<topic>"            run the ladder
//   node latest-search.mjs "<topic>" --rung w   force one rung (h|d|w|m|y|any)
//   node latest-search.mjs "<topic>" --max 20   more results per rung (default 10)
//   node latest-search.mjs "<topic>" --json     machine-readable output
//   node latest-search.mjs --check              print the configured engine and exit
//
// Exit codes: 0 = ran (even with 0 hits — that is an answer); 2 = every engine blocked.
// Every run (including failures) writes a stamp to ~/.latest-search/last-run.json so the
// optional freshness gate (hooks/freshness-gate.mjs) can tell "ran" from "never ran" from
// "tried but blocked". Requires Node 18+ (global fetch). No dependencies.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CFG_DIR = join(homedir(), ".latest-search");
const CFG = join(CFG_DIR, "config.json");
const STAMP = join(CFG_DIR, "last-run.json");
const RUNG_LABEL = { h: "past hour", d: "past day", w: "past week", m: "past month", y: "past year", any: "any time" };
// Serper passes tbs straight to Google, which supports a past-hour filter; Tavily and Brave start at past day.
const RUNGS_BY_ENGINE = {
  news: ["h", "d", "w", "m", "y", "any"],
  serper: ["h", "d", "w", "m", "y", "any"],
  tavily: ["d", "w", "m", "y", "any"],
  brave: ["d", "w", "m", "y", "any"],
};

// ---------- args ----------
const argv = process.argv.slice(2);
const flags = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--check" || a === "--json") flags[a.slice(2)] = true;
  else if (a === "--rung" || a === "--max") flags[a.slice(2)] = argv[++i];
  else words.push(a);
}
const query = words.join(" ").trim();
const max = Math.min(parseInt(flags.max || "10", 10) || 10, 20); // Tavily and Brave both cap at 20

function writeStamp(extra) {
  try {
    mkdirSync(CFG_DIR, { recursive: true });
    writeFileSync(STAMP, JSON.stringify({ ts: new Date().toISOString(), query, ...extra }));
  } catch { /* stamp is best-effort */ }
}

function loadConfig() {
  try {
    const c = JSON.parse(readFileSync(CFG, "utf8"));
    if (c && c.engine === "news") return { engine: "news" };
    if (c && c.engine && c.key) return c;
  } catch { /* missing or malformed -> keyless default */ }
  return { engine: "news" };
}

const cfg = loadConfig();

if (flags.check) {
  console.log(cfg.engine === "news" ? "ENGINE: news (keyless default — free, news sites only)" : `ENGINE: ${cfg.engine}`);
  process.exit(0);
}

if (!query) {
  console.error('Usage: node latest-search.mjs "<topic>" [--rung h|d|w|m|y|any] [--max N] [--json]');
  process.exit(2);
}

// ---------- adapters ----------
// Each adapter: search(query, rung, max) -> [{title, url, date, snippet}]  (date: ISO string or null)

// Keyless default: the public Google News RSS feed. Free forever, no account. News sites only,
// and its links are Google News redirect URLs — cite the title + source; open the article via
// WebFetch when the text itself is needed.
async function news(q, rung, n) {
  const when = { h: "1h", d: "1d", w: "7d", m: "30d", y: "1y" }[rung];
  const u = new URL("https://news.google.com/rss/search");
  u.searchParams.set("q", when ? `${q} when:${when}` : q);
  u.searchParams.set("hl", "en-US");
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`news feed HTTP ${r.status}`);
  const xml = await r.text();
  const items = [];
  const unescape = (s) =>
    s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return t ? unescape(t[1]) : "";
    };
    const pub = pick("pubDate");
    const d = pub ? new Date(pub) : null;
    items.push({
      title: pick("title"),
      url: pick("link"),
      date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null,
      snippet: pick("source") ? `source: ${pick("source")}` : "",
    });
    if (items.length >= n) break;
  }
  return items;
}

async function tavily(q, rung, n) {
  const body = { query: q, max_results: n, search_depth: "basic" };
  const tr = { d: "day", w: "week", m: "month", y: "year" }[rung];
  if (tr) body.time_range = tr;
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`tavily HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.results || []).map((x) => ({
    title: x.title, url: x.url, date: x.published_date || null, snippet: (x.content || "").slice(0, 300),
  }));
}

async function serper(q, rung, n) {
  const body = { q, num: n };
  if (rung !== "any") body.tbs = `qdr:${rung}`;
  const r = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": cfg.key },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`serper HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.organic || []).map((x) => ({
    title: x.title, url: x.link, date: x.date || null, snippet: (x.snippet || "").slice(0, 300),
  }));
}

async function brave(q, rung, n) {
  const fr = { d: "pd", w: "pw", m: "pm", y: "py" }[rung];
  const u = new URL("https://api.search.brave.com/res/v1/web/search");
  u.searchParams.set("q", q);
  u.searchParams.set("count", String(n));
  if (fr) u.searchParams.set("freshness", fr);
  const r = await fetch(u, { headers: { "X-Subscription-Token": cfg.key, Accept: "application/json" } });
  if (!r.ok) throw new Error(`brave HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return ((j.web && j.web.results) || []).map((x) => ({
    title: x.title, url: x.url, date: x.page_age || x.age || null, snippet: (x.description || "").slice(0, 300),
  }));
}

const ENGINES = { news, tavily, serper, brave };
if (!ENGINES[cfg.engine]) {
  console.error(`Unknown engine "${cfg.engine}" in ~/.latest-search/config.json (supported: ${Object.keys(ENGINES).join(", ")}).`);
  writeStamp({ mode: "blocked", rung: null, newest: null, count: 0, error: "unknown engine" });
  process.exit(2);
}

// ---------- ladder (with automatic fallback to the keyless news feed) ----------
if (flags.rung && !RUNG_LABEL[flags.rung]) {
  console.error(`Unknown rung "${flags.rung}" (use h|d|w|m|y|any).`);
  process.exit(2);
}
const chain = cfg.engine === "news" ? ["news"] : [cfg.engine, "news"];
let hit = null, used = null, tried = [], fellBack = false;

outer: for (const engineName of chain) {
  const engine = ENGINES[engineName];
  let rungs = RUNGS_BY_ENGINE[engineName];
  if (flags.rung) rungs = rungs.includes(flags.rung) || flags.rung === "any" ? [flags.rung] : rungs;
  tried = [];
  for (const rung of rungs) {
    let rows;
    try {
      rows = await engine(query, rung, max);
    } catch (e) {
      console.log(`ENGINE ERROR (${engineName}) at rung "${RUNG_LABEL[rung]}": ${e.message}`);
      if (engineName !== "news") {
        console.log("FALLBACK: trying the keyless Google News feed instead.");
        fellBack = true;
        continue outer;
      }
      console.log("Every engine failed. Fall back to the skill's Mode B and label changeable-fact claims undated/unverified.");
      writeStamp({ mode: "blocked", rung, newest: null, count: 0, error: String(e.message).slice(0, 200) });
      process.exit(2);
    }
    tried.push(`${rung}=${rows.length}`);
    if (rows.length > 0) { hit = { rung, rows }; used = engineName; break outer; }
  }
  used = engineName;
  break; // rungs exhausted with 0 hits everywhere — that is an answer, not a failure
}

const sourceLabel = used === "news" ? (fellBack ? "news (keyless fallback)" : "news (keyless)") : used;

if (!hit) {
  console.log(`SOURCE: ${sourceLabel} | RUNG: none | tried: ${tried.join(" ")}`);
  const deepest = tried.length ? RUNG_LABEL[tried[tried.length - 1].split("=")[0]] : "any time";
  console.log(`COUNT: 0 at ${deepest} — no coverage found; say so, do not invent.`);
  writeStamp({ mode: "ok", engine: used, rung: "none", newest: null, count: 0 });
  process.exit(0);
}

const dates = hit.rows.map((r) => r.date).filter(Boolean).sort().reverse();
const newest = dates[0] || `(undated — rung "${RUNG_LABEL[hit.rung]}" bounds the age)`;

if (flags.json) {
  console.log(JSON.stringify({ engine: used, fellBack, rung: hit.rung, tried, newest, results: hit.rows }, null, 2));
} else {
  console.log(`SOURCE: ${sourceLabel} | RUNG: ${RUNG_LABEL[hit.rung]} | tried: ${tried.join(" ")}`);
  console.log(`NEWEST: ${newest}`);
  hit.rows.forEach((r, i) => {
    console.log(`${i + 1}. ${r.date || "undated"} | ${r.title}`);
    if (r.snippet) console.log(`   ${r.snippet}`);
    console.log(`   ${r.url}`);
  });
  if (used === "news") console.log("NOTE: news-feed links are Google News redirects — cite title + source; open the article via WebFetch when you need its text. News sites only; add a free API key (see README) for full-web coverage.");
}
writeStamp({ mode: "ok", engine: used, rung: hit.rung, newest, count: hit.rows.length });
process.exit(0);
