/**
 * Shared loading of the chronological corpus and construction of the pre-run vault.
 *
 * Extracted so the three chrono-based harnesses (measure-chrono-linking, measure-hop-distance,
 * measure-doc-expansion) cannot drift apart on what the vault they score against is made of.
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, hash01, loadRealTitles, tokens } from "./shortlist.mjs";

const FIXTURES = path.join(REPO_ROOT, "scripts/fixtures");

/** Every chrono-corpus capture, oldest first. */
export function loadChronoCaptures() {
  return fs
    .readdirSync(FIXTURES)
    .filter((f) => /^chrono-corpus-.*\.json$/.test(f))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")).captures ?? [])
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/**
 * The vault as it stands before the run: the pre-existing notes the corpus references, plus
 * filler up to `size` so that k actually caps something.
 *
 * FILLER BODIES MUST BE CAPTURE-SHAPED. An earlier version set each filler note's body to its own
 * title — three or four words — so two thirds of every scoring pool were near-empty documents.
 * BM25 divides each score by the pool's average document length, so that dragged the average down
 * and penalised the real atoms, which are five times longer, against it. Filler is meant to be
 * inert noise; noise of the wrong size silently reweights the measurement.
 *
 * Bodies are drawn from the corpus's own captures rather than invented. A filler note may
 * therefore repeat text that also belongs to a real atom — that is realistic (people restate
 * themselves) and it makes the measurement harder, not easier: the duplicate competes with the
 * gold target for rank while never being counted as a hit, since it carries a different title.
 */
export const FILLER_MODES = ["titleOnly", "mismatched", "coherent"];

export function buildPreRunVault({ size, hubTitles, bodyPool, mode = "coherent" }) {
  const real = loadRealTitles();
  const hubs = hubTitles.map((t) => ({ title: t, ageDays: 400, body: t }));
  const filler = Array.from({ length: Math.max(0, size - hubs.length) }, (_, i) => {
    const base = real[i % real.length];
    const realTitle = base + (i >= real.length ? ` ${Math.floor(i / real.length) + 1}` : "");
    if (mode === "titleOnly") return { title: realTitle, ageDays: 500 + i, body: base };
    const body = bodyPool.length ? bodyPool[Math.floor(hash01(realTitle) * bodyPool.length)] : base;
    // `mismatched` keeps a real atom title but gives it an unrelated capture as its body, so the
    // note covers two topics and matches more queries than any single-topic atom would. `coherent`
    // derives the title from the body, the way a filed atom actually reads.
    const title =
      mode === "coherent"
        ? `${body.slice(0, 46).replace(/\s+\S*$/, "")} · ${i}`
        : realTitle;
    return { title, ageDays: 500 + i, body };
  });
  return [...hubs, ...filler];
}

/**
 * Token-length distribution of a pool, printed by each harness. The flaw above went unnoticed
 * because nothing ever reported what the pool was made of — so now every run says.
 */
export function poolShape(notes, field = (n) => `${n.title} ${n.body ?? ""}`) {
  const lens = notes.map((n) => tokens(field(n)).length).sort((a, b) => a - b);
  const mean = lens.reduce((s, x) => s + x, 0) / (lens.length || 1);
  return {
    n: lens.length,
    mean: +mean.toFixed(1),
    median: lens[Math.floor(lens.length / 2)] ?? 0,
    p10: lens[Math.floor(lens.length * 0.1)] ?? 0,
    p90: lens[Math.floor(lens.length * 0.9)] ?? 0,
  };
}

export function describePool(label, notes) {
  const s = poolShape(notes);
  return `${label}: ${s.n} notes · tokens per note mean ${s.mean}, median ${s.median} (p10 ${s.p10}, p90 ${s.p90})`;
}
