#!/usr/bin/env node
/**
 * Measure what an Atoms classify request actually costs (#168 catch-up pricing).
 *
 * Replaces the characters-÷-4 estimates in
 * docs/research/2026-07-28-classify-prompt-cost-measurement.md with exact numbers
 * from Anthropic's own tokenizer and real API usage figures.
 *
 * Usage:
 *   npm run measure:cost                    # phase A only — free, /count_tokens
 *   npm run measure:cost -- --spend         # + phases B and C — paid, hard-capped
 *   npm run measure:cost -- --spend --phases=b
 *   npm run measure:cost -- --out docs/research/data/measured.json
 *
 * Phases:
 *   A  free   exact input tokens at vault sizes 0 / 40 / 500 / 1500 / 3000 / 5000
 *   B  paid   cache write + read behaviour at a realistic ~38K-token prefix
 *   C  paid   real output tokens (incl. reasoning) vs ASSUMED_OUTPUT_TOKENS = 250
 *
 * The request body is built by the plugin's own `buildMessagesRequest`, bundled from
 * src/ with esbuild — nothing about the prompt is reimplemented here.
 *
 * Log-safety: reads ANTHROPIC_API_KEY from the environment and never prints it,
 * writes it to a file, or passes it anywhere but the Anthropic host. Fingerprint only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const VERSION = "2023-06-01";

/** Catch-up must use the same model quality as normal filing (owner-directed). */
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/** Hard ceiling on billable calls, whatever the flags say. */
const MAX_PAID_CALLS = 30;

/** Vault sizes to measure. 40 = the cap the Plus proxy already applies. */
const VAULT_SIZES = [0, 40, 500, 1500, 3000, 5000];

/** Prefix size used for the paid phases — the "3-year vault" case #168 is about. */
const PAID_VAULT_SIZE = 3000;

/**
 * USD per million tokens. Standard (non-batch) list rates; batch is half.
 * Cache write is charged at a multiple of the input rate, cache read at a tenth.
 */
const RATES = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};
const CACHE_WRITE_MULT = { "5m": 1.25, "1h": 2 };
const CACHE_READ_MULT = 0.1;
const BATCH_DISCOUNT = 0.5;

// ---------------------------------------------------------------- args + key

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  return idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")
    ? argv[idx + 1]
    : fallback;
};

const spend = has("--spend");
const phases = new Set(
  (valueOf("phases", spend ? "abc" : "a") || "a").toLowerCase().split(""),
);
const outPath = valueOf("out", "");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error(
    "Set ANTHROPIC_API_KEY to run the measurement (it is read from the environment and never printed).",
  );
  process.exit(1);
}
const fingerprint = `…${apiKey.slice(-4)} (len=${apiKey.length})`;

// ------------------------------------------------------------------ plumbing

let paidCalls = 0;
function chargeOne(label) {
  if (paidCalls >= MAX_PAID_CALLS) {
    throw new Error(
      `Paid-call cap of ${MAX_PAID_CALLS} reached; refusing to send "${label}".`,
    );
  }
  paidCalls += 1;
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
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

function rates() {
  return RATES[MODEL] ?? { input: 3, output: 15 };
}

/** USD for one request given its usage split. `batch` halves everything. */
function usdFor(usage, { ttl = "1h", batch = false } = {}) {
  const r = rates();
  const perM =
    usage.input_tokens * r.input +
    usage.cache_creation_input_tokens * r.input * (CACHE_WRITE_MULT[ttl] ?? 2) +
    usage.cache_read_input_tokens * r.input * CACHE_READ_MULT +
    usage.output_tokens * r.output;
  return (perM / 1_000_000) * (batch ? BATCH_DISCOUNT : 1);
}

/**
 * Bundle the plugin's real prompt-building code so we measure the shipped request,
 * not a copy of it. Uses the same `obsidian` mock alias the test suite uses.
 */
async function loadRepoPipeline() {
  const outfile = path.join(
    REPO_ROOT,
    "node_modules/.cache/atoms-measure/pipeline.mjs",
  );
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    stdin: {
      contents: [
        `export { buildMessagesRequest, SYSTEM_PROMPT, CLASSIFICATION_SCHEMA } from "./src/pipeline/classify";`,
        `export { buildVaultContext } from "./src/pipeline/context";`,
        `export { DEFAULT_ACTIVE_VOCABULARY } from "./src/pipeline/vocabulary";`,
        `export { ASSUMED_OUTPUT_TOKENS, DEFAULT_BACKFILL_MODEL } from "./src/pipeline/backfill";`,
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

// -------------------------------------------------------------------- corpus

const corpus = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "scripts/fixtures/vault-title-corpus.json"),
    "utf8",
  ),
);

/**
 * Build a title list of length n by cycling a real corpus.
 *
 * Repeats are deliberate: BPE tokenisation is position-independent, so a repeated
 * title costs exactly what the original did. The earlier offline pass appended a
 * numeric suffix to keep titles unique and inflated every figure by ~6%. Uniqueness
 * matters for what the model *decides*, not for what the request *costs*, and these
 * phases only measure cost.
 */
function titlesOfSize(n, pool) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length]);
  return out;
}

/** One representative capture — the volatile suffix, identical across sizes. */
const SAMPLE_CAPTURE =
  "the plateau thing about sleep debt keeps nagging at me — maybe recovery is not linear at all";

/** Mixed captures for phase C: idea-shaped, task-shaped, noise-shaped. */
const OUTPUT_CAPTURES = [
  "the plateau thing about sleep debt keeps nagging at me — maybe recovery is not linear at all",
  "talked to Sam about the pricing page and he thinks the catch-up number is the whole pitch",
  "buy oat milk and eggs on the way home",
  "reading Christensen again — disruption is about the business model, not the technology",
  "weird that every note tool ends up being a filing system nobody uses after month two",
  "remind me to renew the domain before it lapses",
  "walking after lunch fixed the design block faster than another hour at the desk",
  "the graph view is a demo, not a feature — nobody navigates by it",
  "ugh",
  "if capture is cheap and review is scarce then everything should optimise for review",
];

function contextOf(pipeline, titles) {
  return pipeline.buildVaultContext({
    titles,
    vaultTags: [],
    activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
    personHubs: [],
  });
}

function requestOf(pipeline, context, capture) {
  return pipeline.buildMessagesRequest({
    model: MODEL,
    capture,
    context,
    cacheTtl: "1h",
  });
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: s[0],
    median: at(0.5),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
    p90: at(0.9),
    max: s[s.length - 1],
  };
}

// ------------------------------------------------------------------- phase A

/**
 * Exact input tokens by vault size, via Anthropic's /count_tokens. Free.
 *
 * Counts each size twice: once with the payload shape the plugin's own estimator
 * sends (`backfill.ts` drops output_config), and once with output_config included.
 * The gap is the structured-output schema, which the estimator currently ignores.
 */
async function phaseA(pipeline) {
  const rows = [];
  let schemaAccepted = null;

  for (const pool of [
    { key: "atomTitles", label: "atom titles only (mean 42.1 chars)" },
    { key: "allTitles", label: "all markdown files incl. dailies (mean 31.6)" },
  ]) {
    for (const size of VAULT_SIZES) {
      // The secondary pool only needs the sizes the pricing actually turns on.
      if (pool.key === "allTitles" && ![0, 3000].includes(size)) continue;

      const ctx = contextOf(pipeline, titlesOfSize(size, corpus[pool.key]));
      const req = requestOf(pipeline, ctx, SAMPLE_CAPTURE);
      const base = { model: req.model, system: req.system, messages: req.messages };

      const bare = await post(COUNT_TOKENS_URL, base);
      if (bare.status < 200 || bare.status >= 300) {
        console.error("[measure] count_tokens failed", bare.status, bare.json?.error?.type);
        process.exit(1);
      }

      const withSchema = await post(COUNT_TOKENS_URL, {
        ...base,
        output_config: req.output_config,
      });
      const schemaOk = withSchema.status >= 200 && withSchema.status < 300;
      if (schemaAccepted === null) schemaAccepted = schemaOk;

      const inputTokens = bare.json.input_tokens ?? 0;
      const inputTokensWithSchema = schemaOk
        ? (withSchema.json.input_tokens ?? 0)
        : null;

      const r = rates();
      rows.push({
        pool: pool.key,
        poolLabel: pool.label,
        titles: size,
        inputTokens,
        inputTokensWithSchema,
        schemaDelta:
          inputTokensWithSchema === null ? null : inputTokensWithSchema - inputTokens,
        tokensPerTitle:
          size === 0
            ? null
            : +(
                ((inputTokensWithSchema ?? inputTokens) -
                  (rows.find((x) => x.pool === pool.key && x.titles === 0)
                    ?.inputTokensWithSchema ??
                    rows.find((x) => x.pool === pool.key && x.titles === 0)
                      ?.inputTokens ??
                    0)) /
                size
              ).toFixed(2),
        // Cost of one classification if the prefix is paid in full every time.
        batchUsdNoCache:
          (((inputTokensWithSchema ?? inputTokens) * r.input + 250 * r.output) /
            1_000_000) *
          BATCH_DISCOUNT,
      });

      console.log(
        `[measure:A] ${pool.key.padEnd(10)} ${String(size).padStart(5)} titles → ` +
          `${String(inputTokens).padStart(6)} in` +
          (inputTokensWithSchema !== null
            ? ` · ${String(inputTokensWithSchema).padStart(6)} with schema (+${inputTokensWithSchema - inputTokens})`
            : " · schema rejected by count_tokens"),
      );
    }
  }

  return { rows, countTokensAcceptsOutputConfig: schemaAccepted };
}

// ------------------------------------------------------------------- phase B

/**
 * Does prompt caching actually hold at a ~38K-token prefix?
 *
 * Three back-to-back realtime calls sharing one cached context block. Call 1 should
 * write the prefix; calls 2 and 3 should read it back. Everything in the #168 pricing
 * hangs on this, and all prior evidence was a 1,586-token prefix.
 */
async function phaseB(pipeline, phaseARows) {
  const ctx = contextOf(
    pipeline,
    titlesOfSize(PAID_VAULT_SIZE, corpus.atomTitles),
  );
  const expected =
    phaseARows.find((r) => r.pool === "atomTitles" && r.titles === PAID_VAULT_SIZE)
      ?.inputTokensWithSchema ?? 0;
  const r = rates();
  const estimate =
    ((expected * r.input * CACHE_WRITE_MULT["1h"] +
      expected * r.input * CACHE_READ_MULT * 2 +
      3 * 400 * r.output) /
      1_000_000);
  console.log(
    `[measure:B] 3 realtime calls at a ~${expected}-token prefix · estimated spend $${estimate.toFixed(3)}`,
  );

  const calls = [];
  for (let i = 0; i < 3; i++) {
    chargeOne(`phase B call ${i + 1}`);
    const req = requestOf(pipeline, ctx, OUTPUT_CAPTURES[i]);
    const { status, json } = await post(MESSAGES_URL, req);
    if (status < 200 || status >= 300) {
      console.error("[measure:B] failed", status, json?.error?.type, json?.error?.message);
      break;
    }
    const usage = usageOf(json);
    calls.push({
      call: i + 1,
      usage,
      usd: usdFor(usage, { ttl: "1h" }),
      usdBatch: usdFor(usage, { ttl: "1h", batch: true }),
    });
    console.log(
      `[measure:B] call ${i + 1} → in ${usage.input_tokens} · write ${usage.cache_creation_input_tokens} · read ${usage.cache_read_input_tokens} · out ${usage.output_tokens}`,
    );
  }

  const warm = calls.slice(1);
  return {
    prefixTokensExpected: expected,
    calls,
    cacheHeld: warm.length > 0 && warm.every((c) => c.usage.cache_read_input_tokens > 0),
    /** Ground truth on whether the structured-output schema is billed as input. */
    billedPrefixTokens:
      (calls[0]?.usage.input_tokens ?? 0) +
      (calls[0]?.usage.cache_creation_input_tokens ?? 0),
    warmCallUsdBatch: warm.length
      ? warm.reduce((s, c) => s + c.usdBatch, 0) / warm.length
      : null,
  };
}

// ------------------------------------------------------------------- phase C

/**
 * What a classification really costs on the output side.
 *
 * `ASSUMED_OUTPUT_TOKENS = 250` (backfill.ts:50) drives the cost gate the user sees.
 * Sonnet 5 reasons by default — plus-service deliberately omits output_config.effort
 * so the API default applies — and reasoning tokens bill as output.
 */
async function phaseC(pipeline) {
  const ctx = contextOf(
    pipeline,
    titlesOfSize(PAID_VAULT_SIZE, corpus.atomTitles),
  );
  const captures = OUTPUT_CAPTURES.slice(3); // 0–2 already sent in phase B
  const r = rates();
  console.log(
    `[measure:C] ${captures.length} classifications on the warm prefix · estimated spend $${(
      (captures.length * (38000 * r.input * CACHE_READ_MULT + 400 * r.output)) /
      1_000_000
    ).toFixed(3)}`,
  );

  const results = [];
  for (const capture of captures) {
    chargeOne("phase C call");
    const { status, json } = await post(MESSAGES_URL, requestOf(pipeline, ctx, capture));
    if (status < 200 || status >= 300) {
      console.error("[measure:C] failed", status, json?.error?.type);
      break;
    }
    const usage = usageOf(json);
    let verdict = null;
    try {
      verdict = JSON.parse(
        (json.content || []).find((b) => b.type === "text")?.text ?? "{}",
      ).verdict;
    } catch {
      /* shape is measured elsewhere; a parse miss must not lose the usage figure */
    }
    results.push({ capture: capture.slice(0, 48), verdict, usage });
    console.log(
      `[measure:C] out ${String(usage.output_tokens).padStart(4)} · ${verdict ?? "?"} · read ${usage.cache_read_input_tokens}`,
    );
  }

  const outputs = results.map((x) => x.usage.output_tokens);
  const atomOutputs = results
    .filter((x) => x.verdict === "atom")
    .map((x) => x.usage.output_tokens);

  return {
    assumed: pipeline.ASSUMED_OUTPUT_TOKENS,
    results,
    all: outputs.length ? stats(outputs) : null,
    atomsOnly: atomOutputs.length ? stats(atomOutputs) : null,
  };
}

// ------------------------------------------------------------------- phase D

/**
 * Does the cache credit survive the Batch API — the path a catch-up actually uses?
 *
 * This is the largest open number in #168. `estimateBatchCost` (backfill.ts:91)
 * assumes no cache credit at all, and at a 52,930-token prefix that assumption is
 * the difference between roughly $30 and roughly $244 for a 3,000-capture catch-up.
 *
 * Submits a real job of identical-prefix requests and reads the per-request cache
 * figures off the results. No warm-up call: this measures what today's backfill
 * would get, not what a tuned implementation could get.
 */
async function phaseD(pipeline, phaseARows) {
  const size = Number(valueOf("batch-size", "100"));
  const ctx = contextOf(pipeline, titlesOfSize(PAID_VAULT_SIZE, corpus.atomTitles));
  const expected =
    phaseARows.find((r) => r.pool === "atomTitles" && r.titles === PAID_VAULT_SIZE)
      ?.inputTokensWithSchema ?? 0;
  const r = rates();

  const worst = ((size * expected * r.input + size * 300 * r.output) / 1_000_000) * BATCH_DISCOUNT;
  const best =
    ((expected * r.input * CACHE_WRITE_MULT["1h"] +
      (size - 1) * expected * r.input * CACHE_READ_MULT +
      size * 300 * r.output) /
      1_000_000) *
    BATCH_DISCOUNT;
  console.log(
    `[measure:D] submitting ${size} batch requests at a ~${expected}-token prefix · ` +
      `$${best.toFixed(2)} if the cache holds, $${worst.toFixed(2)} if it does not`,
  );

  // Batch requests start in parallel, so without a warm-up the first wave all miss and
  // each writes the prefix — at a 2x write rate that is the dominant cost. One cheap
  // realtime call first should collapse those duplicate writes to nothing.
  let warmUp = null;
  if (has("--warm-up")) {
    chargeOne("phase D warm-up");
    const { status, json } = await post(
      MESSAGES_URL,
      requestOf(pipeline, ctx, OUTPUT_CAPTURES[0]),
    );
    if (status >= 200 && status < 300) {
      warmUp = usageOf(json);
      console.log(
        `[measure:D] warm-up wrote ${warmUp.cache_creation_input_tokens} tokens ($${usdFor(warmUp, { ttl: "1h" }).toFixed(3)})`,
      );
    } else {
      console.error("[measure:D] warm-up failed", status, json?.error?.type);
    }
  }

  const requests = Array.from({ length: size }, (_, i) => ({
    custom_id: `measure-${String(i).padStart(4, "0")}`,
    params: requestOf(pipeline, ctx, `${OUTPUT_CAPTURES[i % OUTPUT_CAPTURES.length]} (${i})`),
  }));

  chargeOne(`phase D batch of ${size}`);
  const submit = await post("https://api.anthropic.com/v1/messages/batches", { requests });
  if (submit.status < 200 || submit.status >= 300) {
    console.error("[measure:D] submit failed", submit.status, submit.json?.error?.message);
    return { error: submit.json?.error?.type ?? submit.status };
  }
  const batchId = submit.json.id;
  const submittedAt = Date.now();
  console.log(`[measure:D] batch ${batchId} submitted`);

  // Polling happens inside this process on a long interval — run the script itself
  // in the background rather than re-invoking it to check on the job.
  let status = submit.json;
  const deadline = submittedAt + 3 * 60 * 60 * 1000;
  while (status.processing_status !== "ended") {
    if (Date.now() > deadline) {
      console.error(`[measure:D] gave up after 3h · batch ${batchId} still running`);
      return { batchId, timedOut: true };
    }
    await new Promise((res) => setTimeout(res, 60_000));
    const poll = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": VERSION },
    });
    status = await poll.json();
    const c = status.request_counts ?? {};
    console.log(
      `[measure:D] ${Math.round((Date.now() - submittedAt) / 60000)}m · ${status.processing_status} · ` +
        `succeeded ${c.succeeded ?? 0} / processing ${c.processing ?? 0} / errored ${c.errored ?? 0}`,
    );
  }

  const durationMin = (Date.now() - submittedAt) / 60000;
  const resultsRes = await fetch(status.results_url, {
    headers: { "x-api-key": apiKey, "anthropic-version": VERSION },
  });
  const jsonl = await resultsRes.text();

  const usages = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const msg = row.result?.message;
    if (msg) usages.push(usageOf(msg));
  }

  const hits = usages.filter((u) => u.cache_read_input_tokens > 0);
  const writes = usages.filter((u) => u.cache_creation_input_tokens > 0);
  const totalUsd = usages.reduce((s, u) => s + usdFor(u, { ttl: "1h", batch: true }), 0);
  const noCacheUsd =
    ((usages.length * expected * r.input +
      usages.reduce((s, u) => s + u.output_tokens, 0) * r.output) /
      1_000_000) *
    BATCH_DISCOUNT;

  console.log(
    `[measure:D] ${usages.length} results in ${durationMin.toFixed(1)}m · ` +
      `cache hits ${hits.length}/${usages.length} (${((hits.length / usages.length) * 100).toFixed(0)}%) · ` +
      `writes ${writes.length} · actual $${totalUsd.toFixed(2)} vs $${noCacheUsd.toFixed(2)} uncached`,
  );

  return {
    batchId,
    batchSize: size,
    warmUp,
    durationMinutes: +durationMin.toFixed(1),
    results: usages.length,
    cacheHits: hits.length,
    cacheHitRate: +(hits.length / usages.length).toFixed(3),
    cacheWrites: writes.length,
    duplicateWriteTokens: writes.reduce((s, u) => s + u.cache_creation_input_tokens, 0),
    outputTokens: stats(usages.map((u) => u.output_tokens)),
    actualUsd: totalUsd,
    uncachedUsd: noCacheUsd,
    /** Extrapolated to the catch-up size #168 actually sells. */
    per3000CapturesUsd: (totalUsd / usages.length) * 3000,
  };
}

// ---------------------------------------------------------------------- main

const pipeline = await loadRepoPipeline();
console.log(
  `[measure] key ${fingerprint} · model ${MODEL} · phases ${[...phases].join("")} · paid cap ${MAX_PAID_CALLS}`,
);

const report = {
  measuredAt: new Date().toISOString(),
  model: MODEL,
  corpus: corpus.stats,
  assumedOutputTokens: pipeline.ASSUMED_OUTPUT_TOKENS,
  defaultBackfillModel: pipeline.DEFAULT_BACKFILL_MODEL,
};

if (phases.has("a")) report.phaseA = await phaseA(pipeline);

if (phases.has("b") || phases.has("c") || phases.has("d")) {
  if (!spend) {
    console.error("Phases B, C and D send billable requests. Re-run with --spend.");
    process.exit(1);
  }
  if (!report.phaseA) {
    console.error("The paid phases need phase A's token counts. Include 'a' in --phases.");
    process.exit(1);
  }
  if (phases.has("b")) report.phaseB = await phaseB(pipeline, report.phaseA.rows);
  if (phases.has("c")) report.phaseC = await phaseC(pipeline);
  if (phases.has("d")) report.phaseD = await phaseD(pipeline, report.phaseA.rows);
  report.paidCallsSent = paidCalls;
  report.actualSpendUsd = [
    ...(report.phaseB?.calls ?? []).map((c) => c.usd),
    ...(report.phaseC?.results ?? []).map((x) => usdFor(x.usage, { ttl: "1h" })),
    report.phaseD?.actualUsd ?? 0,
  ].reduce((a, b) => a + b, 0);
  console.log(`[measure] paid calls ${paidCalls} · actual spend $${report.actualSpendUsd.toFixed(3)}`);
}

if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(report, null, 2) + "\n");
  console.log(`[measure] wrote ${path.relative(REPO_ROOT, abs)}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
