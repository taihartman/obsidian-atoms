#!/usr/bin/env node
/**
 * Run the shortlist selectors against a real vault, using its existing atom links as ground truth.
 *
 * The synthetic experiment (docs/plans/2026-07-28-004-…) plants targets. This one does not need to:
 * an atom's body is the user's verbatim capture and its link prose names the notes that capture
 * was judged to belong with. So "did the selector surface the notes this atom actually links to"
 * is a real recall question with a real answer.
 *
 * READ-ONLY BY CONSTRUCTION. Opens no network connection and never writes to the vault — it
 * imports no HTTP client and the only fs write is the optional --out report. Safe to point at a
 * personal vault; no capture text leaves the machine.
 *
 * Usage:
 *   node scripts/analyze-vault-shortlist.mjs --vault "$HOME/Documents/Remote Vault"
 *   node scripts/analyze-vault-shortlist.mjs --vault … --examples 3 --out report.json
 */
import fs from "node:fs";
import path from "node:path";
import { SELECTORS, bm25Rank } from "./lib/shortlist.mjs";

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const vaultPath = valueOf("vault", "");
if (!vaultPath) {
  console.error('Pass --vault "/path/to/vault". Nothing is written; this only reads.');
  process.exit(1);
}
const atomsDir = valueOf("atoms-folder", "Atoms");
const showExamples = Number(valueOf("examples", "0"));
/**
 * Index only the first N characters of each body. Index memory scales with indexed text, and at
 * 3,000 notes the full-body index is ~24MB — real pressure inside a mobile webview. If recall
 * holds on a prefix, the memory problem goes away. 0 = no truncation.
 */
const bodyChars = Number(valueOf("body-chars", "0"));

// -------------------------------------------------------------------- read

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue; // .obsidian, .trash
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const files = walk(vaultPath);
const atomsPrefix = path.join(vaultPath, atomsDir) + path.sep;

/** Strip YAML frontmatter; return the rest. */
function stripFrontmatter(text) {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end < 0 ? text : text.slice(text.indexOf("\n", end + 1) + 1);
}

/**
 * An atom file is `verbatim capture` + blank line + `link prose` (render.ts formatAtomBody).
 * Split on the first blank line: everything before it is the user's own words.
 */
function splitAtom(body) {
  const m = body.match(/^([\s\S]*?)\n\n([\s\S]+)$/);
  return m ? { capture: m[1].trim(), tail: m[2] } : { capture: body.trim(), tail: "" };
}

const notes = [];
const atoms = [];
const mtimeNow = Date.now();

// Sync placeholders list in readdir but cannot be opened; count them rather than dying.
const unreadable = [];

for (const f of files) {
  const title = path.basename(f, ".md");
  let raw, stat;
  try {
    raw = fs.readFileSync(f, "utf8");
    stat = fs.statSync(f);
  } catch {
    unreadable.push(title);
    continue;
  }
  const ageDays = Math.max(1, Math.round((mtimeNow - stat.mtimeMs) / 86400000));
  const isAtom = f.startsWith(atomsPrefix);
  const { capture, tail } = isAtom
    ? splitAtom(stripFrontmatter(raw))
    : { capture: stripFrontmatter(raw).slice(0, 2000), tail: "" };

  notes.push({ title, ageDays, body: bodyChars ? capture.slice(0, bodyChars) : capture });
  if (isAtom) {
    const links = [...tail.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
    atoms.push({ title, capture, links: [...new Set(links)] });
  }
}

const titleSet = new Set(notes.map((n) => n.title));

// Ground truth = links that actually resolve to a note in this vault.
const graded = atoms
  .map((a) => ({ ...a, targets: a.links.filter((l) => l !== a.title && titleSet.has(l)) }))
  .filter((a) => a.targets.length && a.capture);

// ------------------------------------------------------------------ report

console.log(`vault: ${notes.length} notes · ${atoms.length} atoms · ${graded.length} atoms with resolvable links`);
if (unreadable.length) {
  console.log(`note: ${unreadable.length} file(s) listed but could not be opened (sync placeholders), skipped`);
}
const unresolved = atoms.flatMap((a) => a.links).filter((l) => !titleSet.has(l)).length;
console.log(`links: ${atoms.reduce((s, a) => s + a.links.length, 0)} total, ${unresolved} pointing at notes that do not exist`);

const fullTokens = Math.round(3507 + notes.length * 16.47);
console.log(
  `\nprompt today: all ${notes.length} titles = ~${fullTokens} input tokens per classify ` +
    `(~${((fullTokens * 3) / 1e6 * 100).toFixed(2)}¢ cold, ~${((fullTokens * 0.3) / 1e6 * 100).toFixed(2)}¢ warm)`,
);
const bodyBytes = notes.length * 90 + 9000; // context + messagesRequest, see research doc §0.6
console.log(
  `plus proxy: body ~${bodyBytes.toLocaleString()} bytes vs the 100,000 limit — ` +
    (bodyBytes > 100000 ? "OVER, every Plus filing 400s" : `ok, ${Math.round((100000 - bodyBytes) / 90)} notes of headroom`),
);
console.log(
  `plus context: sends the alphabetically-first 40 of ${notes.length} titles ` +
    `— ${(100 - (40 / notes.length) * 100).toFixed(0)}% of this vault is invisible to Plus filing today`,
);

if (!graded.length) {
  console.log("\nNo atoms with resolvable links — nothing to score.");
  process.exit(0);
}

const KS = [40, 100, 200, 400];
const CONFIGS = ["alphabetical", "recency", "keyword", "bodyPlusTitle", "hybridBody"];

console.log(`\n— recall of each atom's real links, ${graded.length} atoms, ${graded.reduce((s, a) => s + a.targets.length, 0)} links —`);
console.log("selector".padEnd(16) + KS.map((k) => String(k).padStart(7)).join(""));

const rows = [];
for (const name of CONFIGS) {
  const cells = KS.map((k) => {
    let found = 0, total = 0;
    for (const atom of graded) {
      // The atom itself is excluded: we are asking what its capture could have found.
      const candidates = notes.filter((n) => n.title !== atom.title);
      const shortlist = SELECTORS[name](atom.capture, candidates, k);
      const inList = new Set(shortlist.map((n) => n.title));
      for (const t of atom.targets) {
        total++;
        if (inList.has(t)) found++;
      }
    }
    rows.push({ selector: name, k, recall: +(found / total).toFixed(3), found, total });
    return `${((found / total) * 100).toFixed(0)}%`.padStart(7);
  });
  console.log(name.padEnd(16) + cells.join(""));
}

if (showExamples) {
  console.log(`\n— what alphabetical-40 loses that bodyPlusTitle-40 finds (first ${showExamples}) —`);
  let shown = 0;
  for (const atom of graded) {
    if (shown >= showExamples) break;
    const candidates = notes.filter((n) => n.title !== atom.title);
    const alpha = new Set(SELECTORS.alphabetical(atom.capture, candidates, 40).map((n) => n.title));
    const body = new Set(SELECTORS.bodyPlusTitle(atom.capture, candidates, 40).map((n) => n.title));
    const rescued = atom.targets.filter((t) => !alpha.has(t) && body.has(t));
    if (!rescued.length) continue;
    shown++;
    console.log(`\n  atom: "${atom.title}"`);
    console.log(`  capture: "${atom.capture.replace(/\s+/g, " ").slice(0, 90)}…"`);
    console.log(`  link found by body scoring, missed by alphabetical: ${rescued.map((r) => `"${r}"`).join(", ")}`);
  }
}

// ------------------------------------------------------- hop distance (--hops)

/**
 * Can a graph expansion reach the links body-scored BM25 misses, on a REAL link graph?
 *
 * Non-circular by construction: when atom A is under test, every edge A owns is removed from the
 * graph. A does not exist yet at classify time, so none of its links may inform its own retrieval.
 *
 * "Hub" is measured, not guessed: the top `--hub-pct` of nodes by degree. A hub touches everything,
 * so a path through one says the hub exists, not that the two notes are related — which is why the
 * hub-blocked row is the one to believe.
 */
if (argv.includes("--hops")) {
  const SEEDS = Number(valueOf("seeds", "10"));
  const HUB_PCT = Number(valueOf("hub-pct", "5"));

  const degree = new Map();
  const bump = (t) => degree.set(t, (degree.get(t) ?? 0) + 1);
  for (const a of atoms) for (const l of a.targets ?? a.links) if (titleSet.has(l)) { bump(a.title); bump(l); }
  const degrees = [...degree.values()].sort((x, y) => y - x);
  const hubCut = degrees[Math.floor((degrees.length * HUB_PCT) / 100)] ?? Infinity;
  const isHub = (t) => (degree.get(t) ?? 0) >= hubCut;

  const buildGraph = (excludeAtom) => {
    const g = new Map();
    const edge = (a, b) => {
      if (!g.has(a)) g.set(a, new Set());
      if (!g.has(b)) g.set(b, new Set());
      g.get(a).add(b);
      g.get(b).add(a);
    };
    for (const a of atoms) {
      if (a.title === excludeAtom) continue; // the note being classified does not exist yet
      for (const l of a.links) if (titleSet.has(l) && l !== a.title) edge(a.title, l);
    }
    return g;
  };

  const hopDistance = (g, seeds, target, blockHubs) => {
    const seen = new Set();
    let frontier = [];
    for (const s of seeds) {
      if (s === target) return 0;
      if (g.has(s) && !seen.has(s)) { seen.add(s); frontier.push(s); }
    }
    for (let d = 1; d <= 4 && frontier.length; d++) {
      const next = [];
      for (const node of frontier) {
        if (blockHubs && isHub(node)) continue;
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
  };

  const buckets = {
    traversable: { ranked: new Map(), zeroScore: new Map() },
    blocked: { ranked: new Map(), zeroScore: new Map() },
  };
  const counts = { inSeeds: 0, ranked: 0, zeroScore: 0 };
  const add = (m, d) => m.set(d, (m.get(d) ?? 0) + 1);

  for (const atom of graded) {
    const candidates = notes.filter((n) => n.title !== atom.title);
    const ranked = bm25Rank(atom.capture, candidates, "both");
    const rankOf = new Map(ranked.map((n, i) => [n.title, i]));
    const scoreOf = new Map(ranked.map((n) => [n.title, n.score]));
    const seeds = ranked.slice(0, SEEDS).map((n) => n.title);
    const g = buildGraph(atom.title);

    for (const t of atom.targets) {
      const rank = rankOf.get(t) ?? Infinity;
      if (rank < SEEDS) { counts.inSeeds++; continue; }
      const pop = (scoreOf.get(t) ?? 0) > 0 ? "ranked" : "zeroScore";
      counts[pop]++;
      add(buckets.traversable[pop], hopDistance(g, seeds, t, false));
      add(buckets.blocked[pop], hopDistance(g, seeds, t, true));
    }
  }

  const totalLinks = counts.inSeeds + counts.ranked + counts.zeroScore;
  const p = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
  console.log(
    `\n— hop distance · seeds = bodyPlusTitle top ${SEEDS} · hub = degree ≥ ${hubCut} (top ${HUB_PCT}%) —`,
  );
  console.log(
    `${totalLinks} links: ${counts.inSeeds} (${p(counts.inSeeds, totalLinks)}) already in the seeds, ` +
      `${counts.ranked} (${p(counts.ranked, totalLinks)}) scored but ranked below, ` +
      `${counts.zeroScore} (${p(counts.zeroScore, totalLinks)}) zero score`,
  );
  console.log("graph".padEnd(14) + "population".padEnd(12) + "n".padStart(6) + "1 hop".padStart(9) +
    "2 hops".padStart(9) + "≤2 hops".padStart(10) + "unreachable".padStart(13));
  for (const [gname, gset] of Object.entries(buckets)) {
    for (const [pop, m] of Object.entries(gset)) {
      const n = counts[pop];
      const h = (d) => m.get(d) ?? 0;
      console.log(
        gname.padEnd(14) + pop.padEnd(12) + String(n).padStart(6) + p(h(1), n).padStart(9) +
          p(h(2), n).padStart(9) + p(h(1) + h(2), n).padStart(10) +
          p(m.get(Infinity) ?? 0, n).padStart(13),
      );
    }
  }
}

const outPath = valueOf("out", "");
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  // Aggregates only — no capture text, no titles, nothing personal leaves this machine.
  fs.writeFileSync(
    path.resolve(outPath),
    JSON.stringify(
      { noteCount: notes.length, atomCount: atoms.length, gradedAtoms: graded.length,
        linkCount: graded.reduce((s, a) => s + a.targets.length, 0), fullTokens, rows },
      null, 2,
    ) + "\n",
  );
  console.log(`\nwrote ${outPath} (aggregate counts only, no vault content)`);
}
