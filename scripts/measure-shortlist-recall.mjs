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
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURES = path.join(REPO_ROOT, "scripts/fixtures");

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

const probes = fs
  .readdirSync(FIXTURES)
  .filter((f) => /^link-probes-.*\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")).probes ?? []);

if (!probes.length) {
  console.error(`No probes found in ${FIXTURES}/link-probes-*.json`);
  process.exit(1);
}

const realTitles = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, "vault-title-corpus.json"), "utf8"),
).allTitles;

/** Deterministic pseudo-random in [0,1) from a string — keeps runs reproducible. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Build one probe's vault: its target, its supporting notes, every other probe's titles as
 * same-style distractors, then the real corpus cycled up to size.
 *
 * Other probes' titles are the good distractors — they are the same shape and register as the
 * target, so a selector cannot win by preferring "note-shaped" strings.
 */
function buildVault(probe, size) {
  const seen = new Set();
  const notes = [];
  // Every note gets a capture-style body, not just the target — otherwise a body-scoring
  // selector would win trivially by being the only thing with text to match against.
  // Bodies are drawn from the other probes' real bodies so length and register match.
  const bodyPool = probes
    .filter((p) => p.id !== probe.id && p.targetBody)
    .map((p) => p.targetBody);
  const filler = (title, i) =>
    bodyPool.length ? bodyPool[Math.floor(hash01(title + i) * bodyPool.length)] : "";

  const add = (title, ageDays, body) => {
    if (!title || seen.has(title)) return;
    seen.add(title);
    notes.push({ title, ageDays, body: body ?? filler(title, notes.length) });
  };

  if (probe.targetTitle) add(probe.targetTitle, probe.targetAgeDays ?? 30, probe.targetBody ?? "");
  for (const t of probe.supportingTitles ?? []) {
    add(t, Math.round(hash01(t) * 900) + 1);
  }
  for (const other of probes) {
    if (other.id === probe.id) continue;
    add(other.targetTitle, Math.round(hash01(other.id + "t") * 900) + 1, other.targetBody);
    for (const t of other.supportingTitles ?? []) {
      add(t, Math.round(hash01(t) * 900) + 1);
    }
  }
  for (let i = 0; notes.length < size; i++) {
    const base = realTitles[i % realTitles.length];
    // Cycle the real corpus; distinct ages keep the recency selector meaningful.
    add(`${base}${i >= realTitles.length ? ` ${Math.floor(i / realTitles.length) + 1}` : ""}`,
      Math.round(hash01(base + i) * 1100) + 1);
  }
  return notes.slice(0, Math.max(size, 1));
}

// ---------------------------------------------------------------- selectors

const STOP = new Set(
  ("a an the and or but if then than that this these those is are was were be been being am " +
   "i me my mine you your we our us they them their it its of in on at to for from with without " +
   "about into over under again more most some any no not just so very can could should would " +
   "will shall do does did done get got getting have has had having when while as by up down out " +
   "off after before during too also still even much many").split(" "),
);

function tokens(s) {
  return (s.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    // Crude stemming: enough to join "runs"/"running"/"run" without a stemmer dependency.
    .map((w) => w.replace(/(ing|ed|es|s)$/, (m, _g, o) => (w.length - m.length >= 3 ? "" : m)))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** A title that looks like a person hub: one to three capitalised words, no lowercase glue. */
function isPersonHub(title) {
  const w = title.trim().split(/\s+/);
  return w.length <= 3 && w.every((x) => /^[A-Z][a-zà-ÿA-Z'’-]*$/.test(x));
}

/**
 * BM25 — the shortlist stage `context.ts` already contemplates.
 *
 * `field` picks what each note is scored on. Titles are the model's polished declarative claim;
 * bodies are the user's own verbatim capture. Matching a user's words against their own past
 * words is a different, and much easier, problem than matching them against a paraphrase.
 * Either way only the *title* is ever sent in the prompt, so the cost model is unaffected.
 */
function bm25Rank(capture, notes, field = "title") {
  const q = tokens(capture);
  const docs = notes.map((n) =>
    tokens(field === "title" ? n.title : field === "body" ? n.body ?? "" : `${n.title} ${n.body ?? ""}`),
  );
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.2, b = 0.75;
  return notes
    .map((n, i) => {
      let score = 0;
      const d = docs[i];
      for (const t of new Set(q)) {
        const f = d.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl)));
      }
      return { ...n, score };
    })
    .sort((a, b2) => b2.score - a.score || a.title.localeCompare(b2.title));
}

const SELECTORS = {
  /** The behaviour plus-service ships today: alphabetical, first k. The control to beat. */
  alphabetical: (capture, notes, k) =>
    [...notes].sort((a, b) => a.title.localeCompare(b.title)).slice(0, k),

  /** Cheapest plausible selector, and the one the owner's year-ago case is aimed at. */
  recency: (capture, notes, k) => [...notes].sort((a, b) => a.ageDays - b.ageDays).slice(0, k),

  keyword: (capture, notes, k) => bm25Rank(capture, notes, "title").slice(0, k),

  /** Score the user's words against their own past words; still send only titles. */
  bodyKeyword: (capture, notes, k) => bm25Rank(capture, notes, "body").slice(0, k),

  bodyPlusTitle: (capture, notes, k) => bm25Rank(capture, notes, "both").slice(0, k),

  /** Body-scored, with person hubs protected and a recency quota for what's top of mind. */
  hybridBody: (capture, notes, k) => {
    const out = [];
    const taken = new Set();
    const take = (list, n) => {
      for (const item of list) {
        if (out.length >= k || n <= 0) break;
        if (taken.has(item.title)) continue;
        taken.add(item.title);
        out.push(item);
        n--;
      }
    };
    take(notes.filter((n) => isPersonHub(n.title)), Math.ceil(k * 0.1));
    take(bm25Rank(capture, notes, "both"), Math.ceil(k * 0.7));
    take([...notes].sort((a, b) => a.ageDays - b.ageDays), Math.ceil(k * 0.2));
    take(bm25Rank(capture, notes, "both"), k);
    return out.slice(0, k);
  },

  /** Person hubs always survive, then keyword fills the rest. */
  personFirst: (capture, notes, k) => {
    const hubs = notes.filter((n) => isPersonHub(n.title));
    const rest = bm25Rank(capture, notes.filter((n) => !isPersonHub(n.title)));
    return [...hubs.slice(0, Math.floor(k / 4)), ...rest].slice(0, k);
  },

  /**
   * Quota'd union — keyword carries most of the budget, recency covers what the user is
   * currently thinking about, person hubs are never dropped. Expected to ship.
   */
  hybrid: (capture, notes, k) => {
    const out = [];
    const taken = new Set();
    const take = (list, n) => {
      for (const item of list) {
        if (out.length >= k || n <= 0) break;
        if (taken.has(item.title)) continue;
        taken.add(item.title);
        out.push(item);
        n--;
      }
    };
    take(notes.filter((n) => isPersonHub(n.title)), Math.ceil(k * 0.1));
    take(bm25Rank(capture, notes), Math.ceil(k * 0.65));
    take([...notes].sort((a, b) => a.ageDays - b.ageDays), Math.ceil(k * 0.25));
    take(bm25Rank(capture, notes), k); // top up with keyword if a quota underfilled
    return out.slice(0, k);
  },

  /** Uncapped — the ceiling, and what BYOK backfill does today. */
  full: (capture, notes) => notes,
};

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
