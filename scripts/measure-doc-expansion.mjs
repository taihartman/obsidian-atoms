#!/usr/bin/env node
/**
 * Document-side expansion — does indexing what the MODEL wrote about a note rescue the notes BM25
 * scores at zero? Free, no API calls.
 *
 * The finding this exists to act on (docs/research/2026-07-29-retrieval-techniques.md):
 * **misses are absolute, not ranking failures.** A missed note scores literally zero, so widening k
 * cannot recover it — only a term match can. The pipeline already pays a model to write each atom's
 * title, tags and link prose. Indexing that output is doc2query for free: the model's paraphrase
 * adds the vocabulary the user's own capture happened not to use.
 *
 * Measured on the chronological corpus, where `linksToExisting` is the link prose — the
 * pre-existing notes (people, projects, places) the model named when it filed the atom.
 *
 * The headline metric is NOT recall. It is **how many gold targets still score zero**, because
 * that is the population no amount of k buys back.
 *
 * Usage:
 *   node scripts/measure-doc-expansion.mjs
 *   node scripts/measure-doc-expansion.mjs --out docs/research/data/expansion.json
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, tokens } from "./lib/shortlist.mjs";
import { buildPreRunVault, describePool, loadChronoCaptures } from "./lib/corpus.mjs";

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const KS = [40, 100, 400];
const PRE_RUN_SIZE = Number(valueOf("pre-run", "1200"));

// -------------------------------------------------------------------- corpus

const captures = loadChronoCaptures();

const byId = new Map(captures.map((c) => [c.id, c]));
const atoms = captures.filter((c) => c.verdict === "atom");
const atomIds = new Set(atoms.map((c) => c.id));
const position = new Map(atoms.map((c, i) => [c.id, i]));
const titleOf = (c) => `${c.id} ${c.capture.slice(0, 46).replace(/\s+\S*$/, "")}`;

/**
 * A document as three separately-weighable fields. `links` is the model's output, not the user's —
 * that is the whole point: it carries vocabulary the capture does not.
 */
const docOf = (c) => ({
  title: tokens(titleOf(c)),
  body: tokens(c.capture),
  links: tokens((c.linksToExisting ?? []).join(" ")),
});

const atomDocs = atoms.map(docOf);
const hubTitles = [...new Set(captures.flatMap((c) => c.linksToExisting ?? []))];
const preRunNotes = buildPreRunVault({
  size: PRE_RUN_SIZE,
  hubTitles,
  bodyPool: captures.map((c) => c.capture),
  mode: valueOf("filler", "coherent"),
});
// Filler carries no link prose — only a filed atom has a model-written tail. That is the point:
// the links field must be sparse in the pool, or its idf is meaningless.
const preRun = preRunNotes.map((n) => ({
  title: n.title,
  doc: { title: tokens(n.title), body: tokens(n.body), links: [] },
}));

// ------------------------------------------------------------------- BM25F

const K1 = 1.2;

/**
 * BM25F: per-field length normalisation, weights applied to term frequency BEFORE saturation.
 * Weighting after saturation (i.e. summing per-field BM25 scores) double-counts a term that
 * appears in two fields, which is precisely the case this experiment is about.
 */
function rank(queryTokens, docs, weights) {
  const fields = Object.keys(weights).filter((f) => weights[f] > 0);
  const N = docs.length;
  const avg = {};
  for (const f of fields) avg[f] = docs.reduce((s, d) => s + d.doc[f].length, 0) / (N || 1) || 1;

  const q = [...new Set(queryTokens)];
  const df = new Map();
  const tfs = docs.map((d) => {
    const m = new Map();
    for (const f of fields) {
      const counts = new Map();
      for (const t of d.doc[f]) counts.set(t, (counts.get(t) ?? 0) + 1);
      const norm = 1 - 0.75 + (0.75 * d.doc[f].length) / avg[f];
      for (const [t, c] of counts) m.set(t, (m.get(t) ?? 0) + (weights[f] * c) / norm);
    }
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return m;
  });

  return docs
    .map((d, i) => {
      let score = 0;
      for (const t of q) {
        const tf = tfs[i].get(t);
        if (!tf) continue;
        const n = df.get(t) ?? 0;
        score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * (tf / (K1 + tf));
      }
      return { title: d.title, score };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

// ------------------------------------------------------------------- configs

const CONFIGS = [
  { key: "titleOnly", label: "title only", w: { title: 1, body: 0, links: 0 } },
  { key: "bodyTitle", label: "body + title (today's best)", w: { title: 1, body: 1, links: 0 } },
  { key: "plusLinks", label: "+ link prose", w: { title: 1, body: 1, links: 1 } },
  { key: "linksHeavy", label: "+ link prose ×3", w: { title: 1, body: 1, links: 3 } },
  { key: "bm25f", label: "BM25F title×2 body×1 links×2", w: { title: 2, body: 1, links: 2 } },
  { key: "linksOnly", label: "link prose only", w: { title: 0, body: 0, links: 1 } },
];

const BASELINE = "bodyTitle";
const results = Object.fromEntries(
  CONFIGS.map((c) => [
    c.key,
    // won/lost = discordant pairs against the baseline at k=400. A net gain of 2 points means
    // nothing if it is 40 won and 24 lost; it means a lot if it is 21 won and 0 lost.
    { found: Object.fromEntries(KS.map((k) => [k, 0])), zero: 0, ranks: [], won: 0, lost: 0 },
  ]),
);
let goldTotal = 0;

for (let i = 0; i < atoms.length; i++) {
  const c = atoms[i];
  const gold = (c.linksToEarlier ?? []).filter((t) => atomIds.has(t) && position.get(t) < i);
  if (!gold.length) continue;

  const pool = [
    ...preRun,
    ...atoms.slice(0, i).map((a, j) => ({ title: titleOf(a), doc: atomDocs[j] })),
  ];
  const q = tokens(c.capture);
  const goldTitles = gold.map((t) => titleOf(byId.get(t)));
  goldTotal += gold.length;

  const hitAt400 = {};
  for (const cfg of CONFIGS) {
    const ranked = rank(q, pool, cfg.w);
    const rankOf = new Map(ranked.map((n, idx) => [n.title, idx]));
    const scoreOf = new Map(ranked.map((n) => [n.title, n.score]));
    const r = results[cfg.key];
    hitAt400[cfg.key] = goldTitles.map((t) => (rankOf.get(t) ?? Infinity) < 400);
    for (const t of goldTitles) {
      const idx = rankOf.get(t) ?? Infinity;
      for (const k of KS) if (idx < k) r.found[k]++;
      if ((scoreOf.get(t) ?? 0) <= 0) r.zero++;
      else r.ranks.push(idx);
    }
  }
  for (const cfg of CONFIGS) {
    goldTitles.forEach((_, j) => {
      const mine = hitAt400[cfg.key][j];
      const base = hitAt400[BASELINE][j];
      if (mine && !base) results[cfg.key].won++;
      else if (!mine && base) results[cfg.key].lost++;
    });
  }
}

// -------------------------------------------------------------------- report

const pct = (a) => `${((a / goldTotal) * 100).toFixed(0)}%`;
console.log(
  `${atoms.length} atoms · ${goldTotal} gold links\n` +
    describePool("pre-run vault", preRunNotes) + "\n" +
    `"zero score" = BM25 gave the target no score at all. Widening k cannot recover those;\n` +
    `only adding terms can. That column is the experiment.\n`,
);
console.log(
  "config".padEnd(30) + KS.map((k) => `r@${k}`.padStart(7)).join("") +
    "zero-score".padStart(12) + "median rank".padStart(13) + "won/lost @400".padStart(15),
);
const rows = [];
for (const cfg of CONFIGS) {
  const r = results[cfg.key];
  const sorted = r.ranks.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : -1;
  rows.push({
    config: cfg.key, label: cfg.label, weights: cfg.w,
    recall: Object.fromEntries(KS.map((k) => [k, +(r.found[k] / goldTotal).toFixed(3)])),
    zeroScore: r.zero, medianRank: median, won: r.won, lost: r.lost,
  });
  console.log(
    cfg.label.padEnd(30) + KS.map((k) => pct(r.found[k]).padStart(7)).join("") +
      `${r.zero} (${pct(r.zero)})`.padStart(12) + String(median).padStart(13) +
      (cfg.key === BASELINE ? "—" : `+${r.won} / −${r.lost}`).padStart(15),
  );
}

const base = results.bodyTitle.zero;
const best = rows.filter((r) => r.config !== "linksOnly").sort((a, b) => a.zeroScore - b.zeroScore)[0];
console.log(
  `\nbest zero-score reduction: ${best.label} — ${base} → ${best.zeroScore} ` +
    `(${(((base - best.zeroScore) / goldTotal) * 100).toFixed(1)} points of the corpus rescued from\n` +
    `an absolute miss into something k can reach).`,
);

const outPath = valueOf("out", "");
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ atoms: atoms.length, goldLinks: goldTotal, ks: KS, rows }, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(REPO_ROOT, abs)}`);
}
