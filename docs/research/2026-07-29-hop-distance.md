# Hop distance — can graph expansion reach what BM25 misses?

Date: 2026-07-29 · Issue #168 · free, no API calls
Harness: `scripts/measure-hop-distance.mjs` (`npm run measure:hops`)
Data: `docs/research/data/2026-07-29-hop-distance-seeds{10,25}.json`

`docs/research/2026-07-29-graph-expansion.md` proposed a 2-hop decayed BFS out of the top BM25 hits,
fused into reserved shortlist slots, and predicted **+3 to +8 points**. That only pays if the notes
BM25 misses are actually within two hops of the notes it finds. This measures it.

**Verdict: build it, but only in the hub-blocked form, and only for daily filing.** The reach is
real and slightly larger than predicted. Nearly half of the misses are unreachable at any depth —
those need more index terms, not a graph.

## Method

Corpus: the 720-capture chronological fixture (576 atoms, **811 gold links** to an earlier atom,
3 years, 20 interleaving threads). Each capture is classified against the vault as it stood that
day — the 1,200-note pre-run vault plus every atom already written.

**Non-circularity.** The edge being predicted is never in the graph, and neither is any other edge
the capture owns: the capture does not exist in the vault yet, so the graph is built only from
captures dated earlier than the one under test.

Three graph settings:

| setting | edges | hubs |
|---|---|---|
| `full` | every prior edge | traversable |
| `hub-blocked` | every prior edge | reachable, but not expanded through |
| `catch-up` | only pre-run edges (atom → pre-existing note) | traversable |

`hub-blocked` is the one to believe. A person hub touches everything, so a path *through* one is
evidence the hub exists, not evidence the two notes are related. `catch-up` is what a graph-blind
run actually has — links written during the run are withheld so the run cannot retrieve over links
it just created.

Three populations of gold link, because they need different things:

| population | share of 811 | what it needs |
|---|---|---|
| already in the top-10 seeds | 359 (44%) | nothing |
| scored, but ranked below | 262 (32%) | rank, not reach — worst rank is **224**, so k=400 already has all of them |
| **zero score — no shared term** | **190 (23%)** | **terms. Widening k provably cannot recover these** |

Median rank when BM25 scores the target at all is **5** (p90 69). That confirms the earlier finding
from a different angle: this is not a ranking problem. Every scored target is inside k=400.

## Result

Zero-score population, n=190 — the only one expansion exists to serve:

| seeds | graph | 1 hop | 2 hops | **≤2 hops** | 3+ | unreachable | expansion size (mean, p90) |
|---|---|---|---|---|---|---|---|
| 10 | full | 27% | 26% | **53%** | 7% | 40% | 23 + 67 (p90 36 + 128) |
| 10 | hub-blocked | 21% | 13% | **34%** | 12% | 54% | 21 + 22 (p90 33 + 43) |
| 10 | catch-up | 11% | 30% | **41%** | 4% | 55% | 9 + 70 (p90 14 + 135) |
| 25 | full | 35% | 26% | **62%** | 11% | 28% | 45 + 107 (p90 72 + 205) |
| 25 | hub-blocked | 31% | 17% | **47%** | 12% | 41% | 43 + 42 (p90 68 + 78) |
| 50 | hub-blocked | 39% | 21% | **60%** | 11% | 29% | 70 + 60 (p90 112 + 110) |

Full sweep at seeds 5/10/25/50 is reproducible from the harness; the trend is monotone.

### What that is worth in recall

At k=400 on this corpus, BM25 retrieves every scored target and none of the zero-score ones. (Some
zero-score targets do land inside the top 400 — but only on the alphabetical tiebreak, which is
luck, not retrieval. Counting them would inflate the baseline.) So:

- baseline recall@400: **621/811 = 77%**
- \+ hub-blocked 2-hop expansion, 25 seeds: +47% of 190 = **+89 links → 88%**
- \+ hub-traversable, 50 seeds: +72% of 190 = +137 links → 94%, but see the cost below

**+11 points**, above the graph-expansion doc's +3 to +8 prediction, in the conservative setting.

### The costs, and why hub-blocked wins anyway

**Slots.** Hub-blocked 2-hop at 25 seeds adds 85 titles on average (p90 146). Hub-traversable adds
152 (p90 277) — it blows through the ~60 reserved slots and keeps going, because expanding out of a
hub pulls in everything that hub ever touched. At 16.47 tokens a title, 85 extra titles is ~1,400
input tokens, about 0.4¢ cold and 0.04¢ warm. The slot budget is not really the constraint; the
constraint is that hub paths are not evidence.

**Precision.** 0.3–1.0% of added titles are gold, in every setting. That is expected — the shortlist
is 400 titles of mostly-noise already, and the link-quality run measured that capping does not make
the model invent links (2 on cold-start probes at every k). Expansion is a recall instrument. It
should be judged on reach and slot cost, not precision.

### Two findings that change the design

**1. In a graph-blind catch-up, "graph expansion" is not a graph algorithm.** The catch-up row
reaches 41% at 2 hops but only 11% at 1 — because the only pre-run edges are atom → pre-existing
note. Everything it recovers is at exactly 2 hops: *another note that mentions the same person or
project*. Hub-blocked catch-up is 0% by construction. So for catch-up the honest feature is "also
include notes sharing a hub with a top hit", and it inherits the hub problem wholesale. **Do not
build BFS for catch-up.** Build it for daily filing, where the prior graph is real.

**2. Roughly half the misses are in another component and always will be.** 41–54% of zero-score
targets are unreachable at any depth in the hub-blocked graph. No traversal recovers them. That
half is the pool the free wins target — index the LLM-written tags and link prose, index more body
text, BM25F — because those add *terms*, and a zero-score note only moves when a term matches.

## Caveats

- **Synthetic corpus.** The links are author-declared and thread-structured, so same-thread notes
  are densely interlinked. A real vault's graph is sparser and messier; expect the real reach to be
  lower than 47%. The real-vault cross-check (`analyze-vault-shortlist.mjs --hops`, written and
  read-only) has **not been run** — the sandbox blocked reading the personal vault.
- **Seed depth is a free knob and it matters** (34% → 47% → 60% from 10 → 25 → 50 seeds,
  hub-blocked). Whatever gets built should treat it as tunable, not fixed at 10.
- The hub rule here is "node is a pre-existing note". On a real vault the harness uses a measured
  rule instead — top 5% by degree — which is the version that generalises.
- Recall is not links. The model still converts only ~86–90% of a perfect shortlist into links
  (the separate 10-point conversion gap), so +11 points of recall is an upper bound on +11 points
  of linking.
