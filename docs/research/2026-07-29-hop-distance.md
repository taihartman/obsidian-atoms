# Hop distance — can graph expansion reach what BM25 misses?

Date: 2026-07-29 · Issue #168 · free, no API calls
Harness: `scripts/measure-hop-distance.mjs` (`npm run measure:hops`)
Data: `docs/research/data/2026-07-29-hop-distance-seeds{10,25}.json`

`docs/research/2026-07-29-graph-expansion.md` proposed a 2-hop decayed BFS out of the top BM25 hits,
fused into reserved shortlist slots, and predicted **+3 to +8 points**. That only pays if the notes
BM25 misses are actually within two hops of the notes it finds. This measures it.

**Verdict: build it, but only in the hub-blocked form, and only for daily filing.** The reach is
real and lands where the research doc predicted. Well over half the misses are unreachable at any
depth — those need more index terms, not a graph.

> **Corrected 2026-07-29b — the first version of this doc overstated the gain.** It reported 47%
> two-hop reach and +11 points of recall. That was an artefact of the pre-run vault's filler notes,
> whose bodies were set to their own titles: two-thirds of every scoring pool were three-word
> documents, which collapsed the average document length BM25 normalises against. With
> capture-shaped filler (`--filler coherent`, now the default) the figure is **29%, worth about
> +7 points** — inside the +3 to +8 the graph-expansion doc originally predicted. Every number
> below is the corrected run; the sensitivity band across all three filler shapes is in
> **How much of this survives the corpus**, and it is the honest summary.

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

Zero-score population, n=190 — the only one expansion exists to serve. Capture-shaped filler,
25 seeds:

| graph | 1 hop | 2 hops | **≤2 hops** | 3+ | unreachable | expansion size (mean, p90) |
|---|---|---|---|---|---|---|
| full | 35% | 26% | **62%** | 11% | 28% | 45 + 107 (p90 72 + 205) |
| **hub-blocked** | 16% | 13% | **29%** | 13% | 58% | 15 + 17 (p90 28 + 37) |
| catch-up | 7% | 33% | **41%** | 3% | 56% | 9 + 70 (p90 14 + 135) |

### What that is worth in recall

Honest recall@400 — a gold target that is both **scored and inside k** — is **614/811 = 76%**.
(A zero-score target sometimes lands inside the top 400 anyway, but only on the alphabetical
tiebreak. That is luck, not retrieval, so the harness now reports the scored-and-inside figure
separately; counting the lucky ones inflates the baseline.)

- baseline recall@400: **76%**
- \+ hub-blocked 2-hop expansion, 25 seeds: +29% of 190 = **+55 links → 83%**

**About +7 points**, for ~32 extra shortlist slots (p90 65) — comfortably inside the ~60-slot
reserved budget, and ~530 input tokens, well under a tenth of a cent warm.

## How much of this survives the corpus

The filler flaw above is not a one-off; it is a warning that this corpus's *magnitudes* are soft.
Re-running under all three filler shapes gives the honest band:

| measure | title-shaped filler (the bug) | mismatched | **capture-shaped (real)** |
|---|---|---|---|
| zero-score links | 190 (23%) | 190 (23%) | **190 (23%)** |
| honest recall@400 | 77% | 76% | **76%** |
| zero-score ≤2 hops, hub-blocked | 47% | 31% | **29%** |
| expansion set (1 hop + 2 hop) | 43 + 42 | 18 + 20 | **15 + 17** |

**What is robust:** the zero-score count is identical in all three, because whether a gold target
shares a term with the query is a property of that pair alone — no amount of filler can change it.
Honest recall@400 barely moves. Those two numbers can be trusted.

**What is not:** the two-hop reach swings 47% → 29% purely on how the filler is shaped, and the
expansion set size swings by 2.5×. The direction survives everywhere; the magnitude does not.
Treat **+7 points** as the working estimate and **+3 to +8** as the interval.

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
