#!/usr/bin/env node
/**
 * Model-side check — given a shortlist, does the model actually emit the link?
 *
 * Step 4 of docs/plans/2026-07-28-004-research-shortlist-quality-experiment.md. The free sweep
 * (measure-shortlist-recall.mjs) establishes a ceiling: whether the planted target reaches the
 * shortlist at all. This spends real money to find out how much of that ceiling the model
 * converts, and compares each capped selector against the uncapped `full` baseline.
 *
 * Usage:
 *   npm run measure:links                       # dry — prints the spend estimate and stops
 *   npm run measure:links -- --spend
 *   npm run measure:links -- --spend --configs=full,bodyPlusTitle:400
 *
 * Log-safety: reads ANTHROPIC_API_KEY from the environment, never prints or stores it.
 */
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  SELECTORS,
  buildVault,
  loadProbes,
  loadRealTitles,
} from "./lib/shortlist.mjs";
import { loadRepoPipeline } from "./lib/pipeline.mjs";

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const VAULT_SIZE = 3000;
const CONCURRENCY = 5;
const MAX_PAID_CALLS = 400;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY to run this (read from the environment, never printed).");
  process.exit(1);
}

/** `full` is the baseline every capped selector is scored against — keep it first. */
const CONFIGS = valueOf("configs", "full,bodyPlusTitle:400,bodyPlusTitle:40,alphabetical:40")
  .split(",")
  .map((s) => {
    const [selector, k] = s.split(":");
    return { label: s, selector, k: k ? Number(k) : Infinity };
  });

const probes = loadProbes();
const realTitles = loadRealTitles();
const pipeline = await loadRepoPipeline();

let paidCalls = 0;

function requestFor(probe, cfg) {
  const notes = buildVault(probe, VAULT_SIZE, probes, realTitles);
  const shortlist = SELECTORS[cfg.selector](probe.capture, notes, cfg.k);
  const context = pipeline.buildVaultContext({
    titles: shortlist.map((n) => n.title),
    vaultTags: [],
    activeVocabulary: pipeline.DEFAULT_ACTIVE_VOCABULARY,
    personHubs: [],
  });
  return {
    body: pipeline.buildMessagesRequest({
      model: MODEL,
      capture: probe.capture,
      context,
      cacheTtl: "1h",
    }),
    // Recorded so a miss can be attributed: shortlist failure or model failure?
    targetInShortlist: probe.targetTitle
      ? shortlist.some((n) => n.title === probe.targetTitle)
      : null,
  };
}

async function classify(probe, cfg) {
  if (paidCalls >= MAX_PAID_CALLS) throw new Error(`Paid-call cap ${MAX_PAID_CALLS} reached`);
  paidCalls += 1;
  const { body, targetInShortlist } = requestFor(probe, cfg);
  const res = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": VERSION,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status < 200 || res.status >= 300) {
    return { probe: probe.id, config: cfg.label, error: json?.error?.type ?? res.status };
  }
  let parsed = {};
  try {
    parsed = JSON.parse((json.content || []).find((b) => b.type === "text")?.text ?? "{}");
  } catch {
    /* keep the usage figures even when the payload does not parse */
  }
  const links = (parsed.links ?? []).map((l) => l.note);
  const u = json.usage ?? {};
  return {
    probe: probe.id,
    archetype: probe.archetype,
    failureMode: probe.failureMode,
    config: cfg.label,
    targetTitle: probe.targetTitle || null,
    targetInShortlist,
    verdict: parsed.verdict ?? null,
    title: parsed.title ?? null,
    links,
    targetLinked: probe.targetTitle ? links.includes(probe.targetTitle) : null,
    /** Cold-start probes have no target: any link at all is an invented one. */
    inventedLinks: probe.targetTitle ? null : links.length,
    usage: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------- estimate

const sample = requestFor(probes[0], CONFIGS[0]);
console.log(
  `[links] ${probes.length} probes x ${CONFIGS.length} configs = ${probes.length * CONFIGS.length} calls ` +
    `at vault ${VAULT_SIZE}, model ${MODEL}`,
);
for (const cfg of CONFIGS) {
  const titles = Number.isFinite(cfg.k) ? cfg.k : VAULT_SIZE;
  // ~16.5 tokens per title plus the ~3,500-token fixed prompt; see research doc §0.1.
  const tok = Math.round(3507 + titles * 16.47);
  console.log(`  ${cfg.label.padEnd(22)} ~${tok} input tokens/request`);
}
if (!has("--spend")) {
  console.log("\nThis sends billable requests. Re-run with --spend.");
  process.exit(0);
}

// -------------------------------------------------------------------- run

const jobs = [];
for (const cfg of CONFIGS) for (const probe of probes) jobs.push({ probe, cfg });

const results = [];
let done = 0;
async function worker() {
  while (jobs.length) {
    const job = jobs.shift();
    if (!job) break;
    try {
      results.push(await classify(job.probe, job.cfg));
    } catch (err) {
      results.push({ probe: job.probe.id, config: job.cfg.label, error: String(err.message) });
    }
    if (++done % 25 === 0) console.log(`[links] ${done} calls done`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// ----------------------------------------------------------------- report

const spend = results.reduce((s, r) => {
  const u = r.usage;
  if (!u) return s;
  return s + (u.input * 3 + u.cacheWrite * 6 + u.cacheRead * 0.3 + u.output * 15) / 1e6;
}, 0);

console.log(`\n[links] ${results.length} results · spend $${spend.toFixed(2)}\n`);
console.log("config".padEnd(22), "linked", "  ceiling", "  converted", " invented");

const baseline = new Map();
for (const cfg of CONFIGS) {
  const rows = results.filter((r) => r.config === cfg.label && !r.error);
  const withTarget = rows.filter((r) => r.targetTitle);
  const linked = withTarget.filter((r) => r.targetLinked).length;
  const inShortlist = withTarget.filter((r) => r.targetInShortlist).length;
  const invented = rows.filter((r) => r.inventedLinks !== null)
    .reduce((s, r) => s + r.inventedLinks, 0);
  if (cfg === CONFIGS[0]) for (const r of rows) baseline.set(r.probe, r.links);

  console.log(
    cfg.label.padEnd(22),
    `${((linked / withTarget.length) * 100).toFixed(0)}%`.padStart(6),
    `${((inShortlist / withTarget.length) * 100).toFixed(0)}%`.padStart(9),
    // Of the targets the selector did surface, how many did the model actually use?
    `${inShortlist ? ((linked / inShortlist) * 100).toFixed(0) : 0}%`.padStart(11),
    String(invented).padStart(9),
  );
}

console.log("\n— what each capped config lost that `full` linked —");
for (const cfg of CONFIGS.slice(1)) {
  const rows = results.filter((r) => r.config === cfg.label && !r.error && r.targetTitle);
  const lost = rows.filter((r) => !r.targetLinked && baseline.get(r.probe)?.includes(r.targetTitle));
  console.log(`\n${cfg.label}: ${lost.length} regressions vs full`);
  for (const r of lost.slice(0, 12)) {
    console.log(
      `  ${r.probe} (mode ${r.failureMode}) ${r.targetInShortlist ? "in shortlist, model skipped it" : "not in shortlist"} → "${r.targetTitle}"`,
    );
  }
}

const outPath = valueOf("out", "docs/research/data/2026-07-28-link-quality.json");
const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, JSON.stringify({ model: MODEL, vaultSize: VAULT_SIZE, spend, results }, null, 2) + "\n");
console.log(`\n[links] wrote ${path.relative(REPO_ROOT, abs)}`);
