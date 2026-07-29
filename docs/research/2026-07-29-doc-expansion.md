# Indexing what the model wrote — the free doc2query, measured

Date: 2026-07-29 · Issue #168 · free, no API calls
Harness: `scripts/measure-doc-expansion.mjs` (`npm run measure:expansion`)
Data: `docs/research/data/2026-07-29-doc-expansion.json`

`docs/research/2026-07-29-retrieval-techniques.md` ranked "index the LLM-written tags and link
prose" as the best free lever, on the reasoning that the pipeline already pays a model to generate
that text, so using it as document expansion costs nothing. This measures it.

**Verdict: do it. It is strictly better — 16 links won, 0 lost — and it is free.** The size of the
win on this corpus is small (+2 points at k=400, +5 at k=40), but it is a floor, not an estimate.

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

| config | r@40 | r@100 | r@400 | zero-score | median rank | won/lost @400 |
|---|---|---|---|---|---|---|
| title only | 52% | 60% | 65% | 319 (39%) | 6 | +4 / −113 |
| **body + title** (today's best) | 64% | 73% | 79% | 190 (23%) | 5 | — |
| **+ link prose** | 67% | 74% | **81%** | **169 (21%)** | 5 | **+16 / −0** |
| + link prose ×3 | **69%** | **76%** | **81%** | **169 (21%)** | **4** | **+16 / −0** |
| BM25F title×2 body×1 links×2 | 67% | 75% | 81% | 169 (21%) | 5 | +16 / −0 |
| link prose only | 43% | 43% | 57% | 459 (57%) | 4 | +34 / −213 |

**+16 / −0 is the number that matters.** A net +2 points would be unremarkable if it were 40 won and
24 lost — that would be churn inside the noise. It is not: adding the field never displaced a link
it previously found, in 811 trials. A sign test on 16–0 is p < 0.0001. This is one of the few
results in this branch that does not need a bigger corpus to believe.

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
