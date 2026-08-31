// freshness-reminder.mjs — WARN-ONLY PreToolUse reminder on WebSearch/WebFetch for the main thread.
// Purpose: keep every web search anchored to TODAY. Reports whether the /latest ladder ran in the
// last 30 minutes and what it found, and flags a query/URL anchored to an old year or month.
// It must NEVER deny (archive/history searches are real work) — whole body in try/catch, always exit 0.
// Wire it from settings.json — recipe in the plugin README.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const fallback = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext:
      "Freshness rule: for a changeable fact (version, price, limit, plan, feature, rule, latest) run the /latest skill first; date every source; stamp the answer with date + version.",
  },
};

try {
  const raw = readFileSync(0, "utf8");
  const j = JSON.parse(raw);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const ti = j.tool_input || {};
  let text = "";
  if (ti.query) text = String(ti.query);
  else if (ti.url) text = String(ti.url) + (ti.prompt ? " " + String(ti.prompt) : "");

  const lines = [`Today is ${today}.`];

  // 1) Did the /latest ladder run recently?
  let ran = false;
  try {
    const s = JSON.parse(readFileSync(join(homedir(), ".latest-search", "last-run.json"), "utf8"));
    const ageMin = (now.getTime() - Date.parse(s.ts)) / 60000;
    if (ageMin >= 0 && ageMin <= 30 && s.mode === "ok") {
      ran = true;
      lines.push(
        `/latest ran ${Math.floor(ageMin)} min ago for "${s.query}" — rung: ${s.rung}, newest source: ${s.newest}, ${s.count} results. Anchor this query to that version/date.`
      );
    } else if (ageMin >= 0 && ageMin <= 30) {
      ran = true;
      lines.push(
        `/latest was tried ${Math.floor(ageMin)} min ago for "${s.query}" but returned no dated results (${s.mode}). Use the manual dated-search discipline and label changeable-fact claims undated/unverified.`
      );
    }
  } catch { /* no stamp */ }
  if (!ran) {
    lines.push(
      `No /latest run in the last 30 min. For a changeable fact (version, model, price, limit, plan, feature, rule, schedule, "latest") use the /latest skill FIRST (date-laddered search, newest rung with hits wins). Evidence/history searches: fine as-is.`
    );
  }

  // 2) Old time anchor in the query / URL?
  const months = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  const monthNum = (name) =>
    ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(name.slice(0, 3).toLowerCase()) + 1;
  let anchor = null;
  const m = text.match(new RegExp(`\\b(${months})\\.?\\s+((19|20)\\d{2})\\b`, "i"));
  const iso = text.match(/\b((19|20)\d{2})[/-](0?[1-9]|1[0-2])\b/);
  if (m) anchor = { y: +m[2], m: monthNum(m[1]), label: `${m[1]} ${m[2]}` };
  else if (iso) anchor = { y: +iso[1], m: +iso[3], label: `${iso[1]}-${iso[3]}` };
  else {
    const years = (text.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    if (years.length) {
      const y = Math.min(...years);
      if (y < now.getFullYear()) anchor = { y, m: 0, label: String(y) };
    }
  }
  if (anchor) {
    if (anchor.m > 0) {
      const diff = (now.getFullYear() - anchor.y) * 12 + (now.getMonth() + 1 - anchor.m);
      if (diff > 0)
        lines.push(
          `This query/URL is anchored to ${anchor.label} (~${diff} month(s) old) — fine for history; for a current fact re-anchor to what /latest found.`
        );
    } else {
      const yd = now.getFullYear() - anchor.y;
      lines.push(
        `This query/URL is anchored to ${anchor.label} (${yd === 1 ? "last year" : `${yd} years ago`}) — fine for history; for a current fact re-anchor to what /latest found (today: ${today}).`
      );
    }
  }

  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: lines.join(" ") } })
  );
} catch {
  process.stdout.write(JSON.stringify(fallback));
}
process.exit(0);
