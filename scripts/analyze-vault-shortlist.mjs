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
import { SELECTORS } from "./lib/shortlist.mjs";

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

  notes.push({ title, ageDays, body: capture });
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
