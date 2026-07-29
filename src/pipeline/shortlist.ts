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
 * The corpus-invariant half of BM25F, held so it is paid once per run instead of once per capture.
 *
 * Tokenising every note's four fields, and the term/document frequencies over them, depend only on
 * the corpus — never on the capture. Rebuilding them per capture is what KTD4 promises not to do:
 * only `tokens(capture)` and the scoring loop belong in the per-capture path.
 *
 * **Appendable** (KTD4a): an atom written mid-run must be scoreable by the captures that follow it,
 * so `add()` extends the index in place. Extension is exact rather than approximate — document
 * frequency is a plain per-term count, and the field-length averages are re-derived at rank time
 * from running sums, so the scores after an append are the scores a full rebuild would produce.
 * `test/shortlist.test.ts` pins that equivalence.
 *
 * What is deliberately *not* precomputed is the weighted term frequency. It divides by the field's
 * average length, which every append moves, so a cached `tf` would be the one quantity that could
 * silently go stale. Raw per-field counts are stored instead and the normalisation is applied while
 * scoring, in the same field order the one-shot path used, so the arithmetic is bit-identical.
 */
export class Bm25Index<T extends ScoreableNote> {
  private readonly fields: ScoreField[];
  private readonly notes: T[] = [];
  /** Per doc: term → its raw count in each field, indexed parallel to `fields`. */
  private readonly termCounts: Array<Map<string, number[]>> = [];
  /** Per doc: token count of each field, indexed parallel to `fields`. */
  private readonly fieldLengths: number[][] = [];
  /** Running total of each field's length across the corpus — the numerator of `avg`. */
  private readonly lengthSums: number[];
  /** Documents containing each term in any weighted field. Unaffected by corpus size. */
  private readonly df = new Map<string, number>();

  constructor(
    notes: readonly T[] = [],
    private readonly weights: FieldWeights = FIELD_WEIGHTS,
  ) {
    this.fields = (Object.keys(weights) as ScoreField[]).filter((f) => weights[f] > 0);
    this.lengthSums = this.fields.map(() => 0);
    for (const n of notes) this.add(n);
  }

  /** Scoreable entries currently indexed. */
  get size(): number {
    return this.notes.length;
  }

  /** Index one more note. Cheap: it tokenises that note's fields and nothing else's. */
  add(note: T): void {
    const counts = new Map<string, number[]>();
    const lengths: number[] = [];
    this.fields.forEach((f, fi) => {
      const toks = fieldTokens(note, f);
      lengths.push(toks.length);
      this.lengthSums[fi]! += toks.length;
      for (const t of toks) {
        let perField = counts.get(t);
        if (!perField) {
          perField = this.fields.map(() => 0);
          counts.set(t, perField);
        }
        perField[fi]! += 1;
      }
    });
    for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.notes.push(note);
    this.termCounts.push(counts);
    this.fieldLengths.push(lengths);
  }

  /**
   * Rank every indexed note against `capture`, highest score first, ties broken alphabetically.
   *
   * BM25F: per-field length normalisation, with the field weight applied to term frequency **before**
   * saturation. Weighting after saturation — i.e. summing per-field BM25 scores — double-counts a
   * term that appears in two fields, which is exactly the case field weighting exists to handle.
   *
   * A candidate sharing no term with the capture scores **exactly zero**. That is load-bearing, not
   * incidental: a miss here is absolute, so downstream code may treat zero as "not a candidate".
   */
  rank(capture: string): Scored<T>[] {
    const N = this.notes.length;
    const avg = this.lengthSums.map((sum) => sum / (N || 1) || 1);
    const q = [...new Set(tokens(capture))];
    return this.notes
      .map((n, i) => {
        const counts = this.termCounts[i]!;
        const lengths = this.fieldLengths[i]!;
        let score = 0;
        for (const t of q) {
          const perField = counts.get(t);
          if (!perField) continue;
          let tf = 0;
          for (let fi = 0; fi < this.fields.length; fi++) {
            const c = perField[fi]!;
            if (!c) continue;
            const norm = 1 - B + (B * lengths[fi]!) / avg[fi]!;
            tf += (this.weights[this.fields[fi]!] * c) / norm;
          }
          const n_t = this.df.get(t) ?? 0;
          score += Math.log(1 + (N - n_t + 0.5) / (n_t + 0.5)) * (tf / (K1 + tf));
        }
        return { ...n, score };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }
}

/**
 * Rank every candidate against `capture` — the one-shot form, for callers holding a plain list.
 *
 * A run should build a {@link Bm25Index} once instead: this rebuilds the whole corpus index on
 * every call, which is exactly the per-capture cost KTD4 exists to avoid.
 */
export function bm25Rank<T extends ScoreableNote>(
  capture: string,
  notes: readonly T[],
  weights: FieldWeights = FIELD_WEIGHTS,
): Scored<T>[] {
  return new Bm25Index(notes, weights).rank(capture);
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
