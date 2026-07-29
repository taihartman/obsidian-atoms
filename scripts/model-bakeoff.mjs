#!/usr/bin/env node
/**
 * Model bake-off — do OpenAI's GPT-5.6 tiers file captures as well as Sonnet 5, and at what price?
 *
 * Why this exists: the BM25 shortlist plan justified itself with a $3.65-per-thousand figure that
 * is a CACHE-READ price for a frozen 400-title prefix. A per-capture shortlist changes that prefix
 * on every capture, so the prefix is never read back and the real number is ~3x higher. Rather than
 * shrink the shortlist, the owner asked whether a cheaper model removes the problem. This harness
 * answers that with measured quality and measured tokens, not estimates.
 *
 * It replays the chronological corpus (scripts/fixtures/chrono-corpus-{a,b,c,d}.json) through the
 * plugin's REAL classify prompt, one capture at a time in date order, growing the vault title list
 * as atoms are created — so a link a model proposes can be resolved back to the capture that
 * produced that title and scored against the corpus's declared answer key.
 *
 * Usage:
 *   node scripts/model-bakeoff.mjs                      # estimate only, spends nothing
 *   node scripts/model-bakeoff.mjs --limit 50 --confirm # cheap smoke run
 *   node scripts/model-bakeoff.mjs --confirm            # full run (720 captures x 5 models)
 *   node scripts/model-bakeoff.mjs --models gpt-5.6-luna,claude-sonnet-5 --limit 50 --confirm
 *   node scripts/model-bakeoff.mjs --replay <run.json>  # re-score a saved run, no API calls
 *
 * Flags:
 *   --models a,b,c      arms to run (default: the five below)
 *   --limit N           only the first N captures in date order
 *   --confirm           required before ANY billable call (mirrors backfill.ts's estimate gate)
 *   --parallel          run the arms concurrently (each arm is still strictly chronological)
 *   --reasoning EFFORT  OpenAI reasoning effort: minimal|low|medium|high (default low)
 *   --pre-run N         extra filler titles in the pre-run vault (default 0 = hubs only)
 *   --out PATH          write the full run (incl. every raw model response) as JSON
 *   --replay PATH       score a previously written run file instead of calling any API
 *
 * Keys: ANTHROPIC_API_KEY and/or OPENAI_API_KEY, read from the environment. Per CLAUDE.md log
 * safety they are never printed, written to the --out file, or logged — only a `…abcd (len=N)`
 * fingerprint. Request headers and bodies are never dumped.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import { buildPreRunVault, loadChronoCaptures } from "./lib/corpus.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ============================================================================
// PRICE TABLE — the only place prices live. USD per 1M tokens, standard tier.
// A stale entry here should be obvious, not buried in the cost maths below.
//
//   Anthropic  — copied from scripts/measure-classify-cost.mjs:53-58, which is the
//                repo's existing in-use table (RATES / CACHE_WRITE_MULT / CACHE_READ_MULT).
//                Do not retype these from memory; re-sync from that file. Cross-checked against
//                the shipped table in src/pipeline/backfill.ts:37-45 — they agree.
//   OpenAI     — GPT-5.6, GA 2026-07-09. Verified against OpenAI's pricing page 2026-07-29.
//                Bare `gpt-5.6` is an alias that routes to `gpt-5.6-sol`.
//
// Both providers: cached input bills at 10% of the input rate, and the Batch API halves
// everything. Anthropic additionally charges a cache WRITE premium (1.25x for a 5m TTL,
// 2x for 1h); OpenAI's prefix cache is automatic and has no write charge.
// ============================================================================
const PRICES = {
  // --- Anthropic (source: scripts/measure-classify-cost.mjs:53-58) ---
  "claude-sonnet-5": { provider: "anthropic", input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { provider: "anthropic", input: 1.0, output: 5.0 },
  "claude-haiku-4-5-20251001": { provider: "anthropic", input: 1.0, output: 5.0 },
  // --- OpenAI (source: OpenAI pricing page, checked 2026-07-29) ---
  "gpt-5.6-sol": { provider: "openai", input: 5.0, output: 30.0 },
  "gpt-5.6-terra": { provider: "openai", input: 2.5, output: 15.0 },
  "gpt-5.6-luna": { provider: "openai", input: 1.0, output: 6.0 },
  "gpt-5.6": { provider: "openai", input: 5.0, output: 30.0 }, // alias -> sol
};

/** Multipliers shared by both providers (Anthropic values per measure-classify-cost.mjs:59-61). */
const CACHE_WRITE_MULT = { "5m": 1.25, "1h": 2 };
const CACHE_READ_MULT = 0.1;
const BATCH_DISCOUNT = 0.5;

/**
 * Default arms.
 *   claude-sonnet-5    — the incumbent; every other number is judged against it
 *   claude-haiku-4-5   — the known cheap Anthropic floor (~81% on the old 20-fixture bake-off)
 *   gpt-5.6-terra      — balanced mid-tier
 *   gpt-5.6-luna       — OpenAI positions this tier for classification/routing/high-volume,
 *                        which is exactly what Atoms' classify step is. The one to watch.
 *   gpt-5.6-sol        — ceiling check only; nobody is proposing to ship this
 */
const DEFAULT_MODELS = [
  "claude-sonnet-5",
  "claude-haiku-4-5",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
];

/** Output-token stand-in for the pre-run estimate (matches backfill.ts's ASSUMED_OUTPUT_TOKENS). */
const ASSUMED_OUTPUT_TOKENS = 250;

/** Absolute ceiling on billable calls in one invocation, whatever the flags say. */
const MAX_REQUESTS = 5000;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const OPENAI_URL = "https://api.openai.com/v1/responses";

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const opts = {
  models: (valueOf("models", "") || "").trim()
    ? valueOf("models", "").split(",").map((m) => m.trim()).filter(Boolean)
    : DEFAULT_MODELS,
  limit: Number(valueOf("limit", "0")) || 0,
  confirm: has("--confirm"),
  parallel: has("--parallel"),
  reasoning: valueOf("reasoning", "low"),
  preRun: Number(valueOf("pre-run", "0")) || 0,
  out: valueOf("out", ""),
  replay: valueOf("replay", ""),
  cacheTtl: valueOf("cache-ttl", "5m"),
};

for (const m of opts.models) {
  if (!PRICES[m]) {
    console.error(`Unknown model "${m}". Add it to the PRICES table at the top of this file.`);
    process.exit(2);
  }
}

/** Redact a key to a fingerprint. Never print or persist the key itself. */
const fingerprint = (key) => (key ? `…${key.slice(-4)} (len=${key.length})` : "absent");

const KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY?.trim() || "",
  openai: process.env.OPENAI_API_KEY?.trim() || "",
};

// ---------------------------------------------------------------- corpus

const captures = loadChronoCaptures();
if (!captures.length) {
  console.error("No chrono-corpus-*.json fixtures found under scripts/fixtures/.");
  process.exit(1);
}

const atomIds = new Set(captures.filter((c) => c.verdict === "atom").map((c) => c.id));

/**
 * The answer key. `linksToEarlier` is the corpus author's declaration of which earlier capture
 * this one genuinely belongs with, written before any model saw the corpus (see
 * scripts/fixtures/README-chrono-corpus-schema.md §1). Only links whose target is itself an atom
 * are scoreable — a link to a noise capture has no note to point at.
 */
function goldInRunPairs(pool) {
  const inPool = new Set(pool.map((c) => c.id));
  const pairs = new Set();
  for (const c of pool) {
    if (c.verdict !== "atom") continue;
    for (const target of c.linksToEarlier ?? []) {
      if (atomIds.has(target) && inPool.has(target)) pairs.add(`${c.id} ${target}`);
    }
  }
  return pairs;
}

/** Hub links — titles of notes that existed before the run (the bible's cast). */
function goldHubPairs(pool) {
  const pairs = new Set();
  for (const c of pool) {
    for (const title of c.linksToExisting ?? []) pairs.add(`${c.id} ${title}`);
  }
  return pairs;
}

const HUB_TITLES = [...new Set(captures.flatMap((c) => c.linksToExisting ?? []))].sort();

const TOTAL_GOLD_LINKS = goldInRunPairs(captures).size;
console.log(
  `corpus: ${captures.length} captures · ${atomIds.size} atoms · ` +
    `${TOTAL_GOLD_LINKS} in-run gold links · ${HUB_TITLES.length} pre-existing hub titles`,
);
if (TOTAL_GOLD_LINKS !== 811) {
  console.error(
    `\nGOLD-LINK COUNT MISMATCH: loaded ${TOTAL_GOLD_LINKS}, expected 811.\n` +
      `The corpus changed under the harness. Reconcile that before trusting any score.`,
  );
  process.exit(3);
}

const pool = opts.limit ? captures.slice(0, opts.limit) : captures;

// ------------------------------------------------- the plugin's real prompt

/**
 * Bundle the plugin's own prompt-building code rather than copying it. A bake-off run against a
 * paraphrased prompt measures a prompt nobody ships. Same esbuild + obsidian-mock trick
 * measure-classify-cost.mjs uses.
 */
async function loadPipeline() {
  const outfile = path.join(REPO_ROOT, "node_modules/.cache/atoms-bakeoff/pipeline.mjs");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    stdin: {
      contents: [
        `export { buildMessagesRequest, SYSTEM_PROMPT, CLASSIFICATION_SCHEMA,`,
        `  buildContextUserMessage, buildCaptureUserMessage } from "./src/pipeline/classify";`,
        `export { buildVaultContext } from "./src/pipeline/context";`,
        `export { DEFAULT_ACTIVE_VOCABULARY } from "./src/pipeline/vocabulary";`,
      ].join("\n"),
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "error",
    alias: {
      obsidian: path.join(REPO_ROOT, "test/mocks/obsidian.ts"),
      "obsidian-daily-notes-interface": path.join(
        REPO_ROOT,
        "test/mocks/obsidian-daily-notes-interface.ts",
      ),
    },
  });
  return import(pathToFileURL(outfile).href);
}

// ------------------------------------------------------- provider adapters

/**
 * One interface, two shapes. Adding a sixth model must be a PRICES entry plus (at most) nothing
 * else — the adapter is chosen off `PRICES[model].provider`.
 *
 * Every adapter returns:
 *   { result, usage: { inputFresh, inputCacheWrite, inputCacheRead, output }, raw }
 * where `inputFresh` is input tokens billed at the full rate and the cache fields are billed at
 * their multipliers. Every figure comes from the provider's own usage block — nothing estimated.
 */

async function postJson(url, headers, body, label) {
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = `network error (${err.name})`;
      continue;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    // Never surface the response body wholesale — it can echo request content.
    lastErr = `${label}: HTTP ${res.status} ${json?.error?.type ?? json?.error?.code ?? ""}`.trim();
    if (res.status < 429 && res.status !== 408) break; // 4xx that retrying will not fix
  }
  throw new Error(lastErr ?? `${label}: failed`);
}

const anthropicAdapter = {
  provider: "anthropic",
  keyName: "ANTHROPIC_API_KEY",
  async classify({ pipeline, model, capture, context }) {
    // The shipped request, built by the shipped code — system, cached context block, volatile
    // capture suffix, output_config json_schema. Nothing reimplemented here.
    const body = pipeline.buildMessagesRequest({
      model,
      capture,
      context,
      cacheTtl: opts.cacheTtl,
    });
    const json = await postJson(
      ANTHROPIC_URL,
      { "x-api-key": KEYS.anthropic, "anthropic-version": ANTHROPIC_VERSION },
      body,
      model,
    );
    const u = json.usage ?? {};
    const text = (json.content ?? []).find((b) => b.type === "text")?.text ?? "";
    return {
      result: safeParse(text),
      usage: {
        inputFresh: u.input_tokens ?? 0,
        inputCacheWrite: u.cache_creation_input_tokens ?? 0,
        inputCacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      },
      raw: text,
    };
  },
};

/**
 * OpenAI Structured Outputs on the Responses API: `text.format = { type: "json_schema", strict:
 * true, … }`. Chosen over tool/function calling because classify has exactly one output shape and
 * no tool to call, and over plain json_object because only strict json_schema guarantees the
 * grammar — which is what the plugin already relies on Anthropic's output_config for. Using the
 * loose mode would make an OpenAI arm fail differently from the Anthropic arms and quietly change
 * what the bake-off is measuring.
 *
 * The one adaptation: strict mode requires every declared property to appear in `required`, while
 * the plugin's schema leaves `hub_section` optional. openaiStrictSchema() promotes it (and any
 * future optional field) to required. The model can still express "no fit" as the empty string,
 * which is exactly what the field's own description asks for, so no semantics are lost.
 */
function openaiStrictSchema(node) {
  if (Array.isArray(node)) return node.map(openaiStrictSchema);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = openaiStrictSchema(v);
  if (out.type === "object" && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

const openaiAdapter = {
  provider: "openai",
  keyName: "OPENAI_API_KEY",
  async classify({ pipeline, model, capture, context, schema }) {
    // Same three pieces as the Anthropic request, in the Responses API's shape: the system prompt
    // becomes `instructions`, the stable context and volatile capture stay two separate user turns
    // in the same order so the cacheable prefix boundary sits in the same place.
    const body = {
      model,
      instructions: pipeline.SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: pipeline.buildContextUserMessage(context) }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: pipeline.buildCaptureUserMessage(capture) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "atoms_classification",
          strict: true,
          schema,
        },
      },
      reasoning: { effort: opts.reasoning },
      max_output_tokens: 2048,
      store: false,
    };
    const json = await postJson(
      OPENAI_URL,
      { authorization: `Bearer ${KEYS.openai}` },
      body,
      model,
    );
    const u = json.usage ?? {};
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    const text =
      (json.output ?? [])
        .filter((item) => item.type === "message")
        .flatMap((item) => item.content ?? [])
        .find((c) => c.type === "output_text")?.text ?? "";
    return {
      result: safeParse(text),
      usage: {
        // OpenAI reports total input including the cached portion; split it so both providers'
        // usage means the same thing downstream.
        inputFresh: Math.max(0, (u.input_tokens ?? 0) - cached),
        inputCacheWrite: 0, // OpenAI's prefix cache carries no write premium
        inputCacheRead: cached,
        // output_tokens already includes reasoning tokens; reasoning is broken out for the report.
        output: u.output_tokens ?? 0,
      },
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      raw: text,
    };
  },
};

const ADAPTERS = { anthropic: anthropicAdapter, openai: openaiAdapter };

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- cost maths

/**
 * Cost from measured tokens, under three billing scenarios.
 *
 *   measured     — what this run actually cost, cache writes and all.
 *   uncached     — every input token at the full input rate. This is the honest price of a
 *                  prefix that changes on every capture, which is what a per-capture shortlist
 *                  produces and what the plan's $3.65 figure quietly assumed away.
 *   cachedPrefix — the stable prefix at the 10% cache-read rate, volatile suffix at full rate.
 *                  This is the optimistic bound the plan was quoting.
 *
 * For Anthropic arms the prefix/suffix split is exact: the cache_control breakpoint sits at the
 * end of the context block, so cache_creation + cache_read IS the prefix and input_tokens is the
 * suffix. For OpenAI arms the split is only observable when the automatic prefix cache actually
 * hits; when it does not, `cachedPrefix` treats the whole input as cacheable, which OVERSTATES the
 * discount by the size of the volatile capture message (~40 tokens against a multi-thousand-token
 * request, i.e. under 1%). Stated rather than hidden — the direction of the error is toward the
 * optimistic case, so it cannot rescue a model that looks expensive here.
 */
function costOf(usage, model, { ttl = opts.cacheTtl, batch = false } = {}) {
  const r = PRICES[model];
  const totalInput = usage.inputFresh + usage.inputCacheWrite + usage.inputCacheRead;
  const prefix = usage.inputCacheWrite + usage.inputCacheRead || totalInput;
  const suffix = Math.max(0, totalInput - prefix);
  const perM = {
    measured:
      usage.inputFresh * r.input +
      usage.inputCacheWrite * r.input * (CACHE_WRITE_MULT[ttl] ?? 2) +
      usage.inputCacheRead * r.input * CACHE_READ_MULT +
      usage.output * r.output,
    uncached: totalInput * r.input + usage.output * r.output,
    cachedPrefix:
      prefix * r.input * CACHE_READ_MULT + suffix * r.input + usage.output * r.output,
  };
  const scale = (batch ? BATCH_DISCOUNT : 1) / 1_000_000;
  return {
    measured: perM.measured * scale,
    uncached: perM.uncached * scale,
    cachedPrefix: perM.cachedPrefix * scale,
  };
}

// --------------------------------------------------------------- estimate

/**
 * Free pre-flight estimate. Replays the chronological context growth offline using the corpus's
 * own verdicts (so the title list grows at the right rate) and a stand-in title per atom, then
 * prices chars÷4 tokens. It is an estimate — real titles are model-written and the tokenizer is
 * not chars÷4 — but it is the number the spend gate is judged against, and it is free.
 */
function estimate(pipeline, models) {
  const titles = [...HUB_TITLES];
  if (opts.preRun) {
    for (const n of buildPreRunVault({
      size: opts.preRun,
      hubTitles: HUB_TITLES,
      bodyPool: captures.map((c) => c.capture),
    })) {
      titles.push(n.title);
    }
  }
  let inputChars = 0;
  for (const c of pool) {
    const context = pipeline.buildVaultContext({
      titles,
      vaultTags: [],
      activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
      personHubs: HUB_TITLES,
    });
    inputChars +=
      pipeline.SYSTEM_PROMPT.length +
      pipeline.buildContextUserMessage(context).length +
      pipeline.buildCaptureUserMessage(c.capture).length;
    if (c.verdict === "atom") titles.push(`${c.id} ${c.capture.slice(0, 46)}`);
  }
  const inputTokens = Math.round(inputChars / 4);
  const outputTokens = pool.length * ASSUMED_OUTPUT_TOKENS;
  const rows = models.map((m) => {
    const r = PRICES[m];
    return {
      model: m,
      provider: r.provider,
      requests: pool.length,
      inputTokens,
      outputTokens,
      uncachedUsd: (inputTokens * r.input + outputTokens * r.output) / 1e6,
      cachedPrefixUsd:
        (inputTokens * r.input * CACHE_READ_MULT + outputTokens * r.output) / 1e6,
    };
  });
  return { rows, inputTokens, outputTokens, requests: pool.length * models.length };
}

// ----------------------------------------------------------------- runner

async function runArm(pipeline, model, schema) {
  const adapter = ADAPTERS[PRICES[model].provider];
  const titles = [...HUB_TITLES];
  if (opts.preRun) {
    for (const n of buildPreRunVault({
      size: opts.preRun,
      hubTitles: HUB_TITLES,
      bodyPool: captures.map((c) => c.capture),
    })) {
      titles.push(n.title);
    }
  }
  const records = [];
  const usageTotal = { inputFresh: 0, inputCacheWrite: 0, inputCacheRead: 0, output: 0 };
  let reasoningTokens = 0;
  let failures = 0;

  for (const [i, c] of pool.entries()) {
    const context = pipeline.buildVaultContext({
      titles,
      vaultTags: [],
      activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
      personHubs: HUB_TITLES,
    });
    const started = Date.now();
    let out = null;
    let error = null;
    try {
      out = await adapter.classify({ pipeline, model, capture: c.capture, context, schema });
    } catch (err) {
      error = String(err.message ?? err);
      failures += 1;
    }
    const ms = Date.now() - started;
    if (out) {
      for (const k of Object.keys(usageTotal)) usageTotal[k] += out.usage[k] ?? 0;
      reasoningTokens += out.reasoningTokens ?? 0;
    }
    const result = out?.result ?? null;
    records.push({
      id: c.id,
      ms,
      error,
      usage: out?.usage ?? null,
      result: result
        ? {
            verdict: result.verdict,
            title: result.title,
            links: (result.links ?? []).map((l) => ({ note: l.note, reason: l.reason })),
            tags: result.tags ?? [],
            hub_section: result.hub_section ?? "",
          }
        : null,
    });
    // Chronological seam: an atom's title only becomes linkable AFTER it is created. This is the
    // whole point of the corpus, and it is what a frozen pre-run title list cannot reproduce.
    if (result?.verdict === "atom" && result.title?.trim()) titles.push(result.title.trim());

    if ((i + 1) % 25 === 0 || i + 1 === pool.length) {
      process.stderr.write(`  ${model}: ${i + 1}/${pool.length}\n`);
    }
  }
  return { model, records, usageTotal, reasoningTokens, failures };
}

// ----------------------------------------------------------------- scorer

/**
 * Score an arm's records against the corpus answer key.
 *
 * Link resolution is the crux. A model returns a TITLE; the answer key is capture IDs. So the
 * scorer rebuilds the same title index the run built (first writer of a title wins, matching the
 * run's ordering) and maps each proposed title back to the capture whose atom carries it. A title
 * that matches nothing in the vault is a hallucinated note, which is a real error and is counted
 * as one.
 *
 * Precision is reported two ways because the two are asking different questions:
 *   strict  — unresolved titles count as false positives (was the model RIGHT?)
 *   lenient — unresolved titles are excluded (of the links it could actually make, was it right?)
 * Strict is the headline.
 */
function scoreRecords(records) {
  const byId = new Map(pool.map((c) => [c.id, c]));
  const gold = goldInRunPairs(pool);
  const goldHub = goldHubPairs(pool);
  const hubIndex = new Map(HUB_TITLES.map((t) => [norm(t), t]));

  const titleIndex = new Map(); // normalised title -> capture id
  const predInRun = new Set();
  const predHub = new Set();
  let unresolved = 0;
  let parsed = 0;
  let unparseable = 0;
  const verdicts = { correct: 0, total: 0, confusion: {} };
  const latencies = [];

  for (const rec of records) {
    const gold_ = byId.get(rec.id);
    if (!gold_) continue;
    if (rec.ms) latencies.push(rec.ms);
    if (!rec.result) {
      unparseable += 1;
      continue;
    }
    parsed += 1;

    const predicted = rec.result.verdict;
    verdicts.total += 1;
    if (predicted === gold_.verdict) verdicts.correct += 1;
    const key = `${gold_.verdict}->${predicted}`;
    verdicts.confusion[key] = (verdicts.confusion[key] ?? 0) + 1;

    for (const link of rec.result.links ?? []) {
      const n = norm(link.note);
      if (!n) continue;
      if (titleIndex.has(n)) predInRun.add(`${rec.id} ${titleIndex.get(n)}`);
      else if (hubIndex.has(n)) predHub.add(`${rec.id} ${hubIndex.get(n)}`);
      else unresolved += 1;
    }

    // Register AFTER scoring this capture's own links, mirroring the run's ordering exactly.
    if (predicted === "atom" && rec.result.title?.trim()) {
      const n = norm(rec.result.title);
      if (!titleIndex.has(n)) titleIndex.set(n, rec.id);
    }
  }

  const tpInRun = [...predInRun].filter((p) => gold.has(p)).length;
  const tpHub = [...predHub].filter((p) => goldHub.has(p)).length;

  return {
    captures: records.length,
    parsed,
    unparseable,
    verdict: {
      accuracy: ratio(verdicts.correct, verdicts.total),
      correct: verdicts.correct,
      total: verdicts.total,
      confusion: verdicts.confusion,
    },
    links: {
      goldInScope: gold.size,
      predicted: predInRun.size,
      unresolved,
      truePositives: tpInRun,
      precisionStrict: ratio(tpInRun, predInRun.size + unresolved),
      precisionLenient: ratio(tpInRun, predInRun.size),
      recall: ratio(tpInRun, gold.size),
      f1: f1(ratio(tpInRun, predInRun.size + unresolved), ratio(tpInRun, gold.size)),
    },
    hubLinks: {
      goldInScope: goldHub.size,
      predicted: predHub.size,
      truePositives: tpHub,
      precision: ratio(tpHub, predHub.size),
      recall: ratio(tpHub, goldHub.size),
    },
    latencyMs: stats(latencies),
  };
}

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const ratio = (a, b) => (b ? +(a / b).toFixed(4) : 0);
const f1 = (p, r) => (p + r ? +((2 * p * r) / (p + r)).toFixed(4) : 0);

function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    median: at(0.5),
    mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length),
    p90: at(0.9),
    max: s[s.length - 1],
  };
}

// ----------------------------------------------------------------- report

function report(arms) {
  const rows = arms.map((arm) => {
    const s = arm.score;
    const per1k = (sel) => {
      const total = costOf(arm.usageTotal, arm.model);
      return (total[sel] / Math.max(1, arm.records.length)) * 1000;
    };
    return {
      model: arm.model,
      linkP: s.links.precisionStrict,
      linkR: s.links.recall,
      linkF1: s.links.f1,
      verdict: s.verdict.accuracy,
      inPerCapture: Math.round(
        (arm.usageTotal.inputFresh + arm.usageTotal.inputCacheWrite + arm.usageTotal.inputCacheRead) /
          Math.max(1, arm.records.length),
      ),
      outPerCapture: Math.round(arm.usageTotal.output / Math.max(1, arm.records.length)),
      usdPer1kUncached: +per1k("uncached").toFixed(2),
      usdPer1kCached: +per1k("cachedPrefix").toFixed(2),
      usdPer1kMeasured: +per1k("measured").toFixed(2),
      msPerCapture: s.latencyMs.median ?? 0,
      failures: arm.failures,
      unparseable: s.unparseable,
    };
  });

  console.log(`\n${"=".repeat(78)}`);
  console.log("BAKE-OFF RESULTS");
  console.log(`${"=".repeat(78)}`);
  console.log(
    `scored against ${arms[0]?.score.links.goldInScope ?? 0} in-run gold links ` +
      `and ${arms[0]?.score.hubLinks.goldInScope ?? 0} hub links over ${pool.length} captures\n`,
  );
  const head = [
    "model".padEnd(22),
    "linkP".padStart(7),
    "linkR".padStart(7),
    "F1".padStart(7),
    "verdict".padStart(8),
    "tok in".padStart(8),
    "tok out".padStart(8),
    "$/1k unc".padStart(9),
    "$/1k cach".padStart(10),
    "ms".padStart(6),
  ].join(" ");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    console.log(
      [
        r.model.padEnd(22),
        pct(r.linkP).padStart(7),
        pct(r.linkR).padStart(7),
        pct(r.linkF1).padStart(7),
        pct(r.verdict).padStart(8),
        String(r.inPerCapture).padStart(8),
        String(r.outPerCapture).padStart(8),
        `$${r.usdPer1kUncached.toFixed(2)}`.padStart(9),
        `$${r.usdPer1kCached.toFixed(2)}`.padStart(10),
        String(r.msPerCapture).padStart(6),
      ].join(" "),
    );
  }
  console.log("\nhub links (notes that existed before the run) and link resolution:");
  for (const arm of arms) {
    const h = arm.score.hubLinks;
    console.log(
      `  ${arm.model.padEnd(22)} hubP ${pct(h.precision)}  hubR ${pct(h.recall)}  ` +
        `· proposed ${arm.score.links.predicted} in-run / ${h.predicted} hub / ` +
        `${arm.score.links.unresolved} pointing at no such note`,
    );
  }

  const broken = rows.filter((r) => r.failures || r.unparseable);
  if (broken.length) {
    console.log("");
    for (const r of broken) {
      console.log(`  ! ${r.model}: ${r.failures} request failures, ${r.unparseable} unparseable`);
    }
  }
  console.log(
    "\n$/1k unc  = every input token at full rate — the real price of a prefix that changes per capture." +
      "\n$/1k cach = stable prefix at the 10% cache-read rate — the optimistic bound the plan quoted." +
      "\nBatch API halves both.",
  );
  return rows;
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

// ------------------------------------------------------------------- main

async function main() {
  const pipeline = await loadPipeline();
  const schema = openaiStrictSchema(pipeline.CLASSIFICATION_SCHEMA);

  // ---- replay: score a saved run, no key and no spend ----
  if (opts.replay) {
    const saved = JSON.parse(fs.readFileSync(path.resolve(opts.replay), "utf8"));
    const arms = (saved.arms ?? []).map((arm) => ({
      ...arm,
      usageTotal: arm.usageTotal ?? {
        inputFresh: 0,
        inputCacheWrite: 0,
        inputCacheRead: 0,
        output: 0,
      },
      failures: arm.failures ?? 0,
      score: scoreRecords(arm.records ?? []),
    }));
    if (!arms.length) {
      console.error("Replay file has no `arms`.");
      process.exit(4);
    }
    console.log(`\nreplay: ${path.resolve(opts.replay)} (no API calls, nothing spent)`);
    report(arms);
    if (opts.out) writeOut(arms);
    return;
  }

  // ---- estimate + spend gate ----
  const est = estimate(pipeline, opts.models);
  console.log(`\nestimate — ${pool.length} captures x ${opts.models.length} models = ${est.requests} requests`);
  console.log(
    `  ~${est.inputTokens.toLocaleString()} input tokens and ` +
      `~${est.outputTokens.toLocaleString()} output tokens PER MODEL ` +
      `(chars÷4, ${ASSUMED_OUTPUT_TOKENS} output tokens/capture)\n`,
  );
  console.log(
    ["model".padEnd(22), "uncached".padStart(10), "cached-prefix".padStart(14)].join(" "),
  );
  console.log("-".repeat(48));
  let totalUncached = 0;
  let totalCached = 0;
  for (const row of est.rows) {
    totalUncached += row.uncachedUsd;
    totalCached += row.cachedPrefixUsd;
    console.log(
      [
        row.model.padEnd(22),
        `$${row.uncachedUsd.toFixed(2)}`.padStart(10),
        `$${row.cachedPrefixUsd.toFixed(2)}`.padStart(14),
      ].join(" "),
    );
  }
  console.log("-".repeat(48));
  console.log(
    ["TOTAL".padEnd(22), `$${totalUncached.toFixed(2)}`.padStart(10), `$${totalCached.toFixed(2)}`.padStart(14)].join(" "),
  );

  const providers = new Set(opts.models.map((m) => PRICES[m].provider));
  console.log("\nkeys:");
  for (const p of providers) {
    console.log(`  ${ADAPTERS[p].keyName}: ${fingerprint(KEYS[p])}`);
  }

  if (!opts.confirm) {
    console.log(
      "\nEstimate only — nothing was sent and nothing was spent." +
        "\nRe-run with --confirm to spend it, or --limit 50 --confirm for a smoke run.",
    );
    return;
  }

  const missing = [...providers].filter((p) => !KEYS[p]);
  if (missing.length) {
    console.error(
      `\nCannot run: ${missing.map((p) => ADAPTERS[p].keyName).join(" and ")} not set in the environment.` +
        `\nExport the key(s) and re-run. Nothing was sent and nothing was spent.`,
    );
    process.exit(5);
  }
  if (est.requests > MAX_REQUESTS) {
    console.error(`\nRefusing: ${est.requests} requests exceeds the MAX_REQUESTS cap of ${MAX_REQUESTS}.`);
    process.exit(6);
  }

  console.log(`\nrunning ${est.requests} requests…\n`);
  const jobs = opts.models.map((m) => () => runArm(pipeline, m, schema));
  const raw = opts.parallel
    ? await Promise.all(jobs.map((j) => j()))
    : await jobs.reduce(async (acc, j) => [...(await acc), await j()], Promise.resolve([]));

  const arms = raw.map((arm) => ({ ...arm, score: scoreRecords(arm.records) }));
  report(arms);
  if (opts.out) writeOut(arms);
  else console.log("\n(pass --out PATH to save the full run — it can be re-scored with --replay)");
}

function writeOut(arms) {
  const dest = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // Deliberately no keys, no headers, no request bodies — only corpus ids, model output,
  // usage counters and timings.
  fs.writeFileSync(
    dest,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        corpus: {
          captures: captures.length,
          atoms: atomIds.size,
          goldInRunLinks: TOTAL_GOLD_LINKS,
          hubTitles: HUB_TITLES.length,
        },
        options: { ...opts, replay: "" },
        prices: PRICES,
        arms: arms.map((a) => ({
          model: a.model,
          usageTotal: a.usageTotal,
          reasoningTokens: a.reasoningTokens ?? 0,
          failures: a.failures,
          score: a.score,
          records: a.records,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${dest}`);
}

main().catch((err) => {
  console.error(`\nfailed: ${err.message ?? err}`);
  process.exit(1);
});
