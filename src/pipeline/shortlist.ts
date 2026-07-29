/**
 * BM25 shortlist scoring — the retrieval core behind the `ContextProvider` seam.
 *
 * This is a **port**, not a reimplementation (KTD5). Every retrieval finding on this branch was
 * measured with the research harness, so the behaviour here is deliberately identical to it:
 *
 * - `tokens()` is `scripts/lib/shortlist.mjs`.
 * - `bm25Rank()` is the BM25F `rank()` in `scripts/measure-doc-expansion.mjs`, at the `linksHeavy`
 *   weights that measurement selected (title 1, body 1, links ×3 — KTD1).
 *
 * Pure by design: no Obsidian imports, so it is testable without a vault and reusable by the
 * research scripts. Building the scoreable corpus from the vault is U2's job, not this layer's.
 */

/**
 * Stopwords, verbatim from the research harness. Deliberately short — the crude stemmer below
 * does most of the work, and an aggressive list costs recall on captures written in shorthand.
 */
const STOP = new Set(
  ("a an the and or but if then than that this these those is are was were be been being am " +
    "i me my mine you your we our us they them their it its of in on at to for from with without " +
    "about into over under again more most some any no not just so very can could should would " +
    "will shall do does did done get got getting have has had having when while as by up down out " +
    "off after before during too also still even much many").split(" "),
);

/**
 * Tokenise a capture or a note field: lowercase, split on non-alphanumerics (apostrophes survive),
 * strip possessives, stem crudely, then drop stopwords and words of two characters or fewer.
 *
 * The stemmer is the harness's and is knowingly imperfect — it strips a suffix only when at least
 * three characters would remain, so `runs` and `run` join but `running` becomes `runn`, not `run`.
 * Ported as-is: the recall numbers this plan acts on were measured with exactly this behaviour.
 */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9']+/g) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    .map((w) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? "" : m)))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The four separately-weighable fields of a scoreable note. */
export type ScoreField = "title" | "body" | "tags" | "links";

/**
 * A candidate note, as U2 assembles it from the vault. Only `title` is required, so a note with no
 * body — a stub, or a hub that is all links — still scores on the fields it has. A note that could
 * not be *read* at all is a different case: U2 drops it rather than offering the model a link
 * target that may no longer exist.
 */
export interface ScoreableNote {
  title: string;
  body?: string;
  tags?: string[];
  /** The model's own reason-bearing link prose — its paraphrase of the note, indexed for free. */
  links?: string[];
}

export type FieldWeights = Record<ScoreField, number>;

/**
 * The measured weights (KTD1). Link prose carries ×3 because it is the model's paraphrase of the
 * note, so it supplies vocabulary the user's own capture happened not to use — the only lever that
 * moves a target off an absolute zero, which widening `k` cannot.
 */
export const FIELD_WEIGHTS: FieldWeights = { title: 1, body: 1, tags: 1, links: 3 };

/** BM25 term-frequency saturation constant, from the harness. */
const K1 = 1.2;

/** BM25 length-normalisation constant, from the harness. */
const B = 0.75;

/** A candidate with the score it earned against one capture. */
export type Scored<T> = T & { score: number };

function fieldTokens(note: ScoreableNote, field: ScoreField): string[] {
  switch (field) {
    case "title":
      return tokens(note.title);
    case "body":
      return tokens(note.body ?? "");
    case "tags":
      return tokens((note.tags ?? []).join(" "));
    case "links":
      return tokens((note.links ?? []).join(" "));
  }
}

/**
 * Rank every candidate against `capture`, highest score first, ties broken alphabetically by title.
 *
 * BM25F: per-field length normalisation, with the field weight applied to term frequency **before**
 * saturation. Weighting after saturation — i.e. summing per-field BM25 scores — double-counts a
 * term that appears in two fields, which is exactly the case field weighting exists to handle.
 *
 * A candidate sharing no term with the capture scores **exactly zero**. That is load-bearing, not
 * incidental: a miss here is absolute, so downstream code may treat zero as "not a candidate".
 */
export function bm25Rank<T extends ScoreableNote>(
  capture: string,
  notes: readonly T[],
  weights: FieldWeights = FIELD_WEIGHTS,
): Scored<T>[] {
  const fields = (Object.keys(weights) as ScoreField[]).filter((f) => weights[f] > 0);
  const N = notes.length;
  const docs = notes.map((n) => {
    const doc = {} as Record<ScoreField, string[]>;
    for (const f of fields) doc[f] = fieldTokens(n, f);
    return doc;
  });

  const avg = {} as Record<ScoreField, number>;
  for (const f of fields) {
    avg[f] = docs.reduce((s, d) => s + d[f].length, 0) / (N || 1) || 1;
  }

  // Weighted term frequency per doc, plus the document frequency of each term across the corpus.
  const df = new Map<string, number>();
  const tfs = docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const f of fields) {
      const counts = new Map<string, number>();
      for (const t of doc[f]) counts.set(t, (counts.get(t) ?? 0) + 1);
      const norm = 1 - B + (B * doc[f].length) / avg[f];
      for (const [t, c] of counts) tf.set(t, (tf.get(t) ?? 0) + (weights[f] * c) / norm);
    }
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return tf;
  });

  const q = [...new Set(tokens(capture))];
  return notes
    .map((n, i) => {
      let score = 0;
      for (const t of q) {
        const tf = tfs[i]!.get(t);
        if (!tf) continue;
        const n_t = df.get(t) ?? 0;
        score += Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5)) * (tf / (K1 + tf));
      }
      return { ...n, score };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/**
 * The top `k` candidates that actually share a term with the capture.
 *
 * Zero-scoring candidates are dropped rather than padded in: a zero is an absolute miss, and
 * passing misses to the model as if they were weak matches only spends prompt on noise. A capture
 * that matches nothing yields an empty shortlist.
 */
export function rankShortlist<T extends ScoreableNote>(
  capture: string,
  notes: readonly T[],
  k: number,
  weights: FieldWeights = FIELD_WEIGHTS,
): Scored<T>[] {
  if (k <= 0) return [];
  return bm25Rank(capture, notes, weights)
    .filter((n) => n.score > 0)
    .slice(0, k);
}
