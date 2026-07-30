#!/usr/bin/env node
/**
 * Selector sweep — can a capped title context still surface the note a capture belongs with?
 *
 * The free half of docs/plans/2026-07-28-004-research-shortlist-quality-experiment.md.
 * No API calls: this measures only whether the planted target note appears in the shortlist a
 * selector would send. A selector that cannot surface the target cannot possibly link it, so
 * recall here is a hard ceiling on what any model could do downstream.
 *
 * Usage:
 *   npm run measure:recall
 *   npm run measure:recall -- --out docs/research/data/shortlist-recall.json
 *   npm run measure:recall -- --misses hybrid:400:1200   # list what one config lost
 */
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  SELECTORS,
  buildVault as buildVaultRaw,
  loadProbes,
  loadRealTitles,
} from "./lib/shortlist.mjs";


const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const VAULT_SIZES = [200, 1200, 3000, 5000];
const KS = [40, 100, 200, 400, 800];

// ------------------------------------------------------------------- corpus

const probes = loadProbes();
if (!probes.length) {
  console.error("No probes found in scripts/fixtures/link-probes-*.json");
  process.exit(1);
}
const realTitles = loadRealTitles();
const buildVault = (probe, size) => buildVaultRaw(probe, size, probes, realTitles);

// --------------------------------------------------------------------- run

const rows = [];
const missDetail = [];

for (const size of VAULT_SIZES) {
  for (const [name, fn] of Object.entries(SELECTORS)) {
    for (const k of name === "full" ? [Infinity] : KS) {
      if (Number.isFinite(k) && k >= size) continue; // a cap above vault size is just `full`
      let hits = 0, applicable = 0, rankSum = 0;
      const byMode = new Map();

      for (const probe of probes) {
        if (!probe.targetTitle) continue; // cold-start probes have no target to recall
        applicable++;
        const notes = buildVault(probe, size);
        const shortlist = fn(probe.capture, notes, k);
        const idx = shortlist.findIndex((n) => n.title === probe.targetTitle);
        const hit = idx >= 0;
        if (hit) { hits++; rankSum += idx + 1; }
        const m = byMode.get(probe.failureMode) ?? { hit: 0, n: 0 };
        m.n++; if (hit) m.hit++;
        byMode.set(probe.failureMode, m);
        if (!hit) missDetail.push({ selector: name, k, size, id: probe.id, mode: probe.failureMode });
      }

      rows.push({
        selector: name,
        k: Number.isFinite(k) ? k : "full",
        vaultSize: size,
        recall: +(hits / applicable).toFixed(3),
        meanRankWhenFound: hits ? +(rankSum / hits).toFixed(1) : null,
        byMode: Object.fromEntries(
          [...byMode.entries()].sort((a, b) => a[0] - b[0])
            .map(([mode, v]) => [mode, +(v.hit / v.n).toFixed(2)]),
        ),
      });
    }
  }
}

// ------------------------------------------------------------------ report

const applicable = probes.filter((p) => p.targetTitle).length;
console.log(
  `[recall] ${probes.length} probes (${applicable} with a target) · ` +
    `vault sizes ${VAULT_SIZES.join("/")} · k ${KS.join("/")}\n`,
);

for (const size of VAULT_SIZES) {
  console.log(`— vault ${size} notes —`);
  const header = ["selector".padEnd(12), ...KS.map((k) => String(k).padStart(6)), "  full"].join("");
  console.log(header);
  for (const name of Object.keys(SELECTORS)) {
    if (name === "full") continue;
    const cells = KS.map((k) => {
      const r = rows.find((x) => x.selector === name && x.k === k && x.vaultSize === size);
      return (r ? (r.recall * 100).toFixed(0) + "%" : "—").padStart(6);
    });
    console.log(name.padEnd(12) + cells.join(""));
  }
  const f = rows.find((x) => x.selector === "full" && x.vaultSize === size);
  console.log("full".padEnd(12) + " ".repeat(6 * KS.length) + `  ${(f.recall * 100).toFixed(0)}%\n`);
}

// The two modes the owner named as make-or-break.
console.log("— recall on the modes that matter most, at vault 3000 —");
console.log("selector/k".padEnd(18), "mode 1 (year-ago)".padStart(18), "mode 6 (supersession)".padStart(22));
for (const name of Object.keys(SELECTORS)) {
  for (const k of name === "full" ? ["full"] : KS) {
    const r = rows.find((x) => x.selector === name && x.k === k && x.vaultSize === 3000);
    if (!r) continue;
    console.log(
      `${name}:${k}`.padEnd(18),
      String(r.byMode[1] ?? "—").padStart(18),
      String(r.byMode[6] ?? "—").padStart(22),
    );
  }
}

const outPath = valueOf("out", "");
if (outPath) {
  const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO_ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({ probes: probes.length, applicable, rows }, null, 2) + "\n");
  console.log(`\n[recall] wrote ${path.relative(REPO_ROOT, abs)}`);
}

const missSpec = valueOf("misses", "");
if (missSpec) {
  const [sel, k, size] = missSpec.split(":");
  const lost = missDetail.filter(
    (m) => m.selector === sel && String(m.k) === k && String(m.size) === size,
  );
  console.log(`\n— ${sel} k=${k} vault=${size} lost ${lost.length} probes —`);
  for (const m of lost) {
    const p = probes.find((x) => x.id === m.id);
    console.log(`  ${m.id} (mode ${m.mode}) "${p.capture.slice(0, 60)}" → "${p.targetTitle}"`);
  }
}
