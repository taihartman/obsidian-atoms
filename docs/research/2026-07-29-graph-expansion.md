# Graph-based retrieval and candidate expansion for the Atoms shortlist

Date: 2026-07-29
Scope: does expanding the BM25 candidate shortlist along existing wikilinks improve recall of the correct note?
System under study: ~3,000 notes, user-authored wikilink graph, BM25 shortlist of ~400, measured recall 79–88%.

---

## Recommendation (read this first)

**Try it — but build the cheap version, and measure the graph before you build anything.**

1. **Cost is not the constraint. Precision is.** At 3,000 nodes and ~6,000 edges, every algorithm in this literature is free. A full personalized-PageRank power iteration is ~240K float ops (well under 5ms in JS); a 2-hop BFS is sub-millisecond; the CSR adjacency is ~60KB against a 2MB budget. The 50ms budget does not bind. Do not let it drive the design. The real risk is dilution — adding wrong candidates and displacing right ones.

2. **Run the measurement before writing retrieval code.** You already have a labelled eval set. Compute three distributions and the decision makes itself:
   - **Hop distance from the top-10 BM25 results to the gold note**, split by failure category (thread continuation / vocabulary mismatch / supersession). If misses are usually 1 hop from a strong seed, this works. If they are 4+ hops or in a different component, nothing in this document helps.
   - **Connected-component size distribution.** Notes in components of size 1–2 get exactly zero benefit. That fraction is a hard ceiling on the achievable gain.
   - **Degree distribution**, specifically what your people/topic hub notes look like. Hubs are the main failure mode (§5).

   This is a day of analysis and it is worth more than a week of implementation.

3. **If the hop distribution is favourable, ship 2-hop decayed BFS — not PPR.** At HippoRAG 2's own restart probability (α = 0.5), personalized PageRank *is* a decayed 2–3 hop expansion: only 12.5% of the mass survives three hops. On a graph of this diameter the two produce nearly the same ordering, and the BFS has fewer parameters, fewer failure modes, and is explainable to a user. Escalate to PPR only if the measurement shows gold notes routinely sitting 3+ hops out.

4. **Constrain the spread, or it will find everything.** The single most important knob is Crestani's **fan-out constraint**: do not traverse *through* a node whose degree exceeds a threshold (start around 25–30). A person hub connects every note that mentions that person to every other; two hops through it is "everything about Alex", which is not a shortlist, it is the vault. Traverse *to* hubs, stop *at* them. Second knob: **IDF-style seed weighting** — HippoRAG's ablation shows removing its equivalent (node specificity) costs ~3 recall points.

5. **Fuse with Reciprocal Rank Fusion into a reserved slot budget, not free mixing.** Keep 400 total: ~340 BM25 + ~60 graph-only, RRF (k=60) over the two lists. Reserved slots cap the blast radius of a bad expansion, keep the A/B interpretable, and avoid calibrating BM25 scores against PPR probability mass (wildly different scales, per-vault tuning, not worth it). Never let expansion displace the top ~100 BM25 results.

6. **Cold start is a non-problem for the *algorithm* and a real problem for the *catch-up run*.** With no edges, PPR/BFS degenerates to the identity — all mass stays on the seeds, expansion contributes nothing and costs nothing. That is the principled fallback and it is free. The actual danger is different: during a catch-up run over an empty vault, the plugin creates the links it will then retrieve over, using the same model. That is a closed feedback loop with no external correction — early linking errors compound. **Run catch-up graph-blind (or at heavily damped weight) and enable expansion only for steady-state processing.**

7. **Deflate your expectations.** Every reported graph-retrieval gain in this literature is at recall@2 or recall@5. You are operating at recall@400 out of 3,000 — 13% of the corpus already in the shortlist. Those published numbers conflate *reranking* (moving a reachable note up) with *reaching* (pulling in a note text could not find at any k). Only the reaching component transfers to you, and it is the smaller half. Budget for **+3 to +8 points on thread continuation**, not +20. And if the real problem turns out to be the LLM picking the wrong note *from* the 400, graph expansion does not touch it at all — check that before you start.

**Verdict summary**

| Technique | Verdict |
|---|---|
| Query-seeded spreading activation / 2-hop decayed BFS | **Yes — build this.** Cheap, degrades gracefully, targets exactly the thread-continuation failure. |
| Personalized PageRank (power iteration) | **Later.** Not too slow — nearly equivalent to (1) at α=0.5. Adopt only if measurement shows deep hops. |
| Andersen–Chung–Lang push PPR | **No.** Correct answer at 100K+ nodes. Solves a scaling problem you do not have. |
| HippoRAG (as a design source) | **Partially.** Its PPR-over-passage-nodes shape transfers; its LLM OpenIE indexing and its benchmark setting do not. |
| Microsoft GraphRAG | **No.** Built for corpus-wide summarization, needs LLM extraction + Leiden + community summaries, network-bound, non-incremental. |
| LightRAG | **No.** Cheaper incremental updates than MS GraphRAG, still LLM-extracted, still enormous token cost. |
| Static global link analysis (PageRank as a prior) | **No.** Repeatedly a null result in ad-hoc IR (TREC Web track). Distinct from query-seeded expansion — see §1.4. |
| Reciprocal Rank Fusion | **Yes.** Boring, robust, no calibration. Use it. |
| Linear score blending | **No.** Requires normalizing BM25 against PPR mass and per-vault tuning for no demonstrated benefit over RRF. |

---

## 1. Spreading activation and personalized PageRank

### 1.1 What it is

Spreading activation labels a set of source nodes with an initial activation, then iteratively propagates a decayed fraction of that activation to linked neighbours until a termination condition fires; nodes ending above threshold are the retrieved set. Personalized PageRank is the same idea with a probabilistic formulation — a random walk that at every step either follows an edge or teleports back to the seed distribution with restart probability α, converging to a stationary distribution concentrated near the seeds.

### 1.2 Parameterisation

Crestani's 1997 survey (*Artificial Intelligence Review* 11(6)) is still the reference for the practical knobs. The core algorithm has an activation function, a **decay/attenuation factor** per hop, a **firing threshold** below which a node does not propagate, and a termination condition (fixed pulse count, activation floor, or node budget). Its central finding is the one that matters for you: **the model has no built-in constraint, so activation spreads to the entire network** unless deliberately restricted. The four classic constraints are:

- **Distance constraint** — cap the number of hops.
- **Fan-out constraint** — stop spreading at nodes with degree above a threshold. *(The one that matters most for a vault with hub notes.)*
- **Path constraint** — prefer or restrict specific edge types.
- **Activation constraint** — threshold on accumulated activation per node.

PPR's parameterisation collapses most of this into one number. HippoRAG 2 calls igraph's `personalized_pagerank` with **damping = 0.5** on an undirected weighted graph, i.e. **restart probability α = 0.5** — mass halves every hop. That is aggressive, and it is the reason PPR and short decayed BFS coincide here.

The other parameter worth stealing is **node specificity**: HippoRAG weights each seed by `s_i = 1/|P_i|` (inverse count of passages the node appears in), a graph-native IDF that stops common nodes from dominating propagation. Ablation: removing it drops MuSiQue Recall@2 from **40.9 → 37.6**.

### 1.3 Are the measured gains real?

Yes, in the multi-hop QA setting, and the effect sizes are moderate not transformative. HippoRAG 2 Recall@5 against NV-Embed-v2:

| Benchmark | Type | Dense baseline | HippoRAG 2 | Δ |
|---|---|---|---|---|
| MuSiQue | multi-hop | 69.7 | 74.7 | **+5.0** |
| 2Wiki | multi-hop | 76.5 | 90.4 | **+13.9** |
| HotpotQA | multi-hop | 94.5 | 96.3 | +1.8 |
| NaturalQuestions | single-hop | 75.4 | 78.0 | +2.6 |
| PopQA | single-hop | ~51.7 | ~51.7 | ~0 (slightly behind) |

Two things to read off this table. First, **the gain is concentrated where a multi-hop path exists by construction** — 2Wiki and MuSiQue are *built* so that a reasoning chain runs through the corpus. Second, **on single-hop fact retrieval the graph buys nothing.**

### 1.4 Failure modes on a sparse graph

- **Sparse-graph null results are well documented in classical IR.** Across the early TREC Web tracks (TREC-8 WT2g, TREC-9, TREC-2001), link-based methods **did not improve** ad-hoc topic relevance; the participants' own diagnosis was that there were too few inter-server links for link evidence to carry signal. **Important distinction:** those experiments used *global, query-independent* link analysis (in-degree, PageRank as a static authority prior). That is genuinely useless for you — a hub note is not "authoritative" for a specific capture. Query-*seeded* expansion is a different mechanism and is not refuted by that result. But it is the sharpest available reminder that link structure is not free signal.
- **Percolation.** At mean degree ~1, a random graph sits exactly at the threshold where a giant connected component emerges. Vaults are not random — hubs create connectivity — but the implication survives: a meaningful fraction of your notes will be isolated or in components of size 2–3, and for those, expansion contributes exactly zero. Measure this; it is your ceiling.
- **PPR is itself a failure source.** HippoRAG 2's own error analysis attributes **~50% of remaining failures to the PPR search step**, not to seed linking. The graph walk introduces errors as well as fixing them.
- **Seed-error amplification.** This is the pseudo-relevance-feedback drift problem in graph clothing: if the BM25 top-10 contains nothing correct, expansion amplifies the wrong neighbourhood rather than recovering. Gate on seed quality (minimum BM25 score, or require ≥2 seeds agreeing on a neighbourhood).
- **Hub dominance / degree bias.** Random-walk methods preferentially concentrate on high-degree nodes regardless of query; degree normalization is the standard mitigation and measurably stabilises random-walk predictions. Your people/topic hubs are exactly this pathology. Mitigate with the fan-out constraint plus IDF-style weighting.
- **Parameter tuning is ad hoc.** Both the survey literature and the recent query-aware spreading-activation work (arXiv 2606.30133) flag that optimal decay and threshold values are dataset-specific and that performance degrades when the graph is sparse. There is no principled default; you will tune against your eval set.

### 1.5 Implementation difficulty (plain TypeScript)

Low across the board.

- **Build CSR from `metadataCache.resolvedLinks`** — ~30 lines. Two caveats: `resolvedLinks` is *forward* links only, so **symmetrize** — a backlink is at least as strong a relevance signal as a forward link, since it means another note's author judged this one relevant. Ignore `unresolvedLinks`.
- **2-hop decayed BFS with fan-out cap** — ~50 lines, sub-millisecond.
- **PPR power iteration on CSR** — ~60 lines, 20 iterations over ~12K directed edge entries. Not a performance concern.
- **Andersen–Chung–Lang forward push** — ~80 lines, runtime `O(1/(α·ε))` **independent of graph size**, which is the right tool at 100K+ nodes and pointless at 3K. Note it as the scaling path and move on.
- **Memory:** two `Int32Array`s (3,001 offsets + ~12,000 targets) ≈ 60KB. Non-issue.

### 1.6 Verdict

**Worth trying, in the constrained BFS form, gated on the hop-distance measurement.**

---

## 2. GraphRAG and relatives

### 2.1 Microsoft GraphRAG

**What it is:** an indexing pipeline that uses an LLM to extract entities and relations from every chunk of a corpus, runs hierarchical Leiden community detection over the resulting graph, and LLM-generates a summary for every community at every level. Query time offers *local search* (entity-neighbourhood) and *global search* (map-reduce over community summaries).

**Does it apply here?** No, on four independent grounds:

- It is designed for **query-focused summarization** — "what are the main themes in this corpus" — not for locating one specific note. Your task is the latter.
- It requires **LLM extraction over the whole corpus** plus per-community summary generation. That is network-bound and expensive; comparative studies report GraphRAG-family token usage an order of magnitude above naive RAG (one reported figure: 757M tokens for LightRAG on HotpotQA vs 62M for naive RAG).
- The index and its summaries **grow super-linearly and resist incremental updates**. Your vault gets new atoms every day.
- Follow-up analyses report **2–3× higher end-to-end query latency** from graph traversal and summarisation.

You would also be paying for the one thing you already get free: `metadataCache` hands you a link graph with zero extraction cost, and it is a *human-authored* graph, which is higher precision than anything OpenIE produces.

**Verdict: no.**

### 2.2 LightRAG

**What it is:** a lighter graph-RAG that does LLM entity/relation extraction and then retrieves via dual-level (low-level entity, high-level theme) keyword matching, with cheaper incremental index updates than Microsoft GraphRAG.

**Applies here?** It fixes the incremental-update objection and none of the others — still LLM extraction, still network, still heavy token cost. **Verdict: no.**

### 2.3 HippoRAG / HippoRAG 2 — the skeptical read

This is the only one with something to teach you, so be precise about what.

**The claim.** HippoRAG 1 (NeurIPS 2024) reports up to **20%** improvement over prior RAG on multi-hop QA, and that single-step retrieval matches iterative methods like IRCoT while being **10–30× cheaper and 6–13× faster**. HippoRAG 2 (arXiv 2502.14802) extends it with passage nodes and reports the gains in §1.3.

**Is the gain real?** Qualified yes, with three deflations you should apply before believing it transfers:

1. **It needs an LLM to build the graph.** HippoRAG's graph is entity-level, extracted by LLM OpenIE over every passage. Indexing MuSiQue's 11,656 passages took **~9.2M input / 3.0M output tokens** (≈$22 via batch API). *You do not need this — and that is a strict advantage, not a caveat.* Your graph is free, and human-authored links carry intent that entity co-occurrence does not.
2. **HippoRAG 1's entity-only graph was actively worse at some tasks.** It scored **16.3 F1 on NarrativeQA vs 25.9** for v2, and 55.3 vs 63.3 on NaturalQuestions — the paper attributes this to "context loss during both indexing and inference" from being entity-centric. The v2 fix was **adding passage nodes**: ablating them drops MuSiQue recall **74.7 → 63.7, an 11-point collapse**. This is the single most encouraging finding for you, because **your wikilink graph is natively passage-to-passage** — note-to-note edges are exactly the node type that turned out to be load-bearing.
3. **The benchmark setting does not resemble a personal vault.** MuSiQue and 2Wiki are *constructed* so that a multi-hop path through the corpus exists and is the intended solution. A daily capture comes with no such guarantee. This is the largest external-validity gap in the whole document, and it is why the hop-distance measurement in the recommendation is non-negotiable — it is the direct empirical test of whether your corpus has the property the benchmarks build in.

**Does user-authored beat LLM-extracted?** On precision, almost certainly yes — a wikilink is a deliberate assertion of relevance, whereas an OpenIE triple is a statistical artifact. On *coverage*, almost certainly no — an LLM extracts edges everywhere, a human links sporadically, and your average degree of 1–2 is far below what these papers operate on. Expect **higher precision per edge, much lower recall of true relations.** That trade favours short, tightly-constrained expansion (high confidence in each hop) over long random walks (which need density to work).

### 2.4 The broader skeptical evidence

GraphRAG-Bench (arXiv 2506.05690) states the position plainly: **"GraphRAG frequently underperforms vanilla RAG on many real-world tasks."** Its finding is that graphs help on hierarchical knowledge modelling and deep multi-step reasoning, and do not help on fact retrieval. Other surveys converge: graph RAG's benefit is contingent on knowledge-graph quality and coverage; where the graph does not cover the concept, retrieved context is empty or misleading; and GraphRAG "will occasionally degrade the performance of a standalone LLM."

Meanwhile hybrid BM25 + dense with RRF is repeatedly recommended as the *minimum viable* baseline and repeatedly beats both constituents. If you have not yet tried adding a cheap local dense/embedding signal to the BM25 shortlist, that is a more reliable recall win than graph expansion — though it costs memory and model weight you may not want on mobile, so it is a separate decision.

### 2.5 Verdict

Take **one idea** from HippoRAG — query-seeded propagation over a passage-level graph with IDF-weighted seeds — and **none of the machinery**. Reject Microsoft GraphRAG and LightRAG outright.

---

## 3. Hybrid scoring: fusing text and graph proximity

### 3.1 Reciprocal Rank Fusion

**What it is:** score each document as `Σ_lists 1/(k + rank)` over the ranked lists it appears in, with `k = 60`. Cormack, Clarke & Büttcher (SIGIR 2009) showed it consistently beats every individual system it combines *and* beats Condorcet Fuse, and that a meta-learner built on it beat all previously reported methods on LETOR 3.

**Why it fits here:** it is rank-based, so it needs no score calibration. That matters a lot — BM25 scores are unbounded and corpus-dependent, PPR mass is a probability distribution summing to 1 with an extremely skewed tail, and reconciling them with a linear weight means per-vault tuning of a parameter you cannot explain. RRF sidesteps this entirely and is about fifteen lines of TypeScript.

**The known wrinkle:** because it is rank-based, a note appearing in *only* the graph list still gets rank-1 credit from that list and can outrank a solid BM25 hit. For a final ranking that is a real precision risk. For **candidate generation** — which is what you are doing — it is fine, arguably desirable, because recall is the objective.

### 3.2 Linear weighting

`final = w·norm(bm25) + (1−w)·norm(ppr)`. Requires min-max or z-score normalization per query, is sensitive to the PPR mass distribution's skew, and introduces `w` as a vault-dependent tuning parameter. No evidence in this literature that it beats RRF for a recall-oriented candidate stage. **Skip it.**

### 3.3 What actually works: reserved slots

The design detail that matters more than the fusion formula. With a **fixed** shortlist of 400, every graph-added candidate *displaces* a BM25 candidate. So:

- Reserve an explicit budget — e.g. **340 BM25 + 60 graph-only** — rather than fusing freely across all 400.
- Before shipping, measure **what fraction of gold notes currently sit at BM25 ranks 340–400**. It is almost certainly small, which makes the displacement nearly free and the experiment nearly risk-free.
- The A/B is then unambiguous: net recall change = (gold notes recovered by the 60 graph slots) − (gold notes lost from the displaced tail).
- Protect the head: **never allow expansion to displace the top ~100 BM25 results.**

### 3.4 Verdict

**RRF, k = 60, into reserved slots.** Low effort, no calibration, and it makes the measurement clean.

---

## 4. Cold start and sparse-graph degradation

### 4.1 How graph methods degrade when the graph is absent

Gracefully, and this is the genuinely good news. With zero edges, the PPR transition matrix is empty and all probability mass remains on the seed distribution; a BFS from a seed with degree 0 returns the seed. **The graph score collapses to a constant and the fused ranking reduces exactly to the BM25 ranking.** No special-casing needed, no crash, no degradation below baseline. The same holds per-note: an isolated note in a mature vault simply gets no expansion.

That gives you a principled fallback for free: **the algorithm is its own fallback.** You still want an explicit gate for clarity and for skipping the work — e.g. skip expansion when total edges < some floor, or when no seed has degree ≥ 1 — but that gate is an optimisation, not a correctness requirement.

### 4.2 The real cold-start risk is the feedback loop, not the emptiness

A catch-up run over an empty vault creates the links it will subsequently retrieve over, using the same model that consumes them. There is no external correction anywhere in that loop. Combined with the well-documented rich-get-richer bias of random-walk methods toward high-degree nodes, the failure mode is: an early atom gets linked slightly too eagerly, its degree grows, expansion surfaces it more often, it gets linked again. By the end of the backfill you have a handful of accidental super-hubs that were never a real theme.

**Mitigations, in order of preference:**

1. **Run catch-up graph-blind.** Backfill on BM25 alone; enable expansion only for steady-state daily processing once the graph is human-vetted. Simplest, safest, and costs you nothing you currently have.
2. **Ramp the graph weight with graph maturity** — hold the graph's RRF contribution at zero until the vault clears a link-density floor, then ramp. Adds a parameter.
3. **Cap the graph's share of the shortlist** (the reserved-slot design already does this — 60/400 is a hard 15% ceiling on how wrong expansion can make things).
4. **Degree-normalize** so a note's chance of being surfaced does not grow monotonically with links already accumulated. This is the standard mitigation for random-walk degree bias and directly counteracts the loop.

### 4.3 Verdict

Cold start is **not a blocker**. The degradation is graceful and automatic. Spend the attention on the backfill feedback loop instead — recommendation 1 above (graph-blind catch-up) resolves it for free.

---

## 5. What this will not fix

State these up front so the eval is honest.

- **Supersession (70–90%).** A capture that overturns a belief is usually *lexically similar* to the belief — same topic vocabulary — so BM25 should already reach it. If it does not, the cause is more likely brevity or age of the target note than graph distance. Graph expansion is the weakest fit of the three failure categories. Confirm with the hop-distance measurement before assuming otherwise.
- **Isolated and small-component notes.** Zero benefit, by construction. Whatever fraction of your vault this is, it is subtracted from the ceiling.
- **Bad seeds.** If BM25's top-10 contains nothing relevant, expansion amplifies the wrong neighbourhood. Spreading activation makes good seeds better and bad seeds worse.
- **Selection errors inside the 400.** If the LLM is receiving the correct note in the shortlist and still choosing wrong, this entire line of work is aimed at the wrong stage. **Check this first** — it is a one-query analysis against your existing eval data and it can invalidate the whole project in an hour.

---

## Sources

- [HippoRAG: Neurobiologically Inspired Long-Term Memory for LLMs (NeurIPS 2024)](https://arxiv.org/abs/2405.14831) — PPR over an LLM-built KG, node specificity, up-to-20% multi-hop claim, 10–30× cheaper than IRCoT.
- [HippoRAG paper, HTML full text](https://arxiv.org/html/2405.14831v1) — node specificity `s_i = 1/|P_i|`; ablation 40.9 → 37.6 MuSiQue R@2.
- [From RAG to Memory: Non-Parametric Continual Learning for LLMs (HippoRAG 2, arXiv 2502.14802)](https://arxiv.org/html/2502.14802v1) — Recall@5 tables, damping 0.5, passage-node ablation 74.7 → 63.7, indexing cost ~9.2M/3.0M tokens, error analysis (~50% of failures from PPR).
- [When to use Graphs in RAG / GraphRAG-Bench (arXiv 2506.05690)](https://arxiv.org/abs/2506.05690) — "GraphRAG frequently underperforms vanilla RAG on many real-world tasks."
- [From Local to Global: A Graph RAG Approach to Query-Focused Summarization (arXiv 2404.16130)](https://arxiv.org/pdf/2404.16130) — Microsoft GraphRAG: Leiden communities, map-reduce global search, summarization framing.
- [In-depth Analysis of Graph-based RAG in a Unified Framework (arXiv 2503.04338)](https://arxiv.org/pdf/2503.04338) — cross-method cost and token comparisons.
- [Crestani, "Application of Spreading Activation Techniques in Information Retrieval", AI Review 11(6), 1997](https://link.springer.com/content/pdf/10.1023/A:1006569829653.pdf) — activation function, decay, thresholds, and the four constraints (distance, fan-out, path, activation); the "spreads to the entire network" problem.
- [Crestani & Lee, "Searching the Web by constrained spreading activation", IP&M 36(4), 2000](https://strathprints.strath.ac.uk/1888/) — constrained SA over domain knowledge networks.
- [Query-Aware Spreading Activation for Multi-Hop Retrieval over Knowledge Graphs (arXiv 2606.30133)](https://arxiv.org/pdf/2606.30133) — decay / hop-limit / activation-threshold parameterisation; explicitly notes degradation on sparse graphs and parameter sensitivity.
- [Overview of the TREC-8 Web Track (Hawking et al.)](https://trec.nist.gov/pubs/trec8/papers/web_overview.pdf) — link-based methods gave little benefit on WT2g; too few inter-server links. Repeated in TREC-9 and TREC-2001.
- [Cormack, Clarke & Büttcher, "Reciprocal Rank Fusion outperforms Condorcet and individual rank learning methods", SIGIR 2009](https://ir.webis.de/anthology/2009.sigirconf_conference-2009.146/) — RRF, k = 60.
- [Andersen, Chung & Lang, local partitioning via approximate PageRank](https://www.math.ucdavis.edu/~saito/data/digraphs/andersen-chung-lang_localpartition-digraphs-via-pagerank.pdf) — forward-push PPR, `O(1/(α·ε))` runtime independent of graph size.
- [Degree-Normalization Improves Random-Walk-Based Embedding Accuracy](https://link.springer.com/chapter/10.1007/978-3-031-34960-7_26) — degree bias toward hubs and the standard normalization mitigation.
- [Hybrid search benchmarking: BM25 + dense with RRF as the minimum viable baseline](https://arxiv.org/html/2604.01733v1) — RRF hybrid improves over both constituents across metrics and subsets.
