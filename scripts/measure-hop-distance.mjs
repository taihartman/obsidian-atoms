#!/usr/bin/env node
/**
 * Does graph expansion stand a chance? — hop distance from BM25's seeds to the notes it misses.
 *
 * The proposal (docs/research/2026-07-29-graph-expansion.md) is a 2-hop decayed BFS out of the
 * top BM25 hits, fused into reserved shortlist slots. That only pays if the notes BM25 misses are
 * actually 1–2 hops from the notes it finds. This measures exactly that, and it is free.
 *
 * Non-circularity: the edge being predicted must not be in the graph. It never is here — the
 * capture being classified does not exist in the vault yet, so NONE of its links are available.
 * The graph is built only from captures dated earlier than the one under test.
 *
 * Three graph settings, because "reachable" means different things:
 *
 *   full        every prior edge, hub notes traversable. The optimistic ceiling.
 *   hub-blocked hub notes may be reached but not expanded through. The research doc's rule —
 *               a person hub touches everything, so a path through one is not evidence of
 *               relatedness, it is evidence that the hub exists.
 *   catch-up    only pre-run edges (atom → pre-existing note). What a graph-blind catch-up run
 *               actually has, since links written during the run are withheld to avoid a run
 *               retrieving over links it just created.
 *
 * And three populations of gold link, because they need different things:
 *
 *   in top-n    BM25 already retrieved it. Expansion has nothing to add.
 *   ranked      BM25 scored it but below the seed cut. A ranking problem, not a reach problem.
 *   zero-score  BM25 gave it literally no score — no shared term. This is the population that
 *               k-widening provably cannot serve, and the only one graph expansion is FOR.
 *
 * Usage:
 *   node scripts/measure-hop-distance.mjs
 *   node scripts/measure-hop-distance.mjs --seeds 10 --k 400 --out docs/research/data/hops.json
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, bm25Rank } from "./lib/shortlist.mjs";
import { buildPreRunVault, describePool, loadChronoCaptures } from "./lib/corpus.mjs";

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const SEEDS = Number(valueOf("seeds", "10"));
const K = Number(valueOf("k", "400"));
const MAX_HOPS = Number(valueOf("hops", "4"));
const PRE_RUN_SIZE = Number(valueOf("pre-run", "1200"));

// -------------------------------------------------------------------- corpus

const captures = loadChronoCaptures();

if (!captures.length) {
  console.error("No chrono-corpus-*.json fixtures found.");
  process.exit(1);
}

const byId = new Map(captures.map((c) => [c.id, c]));
const atoms = captures.filter((c) => c.verdict === "atom");
const atomIds = new Set(atoms.map((c) => c.id));
const position = new Map(atoms.map((c, i) => [c.id, i]));

/** Same stand-in title measure-chrono-linking.mjs uses, so the two scripts index the same notes. */
const titleOf = (c) => `${c.id} ${c.capture.slice(0, 46).replace(/\s+\S*$/, "")}`;

// The vault as it stands when the run starts: referenced hub titles plus real-corpus filler, so
// the seed slots are genuinely contested rather than handed to the corpus by default.
const hubTitles = [...new Set(captures.flatMap((c) => c.linksToExisting ?? []))];
const preRun = buildPreRunVault({
  size: PRE_RUN_SIZE,
  hubTitles,
  bodyPool: captures.map((c) => c.capture),
  mode: valueOf("filler", "coherent"),
});
const hubSet = new Set(hubTitles);

// ---------------------------------------------------------------- the graphs

/**
 * Adjacency over everything written before `cutoff` (an index into `atoms`).
 * `preRunOnly` keeps just the atom → pre-existing-note edges: the graph-blind catch-up case.
 */
function buildGraph(cutoff, { preRunOnly }) {
  const g = new Map();
  const edge = (a, b) => {
    if (!g.has(a)) g.set(a, new Set());
    if (!g.has(b)) g.set(b, new Set());
    g.get(a).add(b);
    g.get(b).add(a);
  };
  for (let i = 0; i < cutoff; i++) {
    const c = atoms[i];
    const from = titleOf(c);
    for (const h of c.linksToExisting ?? []) edge(from, h);
    if (preRunOnly) continue;
    for (const t of c.linksToEarlier ?? []) {
      if (atomIds.has(t) && position.get(t) < cutoff) edge(from, titleOf(byId.get(t)));
    }
  }
  return g;
}

/** Min hops from any seed to `target`; Infinity if unreachable. `blockHubs` stops expansion at hubs. */
function hopDistance(g, seeds, target, { blockHubs }) {
  const seen = new Set();
  let frontier = [];
  for (const s of seeds) {
    if (s === target) return 0;
    if (g.has(s) && !seen.has(s)) {
      seen.add(s);
      frontier.push(s);
    }
  }
  for (let d = 1; d <= MAX_HOPS && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      if (blockHubs && hubSet.has(node)) continue; // reachable, but not a road
      for (const nb of g.get(node) ?? []) {
        if (seen.has(nb)) continue;
        if (nb === target) return d;
        seen.add(nb);
        next.push(nb);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * The whole 2-hop expansion set: how many notes it pulls in (the slot budget) and which of them
 * are gold (the precision the model then has to sift).
 */
function expansionSet(g, seeds, { blockHubs }) {
  const seen = new Set(seeds.filter((s) => g.has(s)));
  let frontier = [...seen];
  const sizes = [];
  const added = new Set();
  for (let d = 1; d <= 2; d++) {
    const next = [];
    for (const node of frontier) {
      if (blockHubs && hubSet.has(node)) continue;
      for (const nb of g.get(node) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        added.add(nb);
        next.push(nb);
      }
    }
    sizes.push(next.length);
    frontier = next;
  }
  return { sizes, added }; // sizes = [oneHopNew, twoHopNew]
}

// ------------------------------------------------------------------ the sweep

const SETTINGS = [
  { key: "full", label: "full graph, hubs traversable", preRunOnly: false, blockHubs: false },
  { key: "hubBlocked", label: "full graph, hubs blocked", preRunOnly: false, blockHubs: true },
  { key: "catchUp", label: "graph-blind catch-up", preRunOnly: true, blockHubs: false },
];
const POPS = ["inSeeds", "ranked", "zeroScore"];

const stats = {};
for (const s of SETTINGS) {
  stats[s.key] = {};
  for (const p of POPS) stats[s.key][p] = { n: 0, hops: new Map() };
}
const frontier = { full: [], hubBlocked: [], catchUp: [] };
const precision = Object.fromEntries(SETTINGS.map((s) => [s.key, { slots: 0, gold: 0 }]));
const rankSamples = [];
let goldTotal = 0, inK = 0, honestInK = 0;

for (let i = 0; i < atoms.length; i++) {
  const c = atoms[i];
  const gold = (c.linksToEarlier ?? []).filter((t) => atomIds.has(t) && position.get(t) < i);
  if (!gold.length) continue;

  // Everything that exists when this capture is classified: the pre-run vault plus earlier atoms.
  const pool = [
    ...preRun,
    ...atoms.slice(0, i).map((a) => ({ title: titleOf(a), ageDays: 1, body: a.capture })),
  ];
  const ranked = bm25Rank(c.capture, pool, "both");
  const rankOf = new Map(ranked.map((n, idx) => [n.title, idx]));
  const scoreOf = new Map(ranked.map((n) => [n.title, n.score]));
  const seeds = ranked.slice(0, SEEDS).map((n) => n.title);

  // Two graphs cover all three settings: hub-blocking is a traversal rule, not a different graph.
  const gAll = buildGraph(i, { preRunOnly: false });
  const gPre = buildGraph(i, { preRunOnly: true });
  const graphFor = { full: gAll, hubBlocked: gAll, catchUp: gPre };

  const goldTitles = new Set(gold.map((t) => titleOf(byId.get(t))));
  for (const s of SETTINGS) {
    const { sizes, added } = expansionSet(graphFor[s.key], seeds, { blockHubs: s.blockHubs });
    frontier[s.key].push(sizes);
    precision[s.key].slots += added.size;
    for (const t of goldTitles) if (added.has(t)) precision[s.key].gold++;
  }

  for (const t of gold) {
    goldTotal++;
    const title = titleOf(byId.get(t));
    const rank = rankOf.get(title);
    const score = scoreOf.get(title) ?? 0;
    if (rank < K) inK++;
    // A zero-score target inside k is there on the alphabetical tiebreak, which is luck, not
    // retrieval. Only scored-and-inside-k is honest recall.
    if (rank < K && score > 0) honestInK++;
    rankSamples.push({ rank, score, capture: c.id, target: t });

    const pop = rank < SEEDS ? "inSeeds" : score > 0 ? "ranked" : "zeroScore";
    for (const s of SETTINGS) {
      const d = hopDistance(graphFor[s.key], seeds, title, { blockHubs: s.blockHubs });
      const bucket = stats[s.key][pop];
      bucket.n++;
      bucket.hops.set(d, (bucket.hops.get(d) ?? 0) + 1);
    }
  }
}

// -------------------------------------------------------------------- report

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
const popTotals = Object.fromEntries(POPS.map((p) => [p, stats.full[p].n]));

console.log(
  `corpus: ${captures.length} captures (${atoms.length} atoms) · ${goldTotal} gold links to an ` +
    `earlier atom\nseeds = BM25 bodyPlusTitle top ${SEEDS}\n` +
    describePool("pre-run vault", preRun) + "\n" +
    describePool("corpus atoms  ", atoms.map((c) => ({ title: titleOf(c), body: c.capture }))) + "\n",
);

console.log("— where the gold target sits in the BM25 ranking —");
console.log(`  already in the top ${SEEDS} seeds : ${popTotals.inSeeds} (${pct(popTotals.inSeeds, goldTotal)})`);
console.log(`  scored, but ranked below        : ${popTotals.ranked} (${pct(popTotals.ranked, goldTotal)})`);
console.log(`  zero score — no shared term     : ${popTotals.zeroScore} (${pct(popTotals.zeroScore, goldTotal)})`);
console.log(`  inside k=${K} regardless          : ${inK} (${pct(inK, goldTotal)})`);
console.log(`  inside k=${K} AND scored          : ${honestInK} (${pct(honestInK, goldTotal)})  <- honest recall@${K}`);
const found = rankSamples.filter((r) => r.score > 0).map((r) => r.rank).sort((a, b) => a - b);
console.log(
  `  median rank when scored at all  : ${found[Math.floor(found.length / 2)]}` +
    `  (p90 ${found[Math.floor(found.length * 0.9)]}, worst ${found[found.length - 1]})\n`,
);

for (const s of SETTINGS) {
  console.log(`— hops from the seeds to the target · ${s.label} —`);
  console.log("population".padEnd(14) + "n".padStart(6) + "1 hop".padStart(9) + "2 hops".padStart(9) +
    "≤2 hops".padStart(10) + "3+".padStart(7) + "unreachable".padStart(13));
  for (const p of POPS) {
    if (p === "inSeeds") continue; // hop 0 by definition — expansion has nothing to add
    const b = stats[s.key][p];
    const h = (d) => b.hops.get(d) ?? 0;
    const within2 = h(1) + h(2);
    const deep = [...b.hops].filter(([d]) => d >= 3 && Number.isFinite(d)).reduce((a, [, v]) => a + v, 0);
    console.log(
      p.padEnd(14) + String(b.n).padStart(6) + pct(h(1), b.n).padStart(9) + pct(h(2), b.n).padStart(9) +
        pct(within2, b.n).padStart(10) + pct(deep, b.n).padStart(7) +
        pct(b.hops.get(Infinity) ?? 0, b.n).padStart(13),
    );
  }
  const f = frontier[s.key];
  const mean = (idx) => Math.round(f.reduce((a, x) => a + x[idx], 0) / (f.length || 1));
  const p90 = (idx) => {
    const v = f.map((x) => x[idx]).sort((a, b) => a - b);
    return v[Math.floor(v.length * 0.9)] ?? 0;
  };
  const pr = precision[s.key];
  console.log(
    `expansion set: ${mean(0)} notes at 1 hop (p90 ${p90(0)}), ` +
      `+${mean(1)} more at 2 (p90 ${p90(1)}) — the reserved-slot budget is ~60\n` +
      `precision:     ${pr.gold} gold in ${pr.slots} added titles (${(pr.slots ? (pr.gold / pr.slots) * 100 : 0).toFixed(1)}%)\n`,
  );
}

console.log(
  "Read it this way: 'zeroScore' is the only population graph expansion exists to serve, because a\n" +
    "zero-score note cannot be recovered by widening k. If its ≤2-hop column is low, or its reach\n" +
    "depends on hubs being traversable, expansion cannot get there and the idea is dead.",
);

const outPath = valueOf("out", "");
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const serialised = Object.fromEntries(
    SETTINGS.map((s) => [
      s.key,
      Object.fromEntries(
        POPS.map((p) => [
          p,
          {
            n: stats[s.key][p].n,
            hops: Object.fromEntries(
              [...stats[s.key][p].hops].map(([d, v]) => [Number.isFinite(d) ? d : "unreachable", v]),
            ),
          },
        ]),
      ),
    ]),
  );
  fs.writeFileSync(
    abs,
    JSON.stringify(
      {
        seeds: SEEDS, k: K, maxHops: MAX_HOPS, preRunVault: preRun.length,
        goldLinks: goldTotal, insideK: inK, honestInsideK: honestInK, populations: popTotals, settings: serialised,
        frontier: Object.fromEntries(
          SETTINGS.map((s) => {
            const f = frontier[s.key];
            const mean = (i) => Math.round(f.reduce((a, x) => a + x[i], 0) / (f.length || 1));
            return [s.key, { meanOneHop: mean(0), meanTwoHop: mean(1) }];
          }),
        ),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote ${path.relative(REPO_ROOT, abs)}`);
}
