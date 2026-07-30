#!/usr/bin/env node
/**
 * Feasibility spike — can a phone build and hold a body-text index?
 *
 * Body-scored shortlisting needs every note's text, not just its title. The pipeline reads no
 * bodies today, and `isDesktopOnly: false` is a constitutional constraint, so if this only works
 * on desktop the design is not shippable. This measures the three costs that decide it:
 *
 *   1. reading N note bodies off disk        (the vault.cachedRead equivalent)
 *   2. building an inverted index over them  (CPU, one-off per run or cached)
 *   3. scoring one capture against it        (per-capture, must be interactive)
 *
 * Desktop numbers only — no phone is being driven here. Mobile multipliers are stated as
 * assumptions, not measurements, and are flagged as such in the output.
 *
 * READ-ONLY. Writes nothing except the optional --out report.
 *
 * Usage:
 *   node scripts/spike-index-feasibility.mjs
 *   node scripts/spike-index-feasibility.mjs --vault "$HOME/Documents/Remote Vault"
 */
import fs from "node:fs";
import path from "node:path";
import { tokens } from "./lib/shortlist.mjs";

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

/**
 * Conservative phone-vs-laptop factors. A recent iPhone is not 5x slower than an M-series Mac on
 * single-threaded JS, but Obsidian mobile runs in a memory-constrained webview and file I/O goes
 * through a sync layer, so slow factors are used deliberately.
 */
const MOBILE_CPU_FACTOR = 4;
const MOBILE_IO_FACTOR = 6;
/** iOS kills a webview well before this; treat anything approaching it as unshippable. */
const MOBILE_BUDGET_MB = 100;

const vaultPath = valueOf("vault", "");
/** Index only the first N chars of each body; recall holds at 200 (see analyze-vault-shortlist). */
const bodyChars = Number(valueOf("body-chars", "0"));

// ------------------------------------------------- measure a real vault first

let bodyStats = { mean: 480, p90: 1200 };
let realReadMs = null;
let realCount = 0;
/**
 * Real note bodies, used as the corpus. Index size and query cost are dominated by vocabulary
 * size, so a hand-written word list badly understates both — a first pass with ~46 invented words
 * produced a 46-term index and unmeasurably fast queries. Cycling real bodies gives a real term
 * distribution; repetition inflates term frequencies slightly but leaves the structure honest.
 */
let realBodies = [];

if (vaultPath && fs.existsSync(vaultPath)) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) files.push(p);
    }
  })(vaultPath);

  const t0 = performance.now();
  const lengths = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(f, "utf8");
      lengths.push(text.length);
      realBodies.push(bodyChars ? text.slice(0, bodyChars) : text);
    } catch {
      /* sync placeholder */
    }
  }
  realReadMs = performance.now() - t0;
  realCount = lengths.length;
  lengths.sort((a, b) => a - b);
  bodyStats = {
    mean: Math.round(lengths.reduce((s, x) => s + x, 0) / lengths.length),
    p90: lengths[Math.floor(lengths.length * 0.9)],
  };
  console.log(
    `real vault: ${realCount} readable notes · mean ${bodyStats.mean} chars · p90 ${bodyStats.p90} · ` +
      `read all in ${realReadMs.toFixed(0)}ms (${(realReadMs / realCount).toFixed(2)}ms/note)`,
  );
  console.log(
    `  extrapolated to phone: ~${((realReadMs * MOBILE_IO_FACTOR) / 1000).toFixed(1)}s to read this vault\n`,
  );
}

// ------------------------------------------------------------- synthetic body

const WORDS =
  ("knee running sleep breakfast onions stomach detergent eczema mood walk desk design block " +
   "hiring taste renting owning consensus decision meeting pricing invoice landlord wedding " +
   "sourdough fridge retard recipe goldfinch novel aftermath database schema deploy rollback " +
   "newsletter subscriber churn budget deadline anxiety ambition parenting money trust lie")
    .split(" ");

function makeBody(i, chars) {
  const out = [];
  let len = 0;
  let seed = i * 2654435761;
  while (len < chars) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const w = WORDS[seed % WORDS.length];
    out.push(w);
    len += w.length + 1;
  }
  return out.join(" ");
}

/** Inverted index: term -> [{doc, tf}]. What a real implementation would keep between captures. */
function buildIndex(docs) {
  const index = new Map();
  const lengths = new Int32Array(docs.length);
  for (let d = 0; d < docs.length; d++) {
    const terms = tokens(docs[d]);
    lengths[d] = terms.length;
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, f] of tf) {
      let postings = index.get(t);
      if (!postings) index.set(t, (postings = []));
      postings.push(d, f); // flat pairs — cheaper than objects at this scale
    }
  }
  return { index, lengths };
}

function query(capture, { index, lengths }, docCount) {
  const q = tokens(capture);
  const scores = new Float64Array(docCount);
  const avgdl = lengths.reduce((s, x) => s + x, 0) / docCount;
  const k1 = 1.2, b = 0.75;
  for (const t of new Set(q)) {
    const postings = index.get(t);
    if (!postings) continue;
    const df = postings.length / 2;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    for (let i = 0; i < postings.length; i += 2) {
      const d = postings[i], f = postings[i + 1];
      scores[d] += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[d]) / avgdl)));
    }
  }
  return scores;
}

// --------------------------------------------------------------------- sweep

const CAPTURE = "knees been grumpy on the sunday long one again outside edge of the joint";
const SIZES = [500, 1000, 3000, 5000, 10000];
const rows = [];

console.log(
  `synthetic sweep · bodies at the real vault's mean of ${bodyStats.mean} chars\n` +
    `assumptions: phone CPU ${MOBILE_CPU_FACTOR}x slower, phone I/O ${MOBILE_IO_FACTOR}x slower\n`,
);
console.log(
  "notes".padStart(7) + "build".padStart(10) + "query".padStart(9) + "heap".padStart(9) +
    "  | phone build".padStart(16) + "phone query".padStart(14),
);

if (!realBodies.length) {
  console.log("WARNING: no vault given — falling back to an invented word list, which badly");
  console.log("         understates index size and query time. Pass --vault for real numbers.\n");
}

for (const n of SIZES) {
  const docs = realBodies.length
    ? Array.from({ length: n }, (_, i) => realBodies[i % realBodies.length])
    : Array.from({ length: n }, (_, i) => makeBody(i, bodyStats.mean));

  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const built = buildIndex(docs);
  const buildMs = performance.now() - t0;
  const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1048576;

  // Warm, then measure a realistic per-capture query.
  query(CAPTURE, built, n);
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) query(CAPTURE, built, n);
  const queryMs = (performance.now() - t1) / 20;

  rows.push({ notes: n, buildMs: +buildMs.toFixed(1), queryMs: +queryMs.toFixed(2),
    heapMb: +heapMb.toFixed(1), terms: built.index.size });

  console.log(
    String(n).padStart(7) +
      `${buildMs.toFixed(0)}ms`.padStart(10) +
      `${queryMs.toFixed(1)}ms`.padStart(9) +
      `${heapMb.toFixed(1)}MB`.padStart(9) +
      `  | ${((buildMs * MOBILE_CPU_FACTOR) / 1000).toFixed(1)}s`.padStart(16) +
      `${(queryMs * MOBILE_CPU_FACTOR).toFixed(0)}ms`.padStart(14),
  );
}

// ------------------------------------------------------------------ verdict

const at3000 = rows.find((r) => r.notes === 3000);
const at10000 = rows.find((r) => r.notes === 10000);
const readMs3000 = realReadMs ? (realReadMs / realCount) * 3000 : null;

console.log("\n— verdict at 3,000 notes, the size a catch-up produces —");
if (readMs3000 !== null) {
  console.log(
    `  read bodies:  ~${(readMs3000 / 1000).toFixed(1)}s desktop → ~${((readMs3000 * MOBILE_IO_FACTOR) / 1000).toFixed(0)}s phone`,
  );
}
console.log(`  build index:  ~${(at3000.buildMs / 1000).toFixed(1)}s desktop → ~${((at3000.buildMs * MOBILE_CPU_FACTOR) / 1000).toFixed(1)}s phone`);
console.log(`  per capture:  ~${at3000.queryMs.toFixed(1)}ms desktop → ~${(at3000.queryMs * MOBILE_CPU_FACTOR).toFixed(0)}ms phone`);
console.log(`  index memory: ~${at3000.heapMb.toFixed(1)}MB (${at3000.terms.toLocaleString()} distinct terms) of a ~${MOBILE_BUDGET_MB}MB phone budget`);
console.log(`  at 10,000 notes memory is ~${at10000.heapMb.toFixed(1)}MB`);

const outPath = valueOf("out", "");
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(
    path.resolve(outPath),
    JSON.stringify({ bodyStats, realCount, realReadMs, mobileAssumptions:
      { MOBILE_CPU_FACTOR, MOBILE_IO_FACTOR, MOBILE_BUDGET_MB }, rows }, null, 2) + "\n",
  );
  console.log(`\nwrote ${outPath}`);
}
