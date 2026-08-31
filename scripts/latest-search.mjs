#!/usr/bin/env node
// latest-search.mjs — date-laddered web search with a pluggable engine.
// Walks past day -> week -> month -> year -> any time and stops at the first rung with hits,
// so the answer is anchored to the NEWEST sources that exist, not the best-ranked old page.
//
// Engine config (create once): ~/.latest-search/config.json
//   {"engine": "tavily" | "serper" | "brave", "key": "<your API key>"}
// Every engine has a free tier; see the plugin README for sign-up links and current limits.
//
// Usage:
//   node latest-search.mjs "<topic>"            run the ladder
//   node latest-search.mjs "<topic>" --rung w   force one rung (d|w|m|y|any)
//   node latest-search.mjs "<topic>" --max 20   more results per rung (default 10)
//   node latest-search.mjs "<topic>" --json     machine-readable output
//   node latest-search.mjs --check              print the configured engine and exit
//
// Exit codes: 0 = ran (even with 0 hits — that is an answer); 2 = no engine / engine blocked.
// Every run (including failures) writes a stamp to ~/.latest-search/last-run.json so the
// optional freshness gate (hooks/freshness-gate.mjs) can tell "ran" from "never ran" from
// "tried but blocked". Requires Node 18+ (global fetch).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CFG_DIR = join(homedir(), ".latest-search");
const CFG = join(CFG_DIR, "config.json");
const STAMP = join(CFG_DIR, "last-run.json");
const RUNGS = ["d", "w", "m", "y", "any"];
const RUNG_LABEL = { d: "past day", w: "past week", m: "past month", y: "past year", any: "any time" };

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
    if (c && c.engine && c.key) return c;
  } catch { /* missing or malformed */ }
  return null;
}

const cfg = loadConfig();

if (flags.check) {
  console.log(cfg ? `ENGINE: ${cfg.engine}` : "NO ENGINE");
  process.exit(cfg ? 0 : 2);
}

if (!query) {
  console.error('Usage: node latest-search.mjs "<topic>" [--rung d|w|m|y|any] [--max N] [--json]');
  process.exit(2);
}

if (!cfg) {
  console.log("NO ENGINE: create ~/.latest-search/config.json with {\"engine\":\"tavily|serper|brave\",\"key\":\"...\"}");
  console.log("Falling back is fine: follow the skill's Mode B (manual dated-search discipline).");
  writeStamp({ mode: "no-engine", rung: null, newest: null, count: 0 });
  process.exit(2);
}

// ---------- adapters ----------
// Each adapter: search(query, rung, max) -> [{title, url, date, snippet}]  (date: ISO string or null)

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

const ENGINES = { tavily, serper, brave };
const engine = ENGINES[cfg.engine];
if (!engine) {
  console.log(`NO ENGINE: unknown engine "${cfg.engine}" (supported: ${Object.keys(ENGINES).join(", ")})`);
  writeStamp({ mode: "no-engine", rung: null, newest: null, count: 0 });
  process.exit(2);
}

// ---------- ladder ----------
const ladder = flags.rung ? [flags.rung] : RUNGS;
const tried = [];
let hit = null;

for (const rung of ladder) {
  let rows;
  try {
    rows = await engine(query, rung, max);
  } catch (e) {
    console.log(`ENGINE ERROR at rung "${RUNG_LABEL[rung] || rung}": ${e.message}`);
    console.log("Fall back to the skill's Mode B and label changeable-fact claims undated/unverified.");
    writeStamp({ mode: "blocked", rung, newest: null, count: 0, error: String(e.message).slice(0, 200) });
    process.exit(2);
  }
  tried.push(`${rung}=${rows.length}`);
  if (rows.length > 0) { hit = { rung, rows }; break; }
}

if (!hit) {
  console.log(`SOURCE: ${cfg.engine} | RUNG: none | tried: ${tried.join(" ")}`);
  console.log(`COUNT: 0 at ${RUNG_LABEL[ladder[ladder.length - 1]] || ladder[ladder.length - 1]} — no coverage found; say so, do not invent.`);
  writeStamp({ mode: "ok", engine: cfg.engine, rung: "none", newest: null, count: 0 });
  process.exit(0);
}

const dates = hit.rows.map((r) => r.date).filter(Boolean).sort().reverse();
const newest = dates[0] || `(undated — rung "${RUNG_LABEL[hit.rung]}" bounds the age)`;

if (flags.json) {
  console.log(JSON.stringify({ engine: cfg.engine, rung: hit.rung, tried, newest, results: hit.rows }, null, 2));
} else {
  console.log(`SOURCE: ${cfg.engine} | RUNG: ${RUNG_LABEL[hit.rung]} | tried: ${tried.join(" ")}`);
  console.log(`NEWEST: ${newest}`);
  hit.rows.forEach((r, i) => {
    console.log(`${i + 1}. ${r.date || "undated"} | ${r.title}`);
    if (r.snippet) console.log(`   ${r.snippet}`);
    console.log(`   ${r.url}`);
  });
}
writeStamp({ mode: "ok", engine: cfg.engine, rung: hit.rung, newest, count: hit.rows.length });
process.exit(0);
