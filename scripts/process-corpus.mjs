#!/usr/bin/env node
// Run a chrono corpus through the REAL pipeline, headless — no Obsidian, no vault writes.
//
// This is how a hand-authored corpus becomes a corpus of actual atoms: model-written titles, model
// tags, and reason-bearing link prose. Every retrieval measurement on this branch was taken against
// notes that had never touched the pipeline; this script is what fixes that.
//
//   node scripts/process-corpus.mjs scripts/fixtures/chrono-corpus-e.json --limit=100
//   node scripts/process-corpus.mjs scripts/fixtures/chrono-corpus-*.json --limit=100 --spend
//
// Dry by default: prints the spend estimate and stops. `--spend` sends billable requests.
//
// The declared `linksToEarlier` from the corpus is carried through untouched into the output. It is
// the answer key and the model never sees it — the whole experiment depends on that staying true.
//
// Flags:
//   --limit=N        process only the first N captures in date order (the pilot)
//   --spend          actually send requests
//   --out=PATH       output JSON (default docs/research/data/processed-corpus-<stamp>.json)
//   --model=ID       default claude-sonnet-5
//   --context=MODE   growing (default) — the vault grows as atoms land, like a real catch-up
//                    frozen  — context built once before the run, like backfill.ts:268 does today
//   --concurrency=N  parallel calls within one date batch (default 4)

import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./lib/shortlist.mjs";
import { loadRepoPipeline } from "./lib/pipeline.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const hit = argv.find((a) => a.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : d;
};

const files = argv.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node scripts/process-corpus.mjs <corpus.json> [...] [--limit=N] [--spend]");
  process.exit(2);
}

const MODEL = val("--model", process.env.ANTHROPIC_MODEL || "claude-sonnet-5");
const LIMIT = Number(val("--limit", "0")) || Infinity;
const CONTEXT_MODE = val("--context", "growing");
const CONCURRENCY = Math.max(1, Number(val("--concurrency", "4")) || 4);

// $/M tokens. Mirrors src/pipeline/backfill.ts. Sonnet 5 carries an introductory $2/$10 through
// 2026-08-31, so a sonnet-5 figure printed here is an upper bound on what actually gets billed.
const PRICES = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};
const price = PRICES[MODEL] ?? { input: 3, output: 15 };

// ---------------------------------------------------------------- corpus

const captures = files
  .flatMap((f) => {
    const raw = JSON.parse(fs.readFileSync(f, "utf8"));
    return Array.isArray(raw) ? raw : raw.captures;
  })
  .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)))
  .slice(0, LIMIT);

if (captures.length === 0) {
  console.error("no captures loaded");
  process.exit(2);
}

// Notes that existed before the run: every hub the corpus refers to by title.
const preRunTitles = [...new Set(captures.flatMap((c) => c.linksToExisting ?? []))].sort();

console.log(`[corpus] ${captures.length} captures · ${captures[0].date} → ${captures.at(-1).date}`);
console.log(`[corpus] ${preRunTitles.length} pre-run hub titles · context=${CONTEXT_MODE} · model=${MODEL}`);

// ---------------------------------------------------------------- spend estimate

const pipeline = await loadRepoPipeline();

// Estimate from the real request: build one and measure it, rather than guessing a token count.
const estimateContext = pipeline.buildVaultContext({
  titles: preRunTitles,
  vaultTags: [],
  activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
});
const sampleBody = pipeline.buildMessagesRequest({
  capture: captures[Math.floor(captures.length / 2)].capture,
  context: estimateContext,
  model: MODEL,
});
// ~4 chars per token is the standard rough conversion; good enough for a go/no-go figure.
const estInput = JSON.stringify(sampleBody).length / 4;
const estOutput = pipeline.ASSUMED_OUTPUT_TOKENS ?? 220;
const estimate =
  (captures.length * (estInput * price.input + estOutput * price.output)) / 1_000_000;

console.log(
  `[cost] ~${Math.round(estInput)} in + ~${estOutput} out per capture` +
    ` → estimate $${estimate.toFixed(2)} for ${captures.length}` +
    ` (context grows during the run, so the real figure lands above this)`,
);

if (!has("--spend")) {
  console.log("\nThis sends billable requests. Re-run with --spend.");
  process.exit(0);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set in this shell (a non-interactive shell skips ~/.zshrc)");
  process.exit(2);
}

// ---------------------------------------------------------------- run

/** Obsidian's requestUrl contract, backed by fetch — classify only reads `status` and `json`. */
async function requestShim(opts) {
  const res = await fetch(opts.url, { method: opts.method, headers: opts.headers, body: opts.body });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const titles = [...preRunTitles];
const vaultTags = new Set();
let context = pipeline.buildVaultContext({
  titles,
  vaultTags: [],
  activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
});
const rebuildContext = () =>
  pipeline.buildVaultContext({
    titles,
    vaultTags: [...vaultTags].sort(),
    activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
  });

const out = [];
let spend = 0;
let failures = 0;

async function processOne(capture) {
  const outcome = await pipeline.classifyCapture(capture.capture, context, {
    apiKey,
    model: MODEL,
    request: requestShim,
    activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  if (!outcome.ok) {
    failures += 1;
    return { ...capture, error: outcome.reason ?? "classify_failed" };
  }

  const u = outcome.usage ?? {};
  spend += ((u.input_tokens ?? 0) * price.input + (u.output_tokens ?? 0) * price.output) / 1_000_000;

  const r = outcome.result ?? {};
  return {
    // Corpus ground truth, carried through untouched. The model never saw linksToEarlier.
    id: capture.id,
    date: capture.date,
    thread: capture.thread,
    capture: capture.capture,
    declaredVerdict: capture.verdict,
    linksToEarlier: capture.linksToEarlier ?? [],
    linksToExisting: capture.linksToExisting ?? [],
    // What the real pipeline produced.
    verdict: r.verdict,
    title: r.title,
    tags: r.tags ?? [],
    links: r.links ?? [],
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 },
  };
}

// Process in date batches: everything on one day goes together, then the vault updates. That is
// what a catch-up over a backlog actually does, and it keeps the growing-context story honest.
const byDate = new Map();
for (const c of captures) {
  if (!byDate.has(c.date)) byDate.set(c.date, []);
  byDate.get(c.date).push(c);
}

let done = 0;
for (const [date, batch] of byDate) {
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(processOne));
    out.push(...results);
    done += results.length;

    if (CONTEXT_MODE === "growing") {
      for (const r of results) {
        if (r.verdict === "atom" && r.title) titles.push(r.title);
        for (const t of r.tags ?? []) vaultTags.add(t);
      }
    }
  }
  if (CONTEXT_MODE === "growing") context = rebuildContext();
  if (done % 25 < CONCURRENCY) {
    process.stdout.write(
      `\r[run] ${done}/${captures.length} · ${date} · ${titles.length} titles · $${spend.toFixed(2)}  `,
    );
  }
}

const atoms = out.filter((r) => r.verdict === "atom").length;
const modelLinks = out.reduce((s, r) => s + (r.links?.length ?? 0), 0);
console.log(
  `\n[run] ${out.length} processed · ${atoms} atoms · ${modelLinks} model links · ` +
    `${failures} failures · spend $${spend.toFixed(2)}`,
);

const stamp = captures[0].date.slice(0, 7);
const outPath = path.resolve(
  REPO_ROOT,
  val("--out", `docs/research/data/processed-corpus-${stamp}-${captures.length}.json`),
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(
  outPath,
  JSON.stringify(
    { model: MODEL, contextMode: CONTEXT_MODE, preRunTitles, spend, failures, captures: out },
    null,
    2,
  ) + "\n",
);
console.log(`[run] wrote ${path.relative(REPO_ROOT, outPath)}`);
