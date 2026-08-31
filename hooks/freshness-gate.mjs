// freshness-gate.mjs — BLOCKING PreToolUse gate on WebSearch/WebFetch for the web-researcher agent.
// Purpose: delegated research agents must run the /latest ladder BEFORE any web search on a changeable
// fact. The companion hook (freshness-reminder.mjs) only warns; this one DENIES the call unless the
// ladder script wrote its stamp (~/.latest-search/last-run.json) in the last 30 minutes.
// Acts ONLY when the hook input's agent_type matches LATEST_GATE_AGENT (default "web-researcher");
// everyone else (main thread, other agents) passes with no output.
// A stamp with mode "blocked" or "no-engine" OPENS the gate with a mandatory-labeling warning instead
// of dead-ending the researcher — a broken search engine must not stop real research, but silent
// staleness is banned.
// Fail-open: if anything in here throws, the call is allowed.
// Wire it from settings.json — recipe in the plugin README.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function out(obj) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...obj } }));
}

try {
  const raw = readFileSync(0, "utf8");
  const j = JSON.parse(raw);
  const gateAgent = process.env.LATEST_GATE_AGENT || "web-researcher";
  const agentType = String(j.agent_type || "");
  // Plugin agents may be namespaced ("latest:web-researcher") — match the bare name too.
  if (agentType !== gateAgent && !agentType.endsWith(":" + gateAgent)) process.exit(0);

  const today = new Date().toISOString().slice(0, 10);
  const stampPath = join(homedir(), ".latest-search", "last-run.json");
  let s = null, ageMin = -1;
  try {
    s = JSON.parse(readFileSync(stampPath, "utf8"));
    ageMin = (Date.now() - Date.parse(s.ts)) / 60000;
  } catch { /* no stamp yet */ }

  if (ageMin >= 0 && ageMin <= 30) {
    if (s.mode === "blocked" || s.mode === "no-engine") {
      out({
        additionalContext:
          `Gate OPEN with a warning: the /latest ladder was tried ${Math.floor(ageMin)} min ago for "${s.query}" but did not return dated results (${s.mode}). ` +
          `You may WebSearch/WebFetch, but label EVERY changeable-fact claim "undated/unverified — ladder unavailable, as of ${today}", ` +
          `prefer official primary pages, and never fill gaps from memory.`,
      });
    } else {
      out({
        additionalContext:
          `Gate OK: /latest ran ${Math.floor(ageMin)} min ago for "${s.query}" (rung: ${s.rung}, newest: ${s.newest}, ${s.count} results). ` +
          `If that run was for a DIFFERENT topic than this call, run the ladder again for your own topic first. Anchor the answer to the newest dated source.`,
      });
    }
  } else {
    const why = ageMin < 0
      ? "the /latest ladder has never run on this machine"
      : `the last /latest run was ${Math.floor(ageMin)} min ago (limit 30)`;
    out({
      permissionDecision: "deny",
      permissionDecisionReason:
        `BLOCKED by the web-researcher freshness gate: ${why}. Run it first for your topic: ` +
        `node "$CLAUDE_PLUGIN_ROOT/scripts/latest-search.mjs" "<topic>", read its dated results, THEN fetch/search. Today is ${today}.`,
    });
  }
} catch {
  // fail-open on purpose
}
process.exit(0);
