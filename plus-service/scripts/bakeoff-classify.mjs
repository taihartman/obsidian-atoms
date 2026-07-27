#!/usr/bin/env node
/**
 * Plus classify model/effort bake-off — offline against server template.
 * Does NOT hit prod meter; calls Anthropic directly with buildClassifyPayload shape.
 *
 * Usage:
 *   set -a && source plus-service/.env && set +a
 *   node plus-service/scripts/bakeoff-classify.mjs
 *   node plus-service/scripts/bakeoff-classify.mjs --arms=sonnet-high,sonnet-low,opus-low
 *
 * Never logs API keys or full capture bodies in the summary JSON written to docs/qa.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVICE = path.join(ROOT, "plus-service");

// Load local .env without printing values
async function loadDotEnv() {
  try {
    const raw = await fs.readFile(path.join(SERVICE, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

await loadDotEnv();

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY (plus-service/.env or env).");
  process.exit(1);
}

// Isolate config from bakeoff env pollution before import
delete process.env.ATOMS_PLUS_EFFORT;
// Default model is overridden per arm
const { buildClassifyPayload } = await import("../src/anthropic.mjs");
const { config } = await import("../src/config.mjs");

const API_URL = config.anthropicUrl;
const VERSION = config.anthropicVersion;

/** Published list rates USD / MTok (mid-2026). Cache: write ~1.25× input, read ~0.1×. */
const RATES = {
  sonnet: {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  opus: {
    input: 15,
    output: 75,
    cacheWrite: 18.75,
    cacheRead: 1.5,
  },
};

function ratesFor(model) {
  return model.includes("opus") ? RATES.opus : RATES.sonnet;
}

/**
 * Realistic synthetic fixtures (not personal vault). Mix: people, media, ideas, noise, ambiguous.
 * expect: gold for auto-score; human rubric applied in the QA writeup.
 */
const FIXTURES = [
  {
    id: "walk-block",
    text: "09:14 short walk fixed the design block better than another hour at the desk",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "deep-work-break",
    text: "14:02 deep work only sticks when I protect a real break after",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "jordan-critiques",
    text: "10:20 Jordan said morning design critiques land better than late afternoon",
    expect: { verdict: "atom", linkHint: "Jordan" },
    category: "people",
  },
  {
    id: "jordan-periwinkle",
    text: "Jordan likes the color periwinkle",
    expect: { verdict: "atom", linkHint: "Jordan" },
    category: "people",
  },
  {
    id: "riley-arrival",
    text: "20:05 Riley said rewatch Arrival for the linguistics angle",
    expect: { verdict: "atom", linkHint: "Riley" },
    category: "media",
  },
  {
    id: "sam-designer",
    text: "Sam is the name of the really strong designer at Studio. Usually wears white collared shirt",
    expect: { verdict: "atom" },
    category: "people",
  },
  {
    id: "capture-scarce",
    text: "08:40 capture is cheap; the scarce resource is a calm review pass later",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "planning-question",
    text: "16:11 what would make tomorrow's planning feel light instead of heavy?",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "starbucks-pitch",
    text: "Personal starbucks weekend drink order tracker website. Please create a modern website to log weekend Starbucks drinks publicly with private write access and AI fun facts.",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "noise-dentist",
    text: "schedule dentist",
    expect: { verdict: "noise" },
    category: "noise",
  },
  {
    id: "noise-landlord",
    text: "email landlord about the lock",
    expect: { verdict: "noise" },
    category: "noise",
  },
  {
    id: "friday-reviews",
    text: "still thinking about whether weekly reviews should stay on Fridays",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "mind-change-sleep",
    text: "wait — sleep debt DOES compound for me; the plateau thing was cope. earlier me was wrong",
    expect: { verdict: "atom", linkHint: "Sleep" },
    category: "idea",
  },
  {
    id: "list-shows",
    text: "shows to watch: Severance S2, The Bear, something light for flights",
    expect: { verdict: "atom" },
    category: "media",
  },
  {
    id: "noise-milk",
    text: "buy oat milk and eggs on the way home",
    expect: { verdict: "noise" },
    category: "noise",
  },
  {
    id: "noise-calendar",
    text: "dentist rescheduled to Thursday 3pm",
    expect: { verdict: "noise" },
    category: "noise",
  },
  {
    id: "plus-product",
    text: "what if Atoms Plus was just managed keys so people don't need Anthropic accounts — few bucks a month",
    expect: { verdict: "atom" },
    category: "idea",
  },
  {
    id: "riley-meetings",
    text: "Riley gets drained by back-to-back meetings after 3pm — protect late afternoon for deep work when pairing with them",
    expect: { verdict: "atom", linkHint: "Riley" },
    category: "people",
  },
  {
    id: "noise-text-mom",
    text: "text mom back",
    expect: { verdict: "noise" },
    category: "noise",
  },
  {
    id: "jordan-bullets",
    text: "Jordan\n- periwinkle\n- hates late critiques\n- walking 1:1s > Zoom",
    expect: { verdict: "atom", linkHint: "Jordan" },
    category: "people",
  },
];

const VAULT_CONTEXT = {
  titles: [
    "Jordan",
    "Riley",
    "People",
    "Sleep debt doesn't accumulate linearly",
    "Deep work requires unbroken morning blocks",
    "App ideas",
    "Arrival",
    "Movies",
    "Shows",
    "Weekly review",
    "Atoms product notes",
    ...Array.from({ length: 30 }, (_, i) => `Archive scrap ${i + 1}`),
  ],
  tags: ["idea", "observation", "decision", "preference", "person", "media", "list"],
  vocabulary: [
    "idea",
    "observation",
    "decision",
    "preference",
    "question",
    "person",
    "preferences",
    "media",
    "list",
    "watch",
    "movie",
    "show",
    "project",
  ],
  personHubs: ["Jordan", "Riley", "People"],
};

const DEFAULT_ARMS = [
  { id: "sonnet-high", model: "claude-sonnet-5", effort: "high" },
  { id: "sonnet-low", model: "claude-sonnet-5", effort: "low" },
  { id: "sonnet-medium", model: "claude-sonnet-5", effort: "medium" },
  { id: "opus-low", model: "claude-opus-5", effort: "low" },
];

function parseArgs(argv) {
  const armsFlag = argv.find((a) => a.startsWith("--arms="));
  if (!armsFlag) return DEFAULT_ARMS;
  const ids = armsFlag
    .slice("--arms=".length)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const byId = Object.fromEntries(DEFAULT_ARMS.map((a) => [a.id, a]));
  return ids.map((id) => {
    if (byId[id]) return byId[id];
    // model@effort
    const [model, effort = "high"] = id.split("@");
    return { id, model, effort };
  });
}

function usageOf(json) {
  const u = json.usage || {};
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
}

function usdFor(usage, model) {
  const r = ratesFor(model);
  const baseIn = usage.input_tokens || 0;
  const cWrite = usage.cache_creation_input_tokens || 0;
  const cRead = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (
    (baseIn / 1e6) * r.input +
    (cWrite / 1e6) * r.cacheWrite +
    (cRead / 1e6) * r.cacheRead +
    (out / 1e6) * r.output
  );
}

function parseResult(json) {
  const block = (json.content || []).find((b) => b.type === "text");
  if (!block?.text) return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}

/**
 * Rubric 1–5 dimensions (auto-heuristic). Human can override in the QA doc.
 * - title usefulness
 * - link precision/recall vs obvious hubs
 * - noise vs atom correctness
 * - schema validity
 */
function scoreRubric(result, expect) {
  const dims = {
    schema: 1,
    verdict: 1,
    title: 1,
    links: 1,
  };
  const notes = [];

  if (!result || typeof result !== "object") {
    return {
      dims: { schema: 1, verdict: 1, title: 1, links: 1 },
      avg: 1,
      notes: ["invalid/missing JSON"],
    };
  }

  const hasFields =
    typeof result.verdict === "string" &&
    typeof result.title === "string" &&
    Array.isArray(result.tags) &&
    Array.isArray(result.proposed_tags) &&
    Array.isArray(result.links);
  dims.schema = hasFields ? 5 : 2;
  if (!hasFields) notes.push("schema incomplete");

  if (result.verdict === expect.verdict) dims.verdict = 5;
  else if (
    (expect.verdict === "noise" && result.verdict === "task") ||
    (expect.verdict === "task" && result.verdict === "noise")
  ) {
    dims.verdict = 3;
    notes.push(`near-miss verdict ${result.verdict}≠${expect.verdict}`);
  } else {
    dims.verdict = 1;
    notes.push(`verdict ${result.verdict}≠${expect.verdict}`);
  }

  if (expect.verdict === "atom") {
    const t = String(result.title || "").trim();
    if (!t) {
      dims.title = 1;
      notes.push("empty title on atom");
    } else if (t.length < 8 || t.length > 100) {
      dims.title = 2;
      notes.push("title length off");
    } else if (/^(notes|thoughts|stuff|update)\b/i.test(t)) {
      dims.title = 2;
      notes.push("topic-y title");
    } else {
      dims.title = 5;
    }
  } else {
    dims.title = !String(result.title || "").trim() ? 5 : 2;
    if (String(result.title || "").trim()) notes.push("noise/task should empty title");
  }

  const links = Array.isArray(result.links) ? result.links : [];
  const junk = links.filter((l) =>
    /^(related to|about |preference about|general |update about)/i.test(
      String(l?.reason || "").trim(),
    ),
  );
  if (junk.length) {
    dims.links = Math.min(dims.links, 2);
    notes.push("boilerplate link reason");
  }
  if (expect.linkHint) {
    const blob =
      JSON.stringify(links).toLowerCase() +
      " " +
      String(result.title || "").toLowerCase();
    if (blob.includes(expect.linkHint.toLowerCase())) {
      dims.links = Math.max(dims.links, junk.length ? 3 : 5);
    } else {
      dims.links = 2;
      notes.push(`missed hub ${expect.linkHint}`);
    }
  } else if (!junk.length) {
    dims.links = links.length ? 4 : 5;
  }

  if (result.verdict === "task") notes.push("emitted soft-retired task");

  const avg =
    (dims.schema + dims.verdict + dims.title + dims.links) / 4;
  return { dims, avg, notes };
}

function buildPayload(model, effort, capture) {
  process.env.ATOMS_PLUS_MODEL = model;
  if (effort) process.env.ATOMS_PLUS_EFFORT = effort;
  else delete process.env.ATOMS_PLUS_EFFORT;

  const built = buildClassifyPayload({
    capture,
    context: VAULT_CONTEXT,
  });
  if (!built.ok) throw new Error(built.message || "payload build failed");
  // Force model/effort even if config was cached oddly
  built.payload.model = model;
  if (effort) {
    built.payload.output_config = {
      ...built.payload.output_config,
      effort,
    };
  } else if (built.payload.output_config?.effort) {
    delete built.payload.output_config.effort;
  }
  return built.payload;
}

async function post(payload) {
  const t0 = performance.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  const ms = Math.round(performance.now() - t0);
  return { status: res.status, json, ms };
}

async function runArm(arm) {
  console.log(`\n=== ${arm.id} (${arm.model} effort=${arm.effort || "default"}) ===`);
  const rows = [];
  let totalUsd = 0;
  let totalMs = 0;
  let sumAvg = 0;
  let fails = 0;
  const dimSums = { schema: 0, verdict: 0, title: 0, links: 0 };

  for (const f of FIXTURES) {
    const payload = buildPayload(arm.model, arm.effort, f.text);
    const { status, json, ms } = await post(payload);
    totalMs += ms;

    if (status === 401 || status === 403) {
      console.error("auth failed", status, json?.error?.message || json?.error?.type);
      process.exit(1);
    }
    if (status < 200 || status >= 300) {
      fails += 1;
      const errMsg =
        json?.error?.message || json?.error?.type || `HTTP ${status}`;
      console.error(`  FAIL ${f.id}: ${errMsg}`);
      rows.push({
        id: f.id,
        category: f.category,
        error: String(errMsg).slice(0, 160),
        ms,
      });
      continue;
    }

    const usage = usageOf(json);
    const result = parseResult(json);
    const rubric = scoreRubric(result, f.expect);
    const usd = usdFor(usage, arm.model);
    totalUsd += usd;
    sumAvg += rubric.avg;
    for (const k of Object.keys(dimSums)) dimSums[k] += rubric.dims[k];

    rows.push({
      id: f.id,
      category: f.category,
      expectVerdict: f.expect.verdict,
      verdict: result?.verdict ?? null,
      // redacted title only (no body)
      title: result?.title ? String(result.title).slice(0, 100) : "",
      tags: (result?.tags || []).slice(0, 8),
      links: (result?.links || []).map((l) => ({
        note: String(l?.note || "").slice(0, 80),
        reason: String(l?.reason || "").slice(0, 120),
      })),
      usage,
      usd,
      ms,
      rubric,
    });

    const mark = rubric.avg >= 4.5 ? "✓" : rubric.avg >= 3 ? "·" : "✗";
    console.log(
      `  ${mark} ${f.id}: ${result?.verdict} | ${String(result?.title || "").slice(0, 44)} | Q ${rubric.avg.toFixed(1)} | $${usd.toFixed(4)} | ${ms}ms`,
    );
    if (rubric.notes.length) console.log(`      ${rubric.notes.join("; ")}`);
  }

  const n = FIXTURES.length;
  const ok = n - fails;
  const summary = {
    id: arm.id,
    model: arm.model,
    effort: arm.effort || "",
    fixtures: n,
    fails,
    totalUsd,
    usdPerFiling: n ? totalUsd / n : 0,
    projectedUsdAt150: n ? (totalUsd / n) * 150 : 0,
    projectedUsdAt200: n ? (totalUsd / n) * 200 : 0,
    avgMs: n ? Math.round(totalMs / n) : 0,
    qualityAvg: ok ? sumAvg / ok : 0,
    dimAvg: {
      schema: ok ? dimSums.schema / ok : 0,
      verdict: ok ? dimSums.verdict / ok : 0,
      title: ok ? dimSums.title / ok : 0,
      links: ok ? dimSums.links / ok : 0,
    },
    rows,
  };

  console.log(
    `  TOTAL Q ${summary.qualityAvg.toFixed(2)}/5 | $${summary.usdPerFiling.toFixed(5)}/filing | $${summary.projectedUsdAt150.toFixed(2)}@150 | avg ${summary.avgMs}ms | fails ${fails}`,
  );
  return summary;
}

const arms = parseArgs(process.argv.slice(2));
console.log("[bakeoff] key …" + apiKey.slice(-4));
console.log(
  "[bakeoff] arms",
  arms.map((a) => a.id).join(", "),
  "| fixtures",
  FIXTURES.length,
);

const results = [];
for (const arm of arms) {
  results.push(await runArm(arm));
}

const ranked = [...results].sort((a, b) => {
  // quality first, then cost
  if (Math.abs(b.qualityAvg - a.qualityAvg) > 0.05) return b.qualityAvg - a.qualityAvg;
  return a.usdPerFiling - b.usdPerFiling;
});

console.log("\n=== RANKING (quality ≥ then $/filing) ===");
for (const r of ranked) {
  console.log(
    `${r.id}: Q ${r.qualityAvg.toFixed(2)} | $${r.usdPerFiling.toFixed(5)}/f | $${r.projectedUsdAt150.toFixed(2)}@150 | ${r.avgMs}ms | fails ${r.fails}`,
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outJson = path.join("/tmp", `atoms-plus-effort-bakeoff-${stamp}.json`);
await fs.writeFile(
  outJson,
  JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      fixtures: FIXTURES.map((f) => ({
        id: f.id,
        category: f.category,
        expect: f.expect,
        // body length only — not full text in committed artifacts
        textLen: f.text.length,
      })),
      ranked,
      results,
    },
    null,
    2,
  ),
);
console.log("\n[bakeoff] wrote", outJson);
console.log("[bakeoff] path printed for QA doc assembly — no prod default change.");
