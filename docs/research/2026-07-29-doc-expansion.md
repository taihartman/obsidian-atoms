# Indexing what the model wrote — the free doc2query, measured

Date: 2026-07-29 · Issue #168 · free, no API calls
Harness: `scripts/measure-doc-expansion.mjs` (`npm run measure:expansion`)
Data: `docs/research/data/2026-07-29-doc-expansion.json`

`docs/research/2026-07-29-retrieval-techniques.md` ranked "index the LLM-written tags and link
prose" as the best free lever, on the reasoning that the pipeline already pays a model to generate
that text, so using it as document expansion costs nothing. This measures it.

**Verdict: do it. It wins far more than it loses in every configuration tested, and it is free.**

> **Corrected 2026-07-29b.** The first version of this doc claimed **16 won / 0 lost** and called it
> strictly dominant. The zero-loss part was an artefact of the pre-run vault's filler notes, whose
> bodies were set to their own titles — two-thirds of every scoring pool were three-word documents,
> which collapsed the average length BM25 normalises against. With capture-shaped filler the result
> is **7 to 16 won against 0 to 1 lost**, depending on weighting. Still a clear, one-directional
> win; not a perfect one. The full band is in **What survives the corpus** below, and the
> zero-score column — the headline metric — turns out to be completely unaffected.

## Method

576 atoms, **811 gold links**, each capture scored against the vault as it stood that day
(1,200 pre-run notes plus every atom already written). BM25F with per-field length normalisation and
weights applied to term frequency *before* saturation — summing per-field BM25 scores instead would
double-count a term appearing in two fields, which is exactly the case under test.

The corpus's stand-in for link prose is `linksToExisting`: the pre-existing notes (people, projects,
places) the model named when filing the atom. **This is a thin proxy.** A real atom's tail is a
reason-bearing sentence per link plus the model's tags — far more vocabulary than a list of hub
titles. Read every number here as a lower bound.

Headline metric is not recall, it is **how many gold targets still score zero**. A zero-score note
cannot be recovered by widening k; only a term match moves it.

## Result

Capture-shaped filler (`--filler coherent`, the default):

| config | r@40 | r@100 | r@400 | zero-score | median rank | won/lost @400 |
|---|---|---|---|---|---|---|
| title only | 35% | 48% | 76% | 319 (39%) | 28 | +50 / −73 |
| **body + title** (today's best) | 47% | 59% | 79% | 190 (23%) | 21 | — |
| **+ link prose** | 48% | 61% | 80% | **169 (21%)** | 21 | **+7 / −1** |
| + link prose ×3 | **50%** | **63%** | **81%** | **169 (21%)** | **19** | **+13 / −1** |
| BM25F title×2 body×1 links×2 | 49% | 62% | 80% | 169 (21%) | 21 | +11 / −1 |
| link prose only | 45% | 51% | 79% | 459 (57%) | 4 | +105 / −109 |

**Read the zero-score column, not r@400.** A zero-score target still lands inside the top 400
sometimes, on the alphabetical tiebreak — which is why title-only shows a respectable 76% while
failing to score 39% of targets at all. Its honest ceiling is (811−319)/811 = **61%**, against
**77%** for body+title. Body scoring still wins decisively; the r@400 column just flatters the
loser.

**The win is one-directional but not perfect.** 13 won against 1 lost at ×3 weighting is a sign
test at p ≈ 0.002 — adding the field almost never displaces a link it previously found. The
original "0 lost" was the padding artefact, not the effect.

## What survives the corpus

Re-run under all three filler shapes, the band is:

| measure | title-shaped (the bug) | mismatched | **capture-shaped (real)** |
|---|---|---|---|
| zero-score, body+title | 190 | 190 | **190** |
| zero-score, + link prose | 169 | 169 | **169** |
| won / lost @400 (×3 weighting) | +16 / −0 | +16 / −1 | **+13 / −1** |
| r@40, body+title | 64% | 49% | **47%** |

**The zero-score column does not move at all.** Whether a gold target shares a term with the query
depends only on that pair — filler cannot touch it. So "indexing link prose converts 21 of 190
absolute misses, 11% of them" is the one claim here that is immune to how the corpus is padded,
and it is the claim the experiment was built to make. Everything expressed as recall@k is soft:
r@40 for body+title swings 17 points on padding alone.

- **Weighting only matters below k=100.** At k=400 all three weightings are identical (81%, 169
  zero-score); at k=40 the ×3 weighting is worth +2 over ×1 and **+5 over the baseline**. That is
  the Plus configuration, which caps at 40 titles — so if the 40-cap survives at all, weight the
  link field heavily.
- **Link prose alone is not a substitute** (57%, and 213 links lost). It is an additional field, not
  a replacement one — as expected, since it carries the model's vocabulary and not the user's.
- **Title-only loses 113 links against body+title** and leaves 39% of targets at zero score. That
  re-confirms the branch's central finding on a second, larger corpus.

## What this does and does not buy

It converts 21 of 190 absolute misses (11%) into notes that k can reach. The other 169 still score
zero. Combined with `docs/research/2026-07-29-hop-distance.md` — where hub-blocked 2-hop expansion
reaches 47% of the zero-score population — the two levers are complementary: expansion adds *terms*,
graph reach adds *paths*, and roughly 40% of misses have neither and are simply unreachable by any
local statistic.

## Not yet measured

- **Tags.** The corpus has none. On a real vault, tags are the other half of the model's output and
  the cheaper half to index. Needs the real-vault run.
- **Real link prose.** Hub titles are a floor; reason-bearing sentences should do better.
- **More body text.** The corpus's captures are short thumb-notes, so the 200-char truncation
  question (mean real body is 1,943 chars) cannot be asked here at all. It needs the real vault,
  where the handoff already flags the 200-char cut as **not established** and probably wrong.

All three are blocked on the same thing: `analyze-vault-shortlist.mjs` reading the personal vault.
