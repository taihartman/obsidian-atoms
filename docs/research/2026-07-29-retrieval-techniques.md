# Retrieval techniques for the shortlist stage — what to try first

**Date:** 2026-07-29
**Question:** BM25 over title + ~200 chars of body shortlists ~400 of 3,000 notes at 79–88% recall. The dominant failure is vocabulary mismatch. What fixes it, locally, in TypeScript, on a phone?
**Method:** literature review against primary sources, cross-checked against this repo's own measurements in `docs/research/data/`.

---

## Recommendation

Do these in order. Each one is a separate, measurable experiment. Stop when recall stops moving.

| # | Change | Expected effect | Cost | Confidence |
|---|---|---|---|---|
| 1 | **Index more of the body** than the first 200 chars | Largest single lever available. Mean body is 1,943 chars — we index ~10% of the corpus and then wonder where the vocabulary went | Build time, ~166ms → est. 0.5–1.5s at 3,000 notes; heap grows from 23.7MB | High |
| 2 | **BM25F over title / tags / body as weighted fields**, replacing the current title+prefix concatenation | Fixes a real modelling bug (see §4), unlocks per-field tuning, and lets tags carry weight | ~60 lines, no new memory | High |
| 3 | **Index the LLM-generated tags and link titles as their own field** | This is doc2query for free. The pipeline already pays a model to write tags/links per atom; those are exactly the "new vocabulary" doc2query buys with a T5 | Near zero — the data already exists | High |
| 4 | **RM3 / Rocchio pseudo-relevance feedback**, tuned for recall only | The textbook fix for vocabulary mismatch, and the usual objection to it (query drift kills precision) does not apply to a 400-wide shortlist | ~80 lines, 2× query time = 0.04ms | Medium-high |
| 5 | **Wikilink 1-hop expansion** — pull neighbours of top BM25 hits into the shortlist | Second-order association built from human-authored signal instead of estimated from 3,000 notes | ~30 lines, zero build cost | Medium, untested by anyone |
| 6 | **NPMI co-occurrence thesaurus**, tiny fan-out, heavily down-weighted | Might catch idiolect synonymy ("guts"/"stomach"). Will not catch world knowledge | ~300 lines, ~250KB artifact | Low-medium |

**Do not build:** LSA/LSI, Random Indexing, SPLADE, local doc2query. Reasons in §2 and §3. Each costs 5–80× the memory budget or requires a model download, and every one of them reaches a mechanism that item 5 or 6 reaches for a fraction of the price.

**The honest limit.** Split the motivating example in two. *"guts in bits" → "stomach"* is idiolect synonymy; corpus statistics can plausibly learn it if both words appear in your vault in similar company. *"thai place" → "onions"* is **world knowledge** — no statistic computed over 3,000 personal notes recovers it unless you literally wrote down that the Thai place uses onions. Items 1–6 will not solve that half. The only things that do are an LLM in the loop (query expansion at classify time, or index-time document expansion using the API the pipeline already calls) or dense embeddings. Both are out of scope by the brief; say so explicitly rather than expecting a co-occurrence matrix to know about Thai cooking.

---

## §0 What our own measurements already settle

Before any literature: `docs/research/data/2026-07-28-shortlist-recall.json`, `bodyPlusTitle` selector, 3,000-note vault, 80 probes.

| k | recall | mean rank when found |
|---|---|---|
| 40 | 0.900 | 3.3 |
| 100 | 0.912 | 4.2 |
| 200 | 0.925 | 5.9 |
| 400 | 0.950 | 11.9 |
| 800 | 0.963 | 21.2 |

**Doubling k from 400 to 800 buys 1.3 points.** When BM25 finds the note it lands at rank ~12; when it misses, it misses absolutely — score zero, no shared terms, no rank at all. Three consequences that constrain everything below:

1. **Recall must come from adding terms, not from widening k.** Every technique in this document is worth evaluating solely on whether it moves a zero-score document to nonzero. Re-ranking work is wasted.
2. **Query drift is nearly free.** The literature's case against pseudo-relevance feedback is precision damage in a top-10 a human reads. We ship 400 slots to an LLM and use ~12 of them. There are ~388 wasted slots and no human reading the tail. This inverts the standard risk calculus, and it is the single strongest argument for trying PRF here.
3. **The compute budget is not the binding constraint.** `2026-07-28-index-feasibility.json`: at 3,000 notes, build 166ms, query **0.02ms**, heap 23.7MB, 7,679 distinct terms. Query time has a 2,500× margin against the 50ms budget. A two-pass PRF costs 0.04ms. Stop optimising query time; spend it.

Two caveats to keep honest. **n = 80 probes**, so a 5-point recall difference is roughly the noise floor — treat sub-5-point wins as unmeasured. And the real-vault run (`2026-07-28-remote-vault-shortlist.json`) has 373 notes, where recall@400 is 1.0 by construction; the 3,000-note numbers are synthetic. Recall@400 on a real 3,000-note vault has not actually been measured.

---

## §1 Pseudo-relevance feedback (RM3, Rocchio)

**What it is.** Run BM25, assume the top ~10 hits are relevant, harvest their distinctive terms, add them to the query at reduced weight, re-run. RM3 is the language-model formulation (interpolate a relevance model estimated from feedback documents with the original query model); Rocchio is the vector-space ancestor. No precomputed artifact, no build step, no persistent memory — a second pass over the index we already have.

**Do the gains hold up?** Yes in aggregate, and on short queries specifically. Anserini's Robust04 regression — title-length topics, mean ~2.6 words, so genuinely short queries — puts BM25 at MAP ≈ 0.253 and BM25+RM3 at **MAP 0.2903**, about +15% relative. That gain is *larger than most published neural reranking gains on the same collection*, which is the entire thesis of Yang, Lu & Lin's "Critically Examining the Neural Hype." Manning's IIR chapter 9 says PRF "mostly works … evidence suggests that it tends to work better than global analysis," i.e. better than a corpus-wide thesaurus (§3).

**Failure modes, stated plainly.** The per-query variance is bad. On Robust04 at R@1000, RM3 **hurts 47 queries and helps 139**. Collins-Thompson's Robustness Index over 700 queries: 0.34–0.48 on TREC news (so ~27% of queries damaged even in the best case), and **−0.027 on wt10g — net negative despite a +5.2% mean MAP gain**. Billerbeck & Zobel on TREC-9 web found "around half of the queries degraded and less than a third improved," and — the part that matters — **no predictor of when it will help works**: not baseline AP, not term specificity, not query clarity. Their canonical failure case is a query that was already good getting worse.

There is also a structural objection specific to us: PRF assumes the top-k feedback documents are mostly relevant. In known-item retrieval there is exactly **one** relevant note, so k−1 feedback documents are non-relevant by construction. This is why RM3 is not a standard component on MS MARCO.

**Why it is still the right call here.** Every horror story above is measured on precision metrics over a ranked list a human reads. Read them again as recall@400 and they mostly evaporate — a drifted expansion term adds junk to slots 13–400 that were already junk. Kuzi et al. (SIGIR 2017), the one study on real personal email, found PRF the *most robust* of the expansion methods they tried precisely because it stays query-dependent rather than baking a static thesaurus.

**Parameters for very short queries.** Anserini/Lucene defaults: 10 feedback documents, 10 expansion terms, original query weight 0.5. The RM3 literature commonly reports 3 docs / 10 terms / λ = 0.6. For a single-relevant-item task with a 400-wide output I would start **conservative on documents and generous on terms**: 3–5 feedback docs, 10–20 terms, original query weight **0.7–0.8** (higher than standard — the original capture text is the only trustworthy signal, and we can afford to add terms cheaply but cannot afford to dilute the query). Tune on recall@400 and nothing else.

**Implementation difficulty: low.** ~80 lines. Term selection is a weighted sum of feedback-document term frequencies, IDF-weighted, top-N. No new data structures, no build cost, no memory. Two BM25 passes at 0.02ms each.

**Verdict: worth trying — item 4, after the free wins.** It is the cheapest non-trivial thing on this list, it is the classic answer to this exact problem, and our shortlist shape neutralises its known weakness. Prefer **Rocchio over RM3** if you want one: Lin's group found Rocchio's MAP significantly better (p < 0.01) than RM3 on TREC DL 2019 under all settings, and it is simpler to implement correctly. Measure recall@400 only; ignore any precision metric, and do not be alarmed when mean rank gets worse.

---

## §2 Learned sparse retrieval (SPLADE, doc2query/docTTTTTquery, DeepImpact)

**What it is.** Two families. **Document expansion** (doc2query, docTTTTTquery) runs a seq2seq model over each document at index time, generates plausible queries for it, appends them to the document text, and rebuilds an ordinary inverted index — query time stays pure BM25. **Learned term weighting** (SPLADE, DeepImpact) replaces BM25's tf-idf with BERT-predicted term weights over an expanded vocabulary, and SPLADE also expands the query with a neural encoder at query time.

**Are the gains real?** For document expansion, yes, and they are measured on exactly our metric. MS MARCO passage dev: BM25 **MRR@10 0.184, recall@1000 0.853** → docTTTTTquery **MRR@10 0.277, recall@1000 0.947**. That is +9.4 points of absolute recall, a ~64% reduction in recall error, from expansion alone with the retrieval algorithm unchanged. It is the strongest evidence in this document that vocabulary mismatch is fixable by adding terms to documents. The mechanism is partly reweighting rather than new vocabulary — the reported copied-to-new term ratio is **69:31** — so roughly two-thirds of the benefit is "say the important words again," which is a term-weighting effect, not a semantic one.

**But the model is the whole technique.** docTTTTTquery is T5-base. SPLADE and DeepImpact are BERT. None of this runs in an Obsidian mobile webview, and the brief rules out model downloads. The "inference-free" LSR line (LI-LSR, 2025) reduces *query* encoding to a dictionary lookup of learned per-token weights — but that dictionary is still the output of a training run over a labelled corpus you do not have, and it does nothing about document-side expansion.

Also worth knowing before anyone gets excited: doc2query's own follow-up, **Doc2Query-- (ECIR 2023)**, found the technique hallucinates enough that filtering the generated queries with a relevance model improves effectiveness by **up to 16%** while cutting index size 33% and query time 23%. The unfiltered version is actively adding noise. Any expansion scheme we build needs the same scepticism about its own output.

**The part that is feasible, and free.** Strip the model out and ask what doc2query actually *does*: it attaches short, query-like, human-vocabulary strings to each document at index time and lets BM25 do the rest. **This pipeline already produces exactly that artifact.** Every atom gets an LLM-authored declarative title, tags, and reason-bearing link text — the model output surface named in `CLAUDE.md`. Those are doc2query outputs generated for a cost we have already paid. If the shortlist index does not currently give tags and link prose their own weighted field, we are throwing away the one genuinely model-derived expansion signal in the system. That is recommendation #3, and it is the highest value-per-line item in this document.

**Implementation difficulty:** for the free version, trivial — it is a field-weighting change (§4). For real SPLADE/doc2query, infeasible under the constraints.

**Verdict: the model-based versions, no. The idea underneath them, yes, and it costs nothing.** Index the LLM-generated tags and link titles. If you later want more, an index-time expansion call against the API the plugin already uses is a legitimate doc2query analogue — one-time, bounded, and it keeps query time fully local — but that is a product/cost decision outside this brief, and it should be gated on Doc2Query--'s finding that unfiltered generated expansions hurt.

---

## §3 Statistical term association without a model

**What it is.** Estimate term relatedness from the vault's own text: first-order co-occurrence scored by PMI/NPMI/log-likelihood; second-order similarity (cosine between terms' context vectors); LSA/LSI (truncated SVD of the term-document matrix); Random Indexing. Then expand the query with each term's nearest neighbours.

**The decisive fact is corpus size, and it is worse than it looks.** At title + 200 chars, we are estimating association statistics from roughly **120k tokens**. Even over full bodies (mean 1,943 chars) it is ~1M tokens. Church & Hanks computed PMI on a **44M-word** corpus and still discarded every pair with count ≤ 5 as unstable, warning that corpora "of only a million words or so … are reliably informative for only the most common uses of the few most frequent words of English." We are at or below that line by one to two orders of magnitude.

The one study that measures stability at our exact scale is Antoniak & Mimno (TACL 2018), who ran 50 models each of PPMI, LSA, GloVe and SGNS over bootstrap resamples of small corpora including **NYT Music: 3,666 documents**. They report *"cases in which there is zero set overlap in 'top 10' lists for the same query word across bootstrap samples"* and conclude that small cosine differences "are not reliable, especially for small corpora." Their corpus was ~2.6M tokens — 20× ours — and they still used a min-count of 20.

**Measure-by-measure, briefly:**

- **Raw PMI: do not use.** Manning & Schütze prove it is "a good measure of independence but a bad measure of dependence" — among perfectly dependent pairs, the score *rises* as the pair gets rarer. Jurafsky & Martin: "PMI has the problem of being biased toward infrequent events."
- **χ² and z-score: formally invalid here.** Dunning's validity criterion is np(1−p) > 5; on a 0.5M-word corpus he found 2,682 of 2,693 bigrams outside the scope of the normal test. Our expected co-occurrence counts are four orders of magnitude inside the invalid regime.
- **NPMI or log-likelihood ratio: the only usable options.** Bouma's NPMI normalises to a fixed [−1, +1] scale independent of frequency, which is the only variant you can threshold interpretably. Dunning's LLR approaches its asymptote fast enough to extend validity "to much smaller texts." Both still need a hard count cutoff — and at our scale a cutoff of f ≥ 5 deletes most pairs, which is Church & Hanks's warning restated as an engineering problem.
- **Context distribution smoothing (α = 0.75)** is the best-supported single knob against low-frequency bias — Levy, Goldberg & Dagan call it "a consistent improvement at an insignificant risk" — but their corpus was 1.5 **billion** tokens with an f ≥ 100 cutoff. The mechanism transfers; the numbers absolutely do not.

**The IR-specific objection is worse than the statistical one.** Manning's IIR chapter 9 says of automatic thesauri: *"since the terms in the automatic thesaurus are highly correlated in documents anyway (and often the collection used to derive the thesaurus is the same as the one being indexed), this form of query expansion may not retrieve many additional documents."* That is precisely our setup. And Peat & Willett showed co-occurrence-derived expansion terms skew high-frequency, which discriminate poorly — in a personal vault the high-frequency vocabulary is your own idiolect ("again", "place", "felt"), so the effect is amplified.

**The head-to-head that settles the ordering.** Xu & Croft measured a global co-occurrence thesaurus against local (feedback-based) analysis directly: the global thesaurus bought **+7.8% / +3.4%** on TREC3/TREC4, versus **+23.3% / +23.5%** for Local Context Analysis. The global method costs the most to build and delivers the least. That is the empirical basis for putting PRF (§1) ahead of a thesaurus.

Qiu & Frei is the one paper that varied collection size, and it points the wrong way for us: MED (1,033 docs) +18.3%, CACM (3,204 docs) +22.9%, NPL (11,429 docs) +29.2% — with the authors' own explanation that thesaurus quality improves with collection size. They also added 80–800 expansion terms per query, not 3.

**LSA/LSI: not worth it.** Deerwester 1990 tested exactly two collections: MED (1,033 docs) at .51 vs .45 average precision — "a 13% improvement" — and CISI (1,460 docs) at **.11 for both LSI and term matching**, zero gain, with SMART beating LSI at odds >1000:1. The authors flagged their own winner: MED "was specially constructed in a way that may have resulted in unrealistically good results … probably not the way most natural document collections are structured." Their diagnosis of the failure case — "a very homogeneous distribution of documents that is hard to differentiate" — is a fair description of a personal vault. At scale it collapses outright: Atreya & Elkan's "Latent Semantic Indexing Fails for TREC Collections" reports LSI MAP .024–.086 against BM25's .190–.253, and they swept k from 10 to 300 to kill the "k was too small" defence. IIR's verdict: LSI "has not been established as a significant force in scoring and ranking for information retrieval."

Cost seals it. No usable JS library exists — `ml-matrix` and `svd-js` are dense Golub-Reinsch, and a dense 7,679 × 3,000 float64 matrix plus O(mn²) work is not happening in a webview. A hand-rolled randomised SVD gives no asymptotic win over Lanczos on sparse input (Halko/Martinsson/Tropp are explicit about this) and lands at roughly 1–5s on a phone core, over budget. Rank-100 term vectors are ~8MB as float32.

**Random Indexing / Reflective RI: not worth it.** Kanerva's *document*-based RI — the configuration a note vault would naturally use — scored **48–51% on TOEFL synonyms against LSA's 64%**; the "RI matches LSA" claim comes from sliding-window RI (64–72%), which is a different build. Plain RI provably does not bridge indirect association: Cohen, Schvaneveldt & Widdows state that "the original implementation of RI is ineffective at inferring meaningful indirect connections." Reflective RI genuinely fixes that — precision@10 of 0.40 vs 0.06 for a TF-IDF baseline on predicting future MEDLINE co-occurrences, a 5–7× effect — but that was **1.6 million** biomedical abstracts with the MeSH controlled vocabulary, it is never benchmarked numerically against LSA, and its authors cite contrary evidence that reflective retraining does not improve TOEFL synonymy, which is closer to our actual failure. Memory is fatal anyway: 7,679 terms × 2,000 dims × 4 bytes ≈ 61MB dense, and RI's whole justification is that d must be large enough for near-orthogonality.

RI's real advantage is incrementality at scale — a new document is a few vector additions, no refactorisation. We rebuild 3,000 notes in 166ms. We would be paying for a property we do not need.

**Second-order cosine over PPMI context rows: the one member of this family worth a look, and only after §1 and §2.** It is the mechanism that bridges terms which never co-occur, it needs no SVD (Levy et al. found explicit PPMI vectors competitive with SVD once hyperparameters matched), and with only 7,679 terms the all-pairs cost is manageable via a context-inverted index. Persist it as a sparse top-N thesaurus (~250KB), never as dense vectors. Antoniak & Mimno's instability finding applies in full, so: fan-out of 2–3 neighbours, weight ~0.25 of an original query term, hard count threshold.

**Implementation difficulty:** NPMI thesaurus easy (~300 lines, ~250KB artifact, well inside budget). Second-order cosine moderate (~500 lines, build-time scratch is the concern, runtime artifact is the same 250KB). LSA and RI: hard and over budget.

**Verdict: NPMI as item 6, second-order cosine as an optional item 7, everything else no.** Build the association statistics over **full bodies** even if BM25 indexes a prefix — nothing forces them to share a text extent, and at 120k tokens you are estimating from nothing. If NPMI and second-order cosine both add nothing, the family is dead at this corpus size and you should stop rather than escalating to SVD.

---

## §4 BM25 variants and tuning

**BM25F.** Robertson, Zaragoza & Taylor's "Simple BM25 extension to multiple weighted fields" (CIKM 2004) makes a point that applies directly to a bug we may already have. Scoring fields independently and combining linearly "can lead to poor performance by breaking the carefully constructed non-linear saturation of term frequency in the BM25 function." The fix is to weight term frequencies **before** saturation: a title with weight 2 is treated as an unstructured document with the title text repeated twice, then scored normally. Concatenating "title + first 200 chars of body" into one string is a degenerate BM25F with all weights at 1 — which means a term in the title is currently worth exactly as much as a term buried in the body prefix, and there is no way to say otherwise. The known difficulty is that field weights must be tuned, and we have 80 probes to tune on, so keep the field count small: **title / tags+links / body**, three weights, coarse grid.

**Parameters for very short documents.** Standard defaults are k1 = 1.2 (or Lucene's 0.9) and b = 0.75 (Lucene 0.4). Guidance for our shape:

- **k1** controls tf saturation. With documents this short a repeated term is a strong signal but there is barely any repetition to saturate, so k1 matters less than usual. Elastic's practical guidance puts short focused documents at the low end, k1 ≈ 0.5–1.0. Anserini's MS MARCO passage tuning — short passages, short queries, our closest public analogue — landed at **k1 = 0.82, b = 0.68 optimising recall@1000** and k1 = 0.60, b = 0.62 optimising MRR@10. Note the recall-optimal and precision-optimal settings differ; we care only about the first.
- **b** controls length normalisation. Truncating every document to 200 chars artificially flattens the length distribution, so b currently does almost nothing. **Once you index full bodies (item 1), b starts mattering a great deal** — bodies range from short captures to 5,793 chars at p90, a 20×+ spread, and without proper normalisation long notes will dominate the shortlist. Re-tune b immediately after that change; do not carry the current value forward.

**Are the gains real?** Modest and reliable. Anserini's own MS MARCO tuning moves recall@1000 from 0.8526 (defaults) to 0.8573 (tuned) — **+0.5 points**. That is the honest size of pure parameter tuning: real, cheap, and an order of magnitude smaller than what expansion buys. Do not expect tuning to close a vocabulary-mismatch gap; it cannot, by construction, because it never adds a term to a zero-score document.

**Implementation difficulty: low.** BM25F is ~60 lines over an existing BM25 — accumulate weighted pseudo-tf per term across fields, then apply the saturation once. Parameter tuning is a grid search over the existing 80-probe harness.

**Verdict: worth doing, as plumbing rather than as the fix.** BM25F is item 2 because it is the enabler for item 3 (tags need their own weight) and item 1 (body length needs its own normalisation), not because field weighting alone will move recall much. Retune k1/b after the body change, on recall@400, and expect ~1 point.

---

## §5 How to know whether any of this worked

The existing harness (`docs/research/data/2026-07-28-shortlist-recall.json`, 80 probes) is the right instrument but is underpowered for the effect sizes in play. Before building anything:

1. **Grow the probe set**, and specifically stratify it by failure mode. The interesting population is *the queries BM25 currently scores at zero* — roughly 8–10% of probes. At n = 80 that is 6–8 cases, which cannot distinguish a real fix from noise. Harvest 30+ genuine vocabulary-mismatch pairs from the real vault before touching code.
2. **Report recall@400 and nothing else.** Mean-rank-when-found will get worse with every technique here and that is fine.
3. **Report recall on the zero-score subset separately** from overall recall. Overall recall will move by 1–3 points even when the technique works, because 90% of queries were already fine; the subset number is the actual signal.
4. **Bootstrap-resample the notes and recompute** before trusting any co-occurrence artifact (§3). At 3,000 notes that is not a nicety — it is the difference between a thesaurus and a random number generator.

---

## Sources

Pseudo-relevance feedback
- [Yang, Lu & Lin, *Critically Examining the "Neural Hype"* (SIGIR 2019)](https://arxiv.org/pdf/1904.09171) — BM25+RM3 MAP 0.2903 on Robust04
- [Anserini Robust04 meta-analysis](https://github.com/lintool/robust04-analysis)
- [Manning, Raghavan & Schütze, *IIR* ch.9 — Relevance feedback and query expansion](https://nlp.stanford.edu/IR-book/pdf/09expand.pdf)
- [Collins-Thompson, *Reducing the risk of query expansion via robust constrained optimization*](https://websites.umich.edu/~kevynct/pubs/ir0537-collinsthompson.pdf) — Robustness Index, wt10g net-negative
- [Billerbeck & Zobel, *Questioning query expansion: an examination of behaviour and parameters* (ADC 2004)](https://people.eng.unimelb.edu.au/jzobel/fulltext/adc04.pdf)
- [*Simple Yet Effective Pseudo Relevance Feedback with Rocchio's Technique*](https://dspacemainprd01.lib.uwaterloo.ca/server/api/core/bitstreams/22034c4d-79d3-4355-b711-17b8b78f0171/content)
- [Kuzi, Carmel, Libov & Raviv, *Query expansion for email search* (SIGIR 2017)](https://dl.acm.org/doi/10.1145/3077136.3080660)

Learned sparse retrieval / document expansion
- [Nogueira & Lin, *From doc2query to docTTTTTquery*](https://cs.uwaterloo.ca/~jimmylin/publications/Nogueira_Lin_2019_docTTTTTquery-v2.pdf) — MRR@10 0.277, R@1000 0.947
- [Gospodinov, MacAvaney & Macdonald, *Doc2Query--: When Less is More* (ECIR 2023)](https://arxiv.org/abs/2301.03266)
- [Formal et al., *SPLADE v2*](https://arxiv.org/abs/2109.10086)
- [*Effective Inference-Free Retrieval for Learned Sparse Representations* (2025)](https://arxiv.org/pdf/2505.01452)

Statistical term association
- [Antoniak & Mimno, *Evaluating the Stability of Embedding-based Word Similarities* (TACL 2018)](https://aclanthology.org/Q18-1008/)
- [Church & Hanks, *Word Association Norms, Mutual Information, and Lexicography* (1990)](https://aclanthology.org/J90-1003/)
- [Dunning, *Accurate Methods for the Statistics of Surprise and Coincidence* (1993)](https://aclanthology.org/J93-1003/)
- [Bouma, *Normalized (Pointwise) Mutual Information in Collocation Extraction*](https://svn.spraakdata.gu.se/repos/gerlof/pub/www/Docs/npmi-pfd.pdf)
- [Levy, Goldberg & Dagan, *Improving Distributional Similarity with Lessons Learned from Word Embeddings* (TACL 2015)](https://aclanthology.org/Q15-1016/)
- [Xu & Croft, *Improving the effectiveness of information retrieval with local context analysis* (TOIS 2000)](https://dl.acm.org/doi/10.1145/333135.333138)
- [Qiu & Frei, *Concept based query expansion* (SIGIR 1993)](https://www.ubilab.org/publications/print_versions/pdf/qiu93.pdf)
- [Deerwester et al., *Indexing by Latent Semantic Analysis* (1990)](https://www.cs.csustan.edu/~mmartin/LDS/Deerwester-et-al.pdf)
- [Atreya & Elkan, *Latent Semantic Indexing (LSI) Fails for TREC Collections*](https://cse.iitk.ac.in/users/cs671/2013/hw3/atreya-elkan-11_latent-semantic-indexing-fails-for-TREC.pdf)
- [Kanerva, Kristofersson & Holst, *Random Indexing of Text Samples for LSA* (2000)](https://escholarship.org/uc/item/5644k0w6)
- [Cohen, Schvaneveldt & Widdows, *Reflective Random Indexing and indirect inference* (JBI 2010)](https://www.sciencedirect.com/science/article/pii/S1532046409001208)
- [Halko, Martinsson & Tropp, *Finding Structure with Randomness*](https://arxiv.org/abs/0909.4061)

BM25 variants and tuning
- [Robertson, Zaragoza & Taylor, *Simple BM25 extension to multiple weighted fields* (CIKM 2004)](https://dl.acm.org/doi/10.1145/1031171.1031181)
- [Anserini MS MARCO passage regressions](https://github.com/castorini/anserini/blob/master/docs/experiments-msmarco-passage.md) — tuned k1=0.82, b=0.68 for recall@1000
- [Elastic, *Practical BM25 part 3: picking b and k1*](https://www.elastic.co/blog/practical-bm25-part-3-considerations-for-picking-b-and-k1-in-elasticsearch)

Personal / known-item search context
- [Dumais et al., *Stuff I've Seen* (SIGIR 2003)](https://sigir.org/files/forum/2015D/p028.pdf) — mean query 1.59 words
- [Elsweiler, Harvey & Hacker, *Understanding re-finding behavior in naturalistic email interaction logs* (SIGIR 2011)](https://epub.uni-regensburg.de/22696/1/sigir2011_email_logs.pdf)
- [Kim & Croft, *Retrieval experiments using pseudo-desktop collections* (CIKM 2009)](https://maroo.cs.umass.edu/getpdf.php?id=871)
- [Bendersky et al., *Personal search* survey (2025)](https://arxiv.org/pdf/2412.12330)
