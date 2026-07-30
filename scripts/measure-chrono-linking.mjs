#!/usr/bin/env node
/**
 * Chronological catch-up simulation — what does the frozen title list actually throw away,
 * and does processing in dated chunks make a shared shortlist cacheable?
 *
 * Two questions, both free (no API calls):
 *
 *   1. IN-RUN LINKING. Today backfill builds the title list once before the run
 *      (backfill.ts:268), so an atom created during the run is invisible to every other capture
 *      in it. This counts the links that costs, using a corpus where each capture declares which
 *      EARLIER captures it belongs with.
 *
 *   2. CACHE VIABILITY. A shared per-chunk shortlist can be cached; a per-capture one cannot.
 *      Whether sharing is affordable depends on how much chronologically adjacent captures
 *      overlap. An earlier pass measured this on a deliberately diverse probe corpus and found
 *      unions saturating to the whole vault by ~40 captures — an adversarial floor, because that
 *      corpus was built to have no topical clustering. This re-measures it on dated captures
 *      that cluster the way a real life does.
 *
 * Usage:
 *   node scripts/measure-chrono-linking.mjs
 *   node scripts/measure-chrono-linking.mjs --k 400 --out docs/research/data/chrono.json
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, SELECTORS } from "./lib/shortlist.mjs";
import { buildPreRunVault, describePool, loadChronoCaptures } from "./lib/corpus.mjs";

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const K = Number(valueOf("k", "400"));
const CHUNKS = [1, 25, 50, 100, 200, 500, Infinity];

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

/** An atom's title is model-written; for recall the body dominates, so a stem stands in. */
const titleOf = (c) => `${c.id} ${c.capture.slice(0, 46).replace(/\s+\S*$/, "")}`;
const dayGap = (a, b) =>
  Math.round((Date.parse(a.date) - Date.parse(b.date)) / 86400000);

/** Links pointing at another atom in this same run — exactly what a frozen list cannot serve. */
const inRunPairs = [];
for (const c of atoms) {
  for (const target of c.linksToEarlier ?? []) {
    if (atomIds.has(target)) inRunPairs.push({ from: c.id, to: target, gap: dayGap(c, byId.get(target)) });
  }
}

/**
 * The vault as it stands when the catch-up starts. Must be large enough that k actually caps
 * something — a first pass used the 139-title corpus straight and every shortlist returned the
 * whole pool, so "recovered" tracked "reachable" exactly and measured nothing. Filler bodies are
 * capture-shaped (see lib/corpus.mjs) — an earlier version made them title-shaped, which skewed
 * BM25's length normalisation against the real atoms.
 */
const PRE_RUN_SIZE = Number(valueOf("pre-run", "1200"));
const PRE_RUN = buildPreRunVault({
  size: PRE_RUN_SIZE,
  hubTitles: [...new Set(captures.flatMap((c) => c.linksToExisting ?? []))],
  bodyPool: captures.map((c) => c.capture),
});

const gaps = inRunPairs.map((p) => p.gap).sort((a, b) => a - b);
console.log(
  `corpus: ${captures.length} captures (${atoms.length} atoms, ${captures.length - atoms.length} noise) ` +
    `over ${captures[0].date} → ${captures[captures.length - 1].date}`,
);
console.log(
  `in-run links: ${inRunPairs.length} · median gap ${gaps[Math.floor(gaps.length / 2)]} days · ` +
    `${gaps.filter((g) => g > 200).length} reach back over 200 days · longest ${gaps[gaps.length - 1]}\n`,
);
console.log(
  `Every one of those ${inRunPairs.length} links is unreachable today: the title list is frozen\n` +
    `before the run, so none of these atoms exist when the others are classified.\n`,
);

// ------------------------------------------------- 1. in-run linking by chunk

/**
 * Split the run into chunks. Counting captures does not compare across corpora — a chunk of 25
 * spans two years in a sparse corpus and a fortnight in a dense one, while link gaps are measured
 * in days. Calendar chunks are the honest unit: a one-month chunk means any link reaching back
 * more than a month is structurally reachable, whatever the capture density.
 */
function chunkByDays(days) {
  if (!Number.isFinite(days)) return [atoms];
  const out = [];
  let current = [];
  let edge = null;
  for (const c of atoms) {
    const t = Date.parse(c.date);
    if (edge === null) edge = t + days * 86400000;
    if (t >= edge) {
      if (current.length) out.push(current);
      current = [];
      while (t >= edge) edge += days * 86400000;
    }
    current.push(c);
  }
  if (current.length) out.push(current);
  return out;
}

function simulate(chunks, { perCapture }) {
  const filed = []; // atoms already written, available as context
  let reachable = 0, inShortlist = 0;
  let unionTotal = 0, unionGroups = 0;
  let written = 0;

  for (const chunk of chunks) {
    const start = written;
    const available = [...PRE_RUN, ...filed];

    // The shared list a cacheable design would send for the whole chunk.
    const perLists = chunk.map((c) => SELECTORS.bodyPlusTitle(c.capture, available, K));
    if (chunk.length > 1) {
      const u = new Set();
      for (const list of perLists) for (const n of list) u.add(n.title);
      unionTotal += u.size;
      unionGroups++;
    }
    const sharedTitles = new Set(perLists.flatMap((l) => l.map((n) => n.title)));

    chunk.forEach((c, i) => {
      for (const target of c.linksToEarlier ?? []) {
        if (!atomIds.has(target)) continue;
        // Was the target already written when this capture was classified?
        if (position.get(target) >= start) continue;
        reachable++;
        const titles = perCapture
          ? new Set(perLists[i].map((n) => n.title))
          : sharedTitles;
        if (titles.has(titleOf(byId.get(target)))) inShortlist++;
      }
    });

    for (const c of chunk) filed.push({ title: titleOf(c), ageDays: 1, body: c.capture });
    written += chunk.length;
  }

  return {
    reachable,
    inShortlist,
    reachableRate: +(reachable / inRunPairs.length).toFixed(3),
    recall: reachable ? +(inShortlist / inRunPairs.length).toFixed(3) : 0,
    avgUnion: unionGroups ? Math.round(unionTotal / unionGroups) : K,
    chunkCount: chunks.length,
    avgChunkSize: Math.round(atoms.length / chunks.length),
  };
}

console.log(describePool("pre-run vault", PRE_RUN));
console.log(`— in-run links recovered · shortlist k=${K} —`);
console.log(
  "chunk".padEnd(16) + "atoms/chunk".padStart(12) + "reachable".padStart(11) +
    "recovered".padStart(11) + "union".padStart(8) + "  cacheable?",
);

const PERIODS = [
  { label: "per capture", days: 0 },
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "1 quarter", days: 91 },
  { label: "6 months", days: 182 },
  { label: "1 year", days: 365 },
  { label: "whole run", days: Infinity },
];

const rows = [];
for (const p of PERIODS) {
  const chunks = p.days === 0 ? atoms.map((a) => [a]) : chunkByDays(p.days);
  const perCap = simulate(chunks, { perCapture: true });
  const shared = simulate(chunks, { perCapture: false });
  rows.push({ period: p.label, days: p.days, ...perCap, sharedRecall: shared.recall });
  console.log(
    p.label.padEnd(16) +
      String(perCap.avgChunkSize).padStart(12) +
      `${(perCap.reachableRate * 100).toFixed(0)}%`.padStart(11) +
      `${(perCap.recall * 100).toFixed(0)}%`.padStart(11) +
      String(perCap.avgUnion).padStart(8) +
      (p.days === 0
        ? "  no — prefix differs every capture"
        : !Number.isFinite(p.days)
          ? "  yes — one list all run"
          : `  yes, ${perCap.chunkCount} lists`),
  );
}

console.log(
  "\nreachable = the target atom had already been written when this capture was classified.\n" +
    "recovered = it was also in the shortlist. The gap between them is selector loss;\n" +
    "the gap between 'reachable' and 100% is what chunking costs structurally.",
);

const outPath = valueOf("out", "");
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({
    k: K, captures: captures.length, atoms: atoms.length, inRunLinks: inRunPairs.length,
    medianGapDays: gaps[Math.floor(gaps.length / 2)], rows,
  }, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(REPO_ROOT, abs)}`);
}
