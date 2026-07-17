#!/usr/bin/env node
/**
 * Atoms Plus model bakeoff — realistic vault context + gold fixtures.
 *
 * Usage (prefer tsx so enrich modules load):
 *   ANTHROPIC_API_KEY=sk-… npx tsx scripts/plus-model-bakeoff.mjs
 *   ANTHROPIC_API_KEY=sk-… npx tsx scripts/plus-model-bakeoff.mjs --with-enrich
 *   ANTHROPIC_API_KEY=sk-… npx tsx scripts/plus-model-bakeoff.mjs --thinking
 *
 * Never prints the key. Summary → /tmp/atoms-plus-bakeoff-<ts>.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

let enrichMods = null;
async function loadEnrich() {
  if (enrichMods) return enrichMods;
  try {
    const ideaRescue = await import("../src/pipeline/enrich/ideaRescue.ts");
    const people = await import("../src/pipeline/enrich/people.ts");
    const media = await import("../src/pipeline/enrich/media.ts");
    const linkQuality = await import("../src/pipeline/enrich/linkQuality.ts");
    enrichMods = { ideaRescue, people, media, linkQuality };
  } catch (e) {
    console.error(
      "[bakeoff] enrich import failed — run with: npx tsx scripts/plus-model-bakeoff.mjs",
      e.message,
    );
    enrichMods = null;
  }
  return enrichMods;
}

function applyEnrich(capture, result, titles, hubs) {
  if (!enrichMods || !result) return result;
  const { ideaRescue, people, media, linkQuality } = enrichMods;
  let r = ideaRescue.rescueKeepableIdea(capture, result, titles);
  r = people.enrichPersonLinks(capture, r, hubs);
  r = media.enrichMediaLinks(capture, r, titles);
  r = linkQuality.improveClassificationLinks(capture, r);
  r = linkQuality.stripSelfReferentialLinks(r, titles);
  return r;
}

const API_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO = path.join(ROOT, "docs/media/demo-vault");

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY to run the bakeoff.");
  process.exit(1);
}

/** USD / MTok — aligned with src/pipeline/backfill.ts */
const RATES = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 3, output: 15 },
  opus: { input: 15, output: 75 },
};

function ratesFor(model) {
  if (model.includes("haiku")) return RATES.haiku;
  if (model.includes("opus")) return RATES.opus;
  return RATES.sonnet;
}

// Subset of production classify system prompt (src/pipeline/classify.ts) — keep in sync when bakeoff changes.
const SYSTEM = `You classify fleeting captures from a daily-note inbox into a personal knowledge graph (second brain). This product is NOT a task app — the user has Reminders/Things for chores.

## Output surface (hard rules)
- You output ONLY: verdict, title, tags, proposed_tags, links.
- You never rewrite, paraphrase, expand, or "improve" the capture body. The body is sacred and is written elsewhere, verbatim.
- You never choose folders or move files. Placement is not your job. One capture → at most one atom (never append into a Movies/list note).
- Titles (when atom) are **short declarative claims** (~8–12 words / under ~80 characters when possible), not topics and not a paste of the whole capture.
  Good: "Sleep debt doesn't accumulate linearly"
  Bad: "Sleep notes" / "Thoughts on sleep"
  Good (person): "Alex prefers periwinkle and soft pajamas"
  Bad (person): "Girlfriend notes" / "Alex stuff"
  Good (list/media): "Want to watch Past Lives" / "Severance season 2 is on the list"
  Bad (list/media): "Movies" / "Watchlist notes"

## Triage (second brain)
- atom: anything worth meeting again in the graph — claims, observations, decisions, preferences, questions, **list/media dumps**, **and product/app/build ideas**. If the user would want to find it later, it is an atom.
- noise: pure logistics, empty, or not worth keeping ("buy milk", "email landlord", "call dentist at 3"). When in doubt between task and noise → **noise**. When in doubt between atom and noise for keepable content → **atom**.
- task: **soft-retired / almost never**. Do not use task for list items, media, preferences, people facts, or product ideas. Prefer noise for chores.
- Durable facts about people you know are usually atoms, not noise.
- List dumps are **one atom per capture**, with a declarative title.
- Product idea test: multi-sentence "create a website/app" pitches are **atoms**, never task/noise.

## Links
- Prefer exact existing note titles from context when linking.
- Link reasons must be substantive — if wikilinks were stripped, the sentence still teaches something.
- Prefer revises/contradicts when the capture changes an earlier claim.
- Never bare "preference about X" or "related to Y".

## Tags
- tags: only from Active vocabulary in context.
- proposed_tags: new tags not in Active; never auto-applied.
`;

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["atom", "task", "noise"] },
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    proposed_tags: { type: "array", items: { type: "string" } },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          note: { type: "string" },
          reason: { type: "string" },
        },
        required: ["note", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "title", "tags", "proposed_tags", "links"],
  additionalProperties: false,
};

/** Gold fixtures: demo-vault + realistic hard cases. */
const FIXTURES = [
  // --- From demo vault (known good atoms / noise) ---
  {
    id: "demo-walk",
    text: "09:14 short walk fixed the design block better than another hour at the desk",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-deep-work",
    text: "14:02 deep work only sticks when I protect a real break after",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-jordan-critiques",
    text: "10:20 Jordan said morning design critiques land better than late afternoon",
    expect: { verdict: "atom", linkHint: "Jordan" },
  },
  {
    id: "demo-periwinkle",
    text: "Jordan likes the color periwinkle",
    expect: { verdict: "atom", linkHint: "Jordan" },
  },
  {
    id: "demo-arrival",
    text: "20:05 Riley said rewatch Arrival for the linguistics angle",
    expect: { verdict: "atom", linkHint: "Arrival" },
  },
  {
    id: "demo-sam",
    text: "Sam is the name of the really strong designer at Studio. Usually wears white collared shirt",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-capture-scarce",
    text: "08:40 capture is cheap; the scarce resource is a calm review pass later",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-question",
    text: "16:11 what would make tomorrow's planning feel light instead of heavy?",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-starbucks-pitch",
    text: "Personal starbucks weekend drink order tracker website. Please create a modern website to log weekend Starbucks drinks publicly with private write access and AI fun facts.",
    expect: { verdict: "atom", linkHint: "App ideas" },
  },
  {
    id: "demo-dentist-noise",
    text: "schedule dentist",
    expect: { verdict: "noise" },
  },
  {
    id: "demo-landlord-noise",
    text: "email landlord about the lock",
    expect: { verdict: "noise" },
  },
  {
    id: "demo-today-open",
    text: "still thinking about whether weekly reviews should stay on Fridays",
    expect: { verdict: "atom" },
  },
  {
    id: "demo-focus-block",
    text: "try a 25-minute focus block before messages",
    expect: { verdict: "atom" },
  },
  // --- Harder realistic cases ---
  {
    id: "mind-change-sleep",
    text: "wait — sleep debt DOES compound for me; the plateau thing was cope. earlier me was wrong",
    expect: { verdict: "atom", linkHint: "Sleep" },
  },
  {
    id: "hedged-context-rot",
    text: "not sure but I think context-rot is why rewriting my notes with AI feels wrong — the hedges are the point",
    expect: { verdict: "atom" },
  },
  {
    id: "list-shows",
    text: "shows to watch: Severance S2, The Bear, something light for flights",
    expect: { verdict: "atom" },
  },
  {
    id: "errand-milk",
    text: "buy oat milk and eggs on the way home",
    expect: { verdict: "noise" },
  },
  {
    id: "calendar-noise",
    text: "dentist rescheduled to Thursday 3pm",
    expect: { verdict: "noise" },
  },
  {
    id: "plus-product-idea",
    text: "what if Atoms Plus was just managed keys so people don't need Anthropic accounts — few bucks a month",
    expect: { verdict: "atom" },
  },
  {
    id: "riley-meeting",
    text: "Riley gets drained by back-to-back meetings after 3pm — protect late afternoon for deep work when pairing with them",
    expect: { verdict: "atom", linkHint: "Riley" },
  },
  {
    id: "ambiguous-maybe-noise",
    text: "text mom back",
    expect: { verdict: "noise" },
  },
  {
    id: "multi-line-pref",
    text: "Jordan\n- periwinkle\n- hates late critiques\n- walking 1:1s > Zoom",
    expect: { verdict: "atom", linkHint: "Jordan" },
  },
  {
    id: "self-meta",
    text: "Atoms should never rewrite capture bodies — the half-formedness is the point",
    expect: { verdict: "atom" },
  },
  {
    id: "emptyish",
    text: "…",
    expect: { verdict: "noise" },
  },
];

async function collectDemoTitles() {
  const titles = new Set();
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) titles.add(e.name.replace(/\.md$/, ""));
    }
  }
  await walk(DEMO);
  // Realistic scale: pad to ~180 titles like a lived-in vault
  for (let i = 1; i <= 150; i++) titles.add(`Archive note ${i} — project scrap ${i % 17}`);
  titles.add("Sleep debt doesn't accumulate linearly");
  titles.add("Deep work requires unbroken morning blocks");
  return [...titles].sort();
}

function buildContext(titles) {
  return [
    "## Vault context",
    "### Active vocabulary",
    "#idea #observation #decision #preference #question #person #preferences #media #list #watch #movie #project",
    "### Person hubs (titles only)",
    "- Jordan",
    "- Riley",
    "- People",
    "### Note titles",
    ...titles.map((t) => `- ${t}`),
  ].join("\n");
}

function parseArgs(argv) {
  const withThinking = argv.includes("--thinking");
  const withEnrich = argv.includes("--with-enrich") || argv.includes("--enrich");
  const modelsFlag = argv.find((a) => a.startsWith("--models="));
  // Default: haiku, sonnet-5 (current default), sonnet-4-5 (older/lower tier sonnet)
  const models = modelsFlag
    ? modelsFlag
        .slice("--models=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-sonnet-5"];
  return { models, withThinking, withEnrich };
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
  const inTok =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  return (inTok / 1e6) * r.input + (outTok / 1e6) * r.output;
}

function parseText(json) {
  const block = (json.content || []).find((b) => b.type === "text");
  if (!block?.text) return null;
  try {
    return JSON.parse(block.text);
  } catch {
    return null;
  }
}

function score(result, expect) {
  const notes = [];
  let points = 0;
  let max = 2;
  if (!result) {
    notes.push("invalid/missing JSON");
    return { points: 0, max, notes };
  }
  points += 1;
  if (result.verdict === expect.verdict) points += 1;
  else notes.push(`verdict ${result.verdict}≠${expect.verdict}`);

  if (expect.verdict === "atom") {
    max += 2;
    if (result.title && result.title.trim().length >= 8 && result.title.length <= 120) points += 1;
    else notes.push("weak/empty/long title");
    if (expect.linkHint) {
      const blob = JSON.stringify(result.links || []).toLowerCase() + " " + String(result.title || "").toLowerCase();
      if (blob.includes(expect.linkHint.toLowerCase())) points += 1;
      else notes.push(`missed link/title hint ${expect.linkHint}`);
    } else points += 1;
  } else {
    max += 1;
    if (!result.title || !result.title.trim()) points += 1;
    else notes.push("noise should empty title");
  }
  if (result.verdict === "task") notes.push("emitted soft-retired task");
  const junk = (result.links || []).filter((l) =>
    /^(related to|about |preference about|general )/i.test(String(l.reason || "").trim()),
  );
  if (junk.length) notes.push("boilerplate link reason");
  return { points, max, notes };
}

async function post(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function classifyOne(model, captureText, contextText, thinking) {
  const body = {
    model,
    max_tokens: thinking ? 4096 : 1024,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: contextText,
            cache_control: { type: "ephemeral", ttl: "5m" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: `## Capture\n\n${captureText}\n\nClassify this single capture.` }],
      },
    ],
    output_config: {
      format: { type: "json_schema", schema: CLASSIFICATION_SCHEMA },
    },
  };
  if (thinking) body.thinking = { type: "enabled", budget_tokens: 1024 };
  return post(body);
}

async function runConfig(model, thinking, contextText, titles, hubs, withEnrich) {
  const label =
    (thinking ? `${model}+thinking1024` : model) + (withEnrich ? "+enrich" : "");
  console.log(`\n=== ${label} ===`);
  console.log(
    `  context chars: ${contextText.length} | fixtures: ${FIXTURES.length} | enrich: ${withEnrich}`,
  );

  const rows = [];
  let totalUsd = 0;
  let totalPoints = 0;
  let totalMax = 0;
  let fails = 0;
  let enrichFlips = 0;

  for (const f of FIXTURES) {
    const { status, json } = await classifyOne(model, f.text, contextText, thinking);
    if (status === 401 || status === 403) {
      console.error("auth failed", status, json?.error?.message || json?.error?.type);
      process.exit(1);
    }
    if (status < 200 || status >= 300) {
      fails += 1;
      console.error(
        `  FAIL ${f.id}:`,
        status,
        json?.error?.type || json?.error?.message || String(json?.type || "").slice(0, 120),
      );
      rows.push({ id: f.id, error: status });
      if (thinking && (status === 400 || status === 404)) {
        console.error("  (aborting thinking config — unsupported)");
        return {
          label,
          model,
          thinking: true,
          withEnrich,
          unsupported: true,
          scoreRatio: 0,
          totalUsd: 0,
          usdPerFiling: 0,
          projectedUsdAt200: 0,
          projectedUsdAt400: 0,
          score: "0/0",
          fails,
          rows,
        };
      }
      continue;
    }
    const usage = usageOf(json);
    let result = parseText(json);
    const rawVerdict = result?.verdict;
    if (withEnrich) {
      result = applyEnrich(f.text, result, titles, hubs);
      if (result?.verdict !== rawVerdict) enrichFlips += 1;
    }
    const sc = score(result, f.expect);
    const usd = usdFor(usage, model);
    totalUsd += usd;
    totalPoints += sc.points;
    totalMax += sc.max;
    rows.push({
      id: f.id,
      verdict: result?.verdict,
      rawVerdict,
      title: result?.title,
      score: sc,
      usage,
      usd,
    });
    const mark = sc.points === sc.max ? "✓" : "·";
    const flip =
      withEnrich && rawVerdict !== result?.verdict ? ` [enrich ${rawVerdict}→${result?.verdict}]` : "";
    console.log(
      `  ${mark} ${f.id}: ${result?.verdict} | ${String(result?.title || "").slice(0, 48)} | ${sc.points}/${sc.max} | $${usd.toFixed(4)}${flip}`,
    );
    if (sc.notes.length) console.log(`      ${sc.notes.join("; ")}`);
  }

  const summary = {
    label,
    model,
    thinking: Boolean(thinking),
    withEnrich: Boolean(withEnrich),
    fixtures: FIXTURES.length,
    fails,
    enrichFlips,
    score: `${totalPoints}/${totalMax}`,
    scoreRatio: totalMax ? totalPoints / totalMax : 0,
    totalUsd,
    usdPerFiling: FIXTURES.length ? totalUsd / FIXTURES.length : 0,
    projectedUsdAt200: FIXTURES.length ? (totalUsd / FIXTURES.length) * 200 : 0,
    projectedUsdAt400: FIXTURES.length ? (totalUsd / FIXTURES.length) * 400 : 0,
    contextChars: contextText.length,
    rows,
  };
  console.log(
    `  TOTAL ${summary.score} (${(summary.scoreRatio * 100).toFixed(0)}%) | $${totalUsd.toFixed(4)} | $${summary.usdPerFiling.toFixed(5)}/filing | $${summary.projectedUsdAt400.toFixed(2)}@400/mo | fails ${fails} | enrichFlips ${enrichFlips}`,
  );
  return summary;
}

const { models, withThinking, withEnrich } = parseArgs(process.argv.slice(2));
const titles = await collectDemoTitles();
const contextText = buildContext(titles);

// Minimal person hubs for enrichPersonLinks (demo vault)
const hubs = [
  {
    canonicalTitle: "Jordan",
    matchKeys: ["jordan"],
    path: "People/Jordan.md",
  },
  {
    canonicalTitle: "Riley",
    matchKeys: ["riley"],
    path: "People/Riley.md",
  },
];

if (withEnrich) {
  const mods = await loadEnrich();
  if (!mods) process.exit(1);
  console.log("[bakeoff] enrich modules loaded");
}

console.log("[bakeoff] key …" + apiKey.slice(-4));
console.log("[bakeoff] models", models, "thinking", withThinking, "enrich", withEnrich);
console.log("[bakeoff] titles in context", titles.length, "fixtures", FIXTURES.length);

/** One API pass; score raw and (optional) enriched from the same responses. */
async function runModelPair(model, thinking, contextText, titles, hubs, alsoEnrich) {
  const base = thinking ? `${model}+thinking1024` : model;
  console.log(`\n=== ${base} (API once${alsoEnrich ? "; score raw + enrich" : ""}) ===`);
  console.log(`  context chars: ${contextText.length} | fixtures: ${FIXTURES.length}`);

  const rawRows = [];
  const enrRows = [];
  let totalUsd = 0;
  let rawPts = 0;
  let enrPts = 0;
  let totalMax = 0;
  let fails = 0;
  let enrichFlips = 0;

  for (const f of FIXTURES) {
    const { status, json } = await classifyOne(model, f.text, contextText, thinking);
    if (status === 401 || status === 403) {
      console.error("auth failed", status, json?.error?.message || json?.error?.type);
      process.exit(1);
    }
    if (status < 200 || status >= 300) {
      fails += 1;
      console.error(
        `  FAIL ${f.id}:`,
        status,
        json?.error?.type || json?.error?.message || String(json?.type || "").slice(0, 120),
      );
      if (thinking && (status === 400 || status === 404)) {
        return [
          {
            label: base,
            model,
            thinking: Boolean(thinking),
            withEnrich: false,
            unsupported: true,
            scoreRatio: 0,
            totalUsd: 0,
            usdPerFiling: 0,
            projectedUsdAt200: 0,
            projectedUsdAt400: 0,
            score: "0/0",
            fails,
            rows: [],
          },
        ];
      }
      continue;
    }
    const usage = usageOf(json);
    const raw = parseText(json);
    const enr = alsoEnrich ? applyEnrich(f.text, structuredClone(raw), titles, hubs) : null;
    const usd = usdFor(usage, model);
    totalUsd += usd;

    const scRaw = score(raw, f.expect);
    rawPts += scRaw.points;
    totalMax += scRaw.max;
    rawRows.push({ id: f.id, verdict: raw?.verdict, title: raw?.title, score: scRaw, usd });

    if (alsoEnrich && enr) {
      const scEnr = score(enr, f.expect);
      enrPts += scEnr.points;
      if (enr.verdict !== raw?.verdict) enrichFlips += 1;
      enrRows.push({
        id: f.id,
        verdict: enr.verdict,
        rawVerdict: raw?.verdict,
        title: enr.title,
        score: scEnr,
        usd,
      });
      const mark = scEnr.points === scEnr.max ? "✓" : "·";
      const flip =
        enr.verdict !== raw?.verdict ? ` [enrich ${raw?.verdict}→${enr.verdict}]` : "";
      const delta =
        scEnr.points !== scRaw.points ? ` raw ${scRaw.points}/${scRaw.max}` : "";
      console.log(
        `  ${mark} ${f.id}: ${enr.verdict} | ${String(enr.title || "").slice(0, 48)} | enrich ${scEnr.points}/${scEnr.max}${delta} | $${usd.toFixed(4)}${flip}`,
      );
      if (scEnr.notes.length) console.log(`      ${scEnr.notes.join("; ")}`);
    } else {
      const mark = scRaw.points === scRaw.max ? "✓" : "·";
      console.log(
        `  ${mark} ${f.id}: ${raw?.verdict} | ${String(raw?.title || "").slice(0, 48)} | ${scRaw.points}/${scRaw.max} | $${usd.toFixed(4)}`,
      );
      if (scRaw.notes.length) console.log(`      ${scRaw.notes.join("; ")}`);
    }
  }

  function pack(label, pts, rows, withEnrichFlag, flips) {
    return {
      label,
      model,
      thinking: Boolean(thinking),
      withEnrich: withEnrichFlag,
      fixtures: FIXTURES.length,
      fails,
      enrichFlips: flips || 0,
      score: `${pts}/${totalMax}`,
      scoreRatio: totalMax ? pts / totalMax : 0,
      totalUsd,
      usdPerFiling: FIXTURES.length ? totalUsd / FIXTURES.length : 0,
      projectedUsdAt200: FIXTURES.length ? (totalUsd / FIXTURES.length) * 200 : 0,
      projectedUsdAt400: FIXTURES.length ? (totalUsd / FIXTURES.length) * 400 : 0,
      contextChars: contextText.length,
      rows,
    };
  }

  const out = [pack(base, rawPts, rawRows, false, 0)];
  console.log(
    `  RAW TOTAL ${out[0].score} (${(out[0].scoreRatio * 100).toFixed(0)}%) | $${totalUsd.toFixed(4)} | $${out[0].usdPerFiling.toFixed(5)}/file | $${out[0].projectedUsdAt400.toFixed(2)}@400`,
  );
  if (alsoEnrich) {
    // totalMax was counted once per fixture via raw; enr uses same max
    const enr = pack(base + "+enrich", enrPts, enrRows, true, enrichFlips);
    out.push(enr);
    console.log(
      `  ENRICH TOTAL ${enr.score} (${(enr.scoreRatio * 100).toFixed(0)}%) | same $ | enrichFlips ${enrichFlips}`,
    );
  }
  return out;
}

const results = [];
for (const m of models) {
  results.push(...(await runModelPair(m, false, contextText, titles, hubs, withEnrich)));
  if (withThinking) {
    results.push(...(await runModelPair(m, true, contextText, titles, hubs, withEnrich)));
  }
}

const ranked = results
  .filter((r) => !r.unsupported)
  .sort((a, b) => {
    if (b.scoreRatio !== a.scoreRatio) return b.scoreRatio - a.scoreRatio;
    return a.totalUsd - b.totalUsd;
  });

console.log("\n=== RANKING (quality first, then cost) ===");
for (const r of ranked) {
  console.log(
    `${r.label}: ${(r.scoreRatio * 100).toFixed(0)}% | $${r.usdPerFiling.toFixed(5)}/file | $${r.projectedUsdAt200.toFixed(2)}@200 | $${r.projectedUsdAt400.toFixed(2)}@400 | ${r.score}`,
  );
}

const out = `/tmp/atoms-plus-bakeoff-${Date.now()}.json`;
await fs.writeFile(out, JSON.stringify({ ranked, results, titleCount: titles.length }, null, 2));
console.log("\n[bakeoff] wrote", out);
console.log(
  "[bakeoff] $5/mo Plus: aim COGS << $2.50/user. Haiku wins if quality ≈ Sonnet on this set.",
);
