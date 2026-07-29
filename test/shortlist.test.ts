import { describe, expect, it } from "vitest";
import {
  FIELD_WEIGHTS,
  bm25Rank,
  rankShortlist,
  tokens,
  type ScoreableNote,
} from "../src/pipeline/shortlist";

/**
 * Parity fixtures.
 *
 * Every expected value below was produced by running the research harness itself —
 * `tokens()` from `scripts/lib/shortlist.mjs` and the BM25F `rank()` from
 * `scripts/measure-doc-expansion.mjs` at the measured `linksHeavy` weights
 * (title 1, body 1, links ×3). They are pinned, not recomputed, so this suite fails
 * if the port ever drifts from the behaviour the research was measured on (KTD5).
 */

describe("tokens — parity with the research tokeniser", () => {
  it("lowercases, splits on punctuation, strips possessives and stems crudely", () => {
    expect(tokens("Sarah's take on the sleep-debt study, revisited!")).toEqual([
      "sarah",
      "take",
      "sleep",
      "debt",
      "study",
      "revisit",
    ]);
  });

  it("applies the crude stemmer exactly as the harness does", () => {
    // Faithful port: "running" becomes "runn", not "run". See the note in shortlist.ts.
    expect(tokens("RUNNING and runs and run; I ran (mostly)")).toEqual([
      "runn",
      "run",
      "run",
      "ran",
      "mostly",
    ]);
  });

  it("drops stopwords and words of two characters or fewer", () => {
    expect(tokens("the a an of it is — no, not just very much")).toEqual([]);
  });

  it("keeps digits and internal apostrophes", () => {
    expect(tokens("co2 levels 400ppm at 3am")).toEqual(["co2", "level", "400ppm", "3am"]);
    expect(tokens("don't overfit; it's fine")).toEqual(["don't", "overfit", "fine"]);
  });

  it("returns nothing for an empty string", () => {
    expect(tokens("")).toEqual([]);
  });
});

/** The parity corpus. Ranking and scores below are pinned from the harness. */
const CORPUS: ScoreableNote[] = [
  {
    title: "Sleep debt doesn't accumulate linearly",
    body: "noticed my sleep debt plateaus after three bad nights instead of piling up",
    links: ["Sleep research", "Marcus mentioned this at dinner"],
  },
  { title: "Marcus", body: "person hub" },
  {
    title: "Espresso ruins the afternoon",
    body: "coffee after two in the afternoon wrecks how quickly I fall asleep",
    links: ["Sleep debt doesn't accumulate linearly"],
  },
  { title: "The kitchen tap drips", body: "need a new washer for the tap in the kitchen" },
  { title: "Bouldering plateau", body: "stuck on the same grade for a month of climbing", links: ["Marcus"] },
];

describe("bm25Rank — parity with the research harness", () => {
  it("reproduces the fixture ranking and scores exactly", () => {
    const ranked = bm25Rank("sleep debt plateaus again after a bad week", CORPUS);
    expect(ranked.map((n) => n.title)).toEqual([
      "Sleep debt doesn't accumulate linearly",
      "Espresso ruins the afternoon",
      "Bouldering plateau",
      "Marcus",
      "The kitchen tap drips",
    ]);
    expect(ranked[0]!.score).toBeCloseTo(1.909445699624, 10);
    expect(ranked[1]!.score).toBeCloseTo(1.015036217222, 10);
    expect(ranked[2]!.score).toBeCloseTo(0.450608908932, 10);
  });

  it("breaks score ties alphabetically by title", () => {
    const ranked = bm25Rank("the kitchen tap", CORPUS);
    expect(ranked.map((n) => n.title)).toEqual([
      "The kitchen tap drips",
      "Bouldering plateau",
      "Espresso ruins the afternoon",
      "Marcus",
      "Sleep debt doesn't accumulate linearly",
    ]);
    expect(ranked[0]!.score).toBeCloseTo(1.753422357789, 10);
  });

  it("scores a candidate sharing no term with the capture at exactly zero", () => {
    // Load-bearing: misses are absolute, not merely low. Widening k cannot recover a zero.
    const ranked = bm25Rank("the kitchen tap", CORPUS);
    for (const n of ranked.slice(1)) expect(n.score).toBe(0);
  });

  it("preserves the candidate's own fields alongside the score", () => {
    const ranked = bm25Rank("kitchen", CORPUS);
    expect(ranked[0]!.body).toBe("need a new washer for the tap in the kitchen");
  });

  it("is deterministic across repeated calls with identical input", () => {
    const a = bm25Rank("sleep debt plateaus again after a bad week", CORPUS);
    const b = bm25Rank("sleep debt plateaus again after a bad week", CORPUS);
    expect(b).toEqual(a);
  });

  it("returns every candidate at score zero for an empty capture, without throwing", () => {
    const ranked = bm25Rank("", CORPUS);
    expect(ranked).toHaveLength(CORPUS.length);
    expect(ranked.every((n) => n.score === 0)).toBe(true);
  });

  it("returns nothing for an empty corpus", () => {
    expect(bm25Rank("anything at all", [])).toEqual([]);
  });
});

describe("bm25Rank — field weighting (KTD1)", () => {
  const notes: ScoreableNote[] = [
    { title: "Only in links", body: "unrelated filler text here", links: ["glaucoma"] },
    { title: "Only in body", body: "glaucoma appears here once in the body" },
    { title: "Neither one", body: "totally different words entirely" },
  ];

  it("weights link prose x3, so a link-only term outranks the same term in a body", () => {
    const ranked = bm25Rank("glaucoma", notes);
    expect(ranked.map((n) => n.title)).toEqual(["Only in links", "Only in body", "Neither one"]);
    expect(ranked[0]!.score).toBeCloseTo(0.235001814623, 10);
    expect(ranked[1]!.score).toBeCloseTo(0.200988394085, 10);
    expect(ranked[2]!.score).toBe(0);
  });

  it("pins the measured weights", () => {
    expect(FIELD_WEIGHTS).toEqual({ title: 1, body: 1, tags: 1, links: 3 });
  });

  it("indexes tags, and an empty tags field changes nothing", () => {
    // Parity guard: the harness had no tags field, so the fixtures above are only valid
    // if an all-empty tags field is a no-op.
    const tagged: ScoreableNote[] = [{ title: "Untitled note", tags: ["glaucoma"] }];
    expect(bm25Rank("glaucoma", tagged)[0]!.score).toBeGreaterThan(0);
    expect(bm25Rank("glaucoma", [{ title: "Untitled note", tags: [] }])[0]!.score).toBe(0);
  });
});

describe("rankShortlist", () => {
  it("drops zero-scoring candidates and caps at k", () => {
    const shortlist = rankShortlist("sleep debt plateaus again after a bad week", CORPUS, 2);
    expect(shortlist.map((n) => n.title)).toEqual([
      "Sleep debt doesn't accumulate linearly",
      "Espresso ruins the afternoon",
    ]);
  });

  it("returns an empty shortlist for an empty capture rather than throwing", () => {
    expect(rankShortlist("", CORPUS, 10)).toEqual([]);
  });

  it("returns an empty shortlist when nothing shares a term", () => {
    expect(rankShortlist("quarterly logistics invoicing", CORPUS, 10)).toEqual([]);
  });
});
