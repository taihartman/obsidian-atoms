---
handoff_date: 2026-07-29
branch: claude/catch-up-cost-study
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
base: master
tracking: https://github.com/taihartman/obsidian-atoms/issues/168
supersedes: docs/handoffs/2026-07-28-catch-up-cost-study.md
status: research complete, implementation not started
---

# Handoff — shortlist retrieval is measured and settled; model choice is not

Read this top to bottom, run **How to resume**, then start at **Next steps**. Do not re-derive
anything under "Established" — it is measured, committed, and reproducible. The previous handoff
(`2026-07-28-catch-up-cost-study.md`) is superseded; its cost figures are corrected here.

## Where this got to

The prior session's question was "what does a classify call cost." That is answered. Answering it
turned up a much bigger finding: **the note-title context is both too expensive and badly chosen**,
and fixing the choosing fixes the cost. All of that is now measured. **No plugin code has been
changed.** Everything lives in `scripts/` and `docs/`.

## Established — do not re-derive

### Cost (research doc §0, `docs/research/2026-07-28-classify-prompt-cost-measurement.md`)

- A 3,000-title vault classify request is **52,930 billed input tokens**, not the ~2,950 the #168
  plan assumed. A note title costs **16.47 tokens** (2.56 chars/token) — the old chars÷4 estimate
  was 39% low.
- The structured-output schema is billed (**841 tokens**) and `countTokensForClassifyRequest`
  (`backfill.ts:140`) strips `output_config` before counting, so the user-facing cost gate
  undercounts every request.
- Prompt caching **holds in full at a 52,868-token prefix** — 33× the prior evidence.
- Batch API caching works, but an unwarmed job pays 17 duplicate cache writes (83/100 hit rate,
  75% of the bill). **One realtime call before submitting the batch gives 100/100 and zero writes.**
- `ASSUMED_OUTPUT_TOKENS = 250` (`backfill.ts:50`) should be **280** (measured mean 278.8, n=100).

### Retrieval quality (`docs/plans/2026-07-28-004-research-shortlist-quality-experiment.md`)

- **Score the shortlist on note BODIES, not titles.** An atom's body is the user's verbatim capture;
  matching their words to their own past words beats matching them to the model's paraphrase.
  Vocabulary-mismatch recall goes **10% → 100%**; overall **69% → 95%** at k=400.
- Through the **real `classifyCapture`** (enrichment included), link rates are: uncapped 86%,
  `bodyPlusTitle:400` **88%**, `bodyPlusTitle:40` 84%, `alphabetical:40` **0%**. Capped and uncapped
  are **indistinguishable at n=80** — the earlier "capping costs 4 points" claim did not survive.
- Capping does **not** make the model invent links (2 on cold-start probes at every k).
- Index only the **first ~200 chars** of each body: 1.8MB and 21ms at 3,000 notes, and *better*
  recall than full bodies (long bodies add noise BM25 penalises). Mobile is not a blocker.

### Chronological chunking (same doc, "Results — chronological simulation")

- Today's frozen list loses **811 in-run links** across 576 atoms (1.4/atom), median reach-back
  **98 days**, longest 1,084. An atom created during a catch-up is invisible to every other capture
  in it.
- **Monthly chunks are $18.81 and recover 71% of those links; today is $30.79 and recovers 0%.**
  Weekly is $23.18 / 79%. Per-capture shortlisting is the *worst* option costed ($52.26) — it
  forfeits the cache for no gain over weekly.
- Reachability is set by chunk **duration** vs link gap in days (density-independent); union size by
  **atoms per chunk** (density-dependent). Calendar chunks separate them; capture counts conflate.
- **Correction:** an earlier conclusion that "blocks are dead" was an artefact of measuring union
  growth on the deliberately-unclustered 84-probe corpus. On dated captures a weekly union is 897
  titles, not 3,000.

### Two live defects, unfiled

1. **Plus filing hard-fails on large vaults.** `buildClassifyPayload`
   (`plus-service/src/anthropic.mjs:94`) rejects bodies over 100,000 bytes, and the plugin sends the
   title list twice — as `context` *and* inside `messagesRequest`, which the proxy explicitly
   ignores (`classify.ts:573-581`). Threshold is title-length dependent: 985 notes at 42-char
   titles, **1,581 for the owner's vault** (21.2-char mean, currently at 28,818 of 100,000 bytes).
   A 3,000-atom catch-up would put that vault at 205,210 bytes and break filing outright — **the
   feature triggers the bug.** Not yet reproduced against the live service.
2. **Plus sends the alphabetically-first 40 titles.** `boundContext` truncates to
   `ATOMS_PLUS_MAX_CONTEXT_TITLES` (default 40, no override anywhere) and `buildVaultContext` sorts
   alphabetically first. Measured **0% link rate**, 68–72 regressions against uncapped. On the
   owner's real vault, 89% of notes are invisible to Plus filing today.

### Research (2026-07-29)

- **Graph expansion** (`docs/research/2026-07-29-graph-expansion.md`): worth trying, expect **+3 to
  +8 points**, not a transformation — published gains are recall@2/@5 and conflate reranking with
  reaching; only reaching transfers at recall@400. Build **2-hop decayed BFS, not PPR**; fuse with
  RRF into **reserved slots** (~340 BM25 + ~60 graph-only, never displacing the top 100). Don't
  traverse *through* hub notes. GraphRAG/LightRAG rejected (LLM-extracted, network-bound).
  **Run catch-up graph-blind** — a run creating the links it retrieves over is a closed feedback loop.
- **On-device embeddings: no** (`docs/research/2026-07-29-ondevice-and-providers.md`). Obsidian
  mobile is a Capacitor WebView with no cross-origin isolation (single-threaded WASM) in a
  300–450MB budget; iOS kills on *allocation rate*, which is the shape of a batch embed. Smart
  Connections defers behind a manual tap on mobile; VaultSearch went desktop-only.
- **Open weights: non-starter.** 3.4–6.6GB in a WebView, or an Ollama server that is desktop-only.
- **Free win:** fold tags, aliases and link anchor text into the BM25 field (document-side
  expansion). And k=400→800 is only ~+0.35¢/capture — shortlist budget is cheap.
- **Retrieval** (`docs/research/2026-07-29-retrieval-techniques.md`): **misses are absolute, not
  ranking failures.** Mean rank when found is ~12, and k=400→800 buys 1.3 points — a missed note
  scores *zero*, so recall can only come from **adding terms**, never from widening k. Order to try:
  (1) index more body text; (2) BM25F with separate title/tags/body weights; (3) **index the
  LLM-written tags and link prose — that is doc2query for free**, since the pipeline already pays a
  model to generate them; (4) pseudo-relevance feedback (Rocchio over RM3, +15% MAP on short
  queries; its usual weakness — drift hurting precision — is nearly free when 388 of 400 slots sit
  unused; query cost 0.02ms). Learned sparse (SPLADE/docTTTTTquery) is out because the model *is*
  the technique, but it has the strongest evidence here (recall@1000 0.853→0.947), which is exactly
  why the free tags-as-expansion version ranks so high. Statistical term association is too weak at
  this scale (~120k indexed tokens; Antoniak & Mimno measured *zero* bootstrap overlap in top-10
  neighbour lists on a corpus 20× larger) — NPMI/LLR only if at all, never raw PMI; skip LSA and
  Random Indexing (4–80× over the memory budget).

### Corrections to earlier findings in this same branch

- **The 200-char body truncation is not established.** Its recall advantage (97% vs 93%) rests on
  **one link out of 30** on the real-vault run — inside the noise floor. Mean body is 1,943 chars, so
  truncating discards ~90% of the text, and since misses are *zero-score* discarding text can only
  reduce the chance of a term match. The memory case that motivated it is also weak now: 23.7MB for
  full bodies sits inside a 300–450MB page budget. **Revisit and index more, not less.**
- **The noise floor is ~5 points at n=80 probes.** Every selector and model comparison closer than
  that — 86% vs 88%, 84% vs 85% — is indistinguishable. Grow the probe set (specifically on
  zero-score queries) before building anything on a small gap.
- **`recall@400` on a genuinely 3,000-note real vault has never been measured.** The real-vault run
  had 373 notes, where k=400 is not a cap at all. The 3,000-note figures are all synthetic.
- "thai place → onions" is **world knowledge**, not vocabulary mismatch — no local statistic solves
  it. Body scoring caught that probe via the shared word "guts", not by any inference.

### One dataset was lost — know this before reading the raw JSON

`measure-link-quality.mjs` was run twice: once against the raw API ($11.76) and once through the
real `classifyCapture` (`--via-pipeline`, $11.38). Its `valueOf` only accepted `--out=path`, not
`--out path`, so the second run silently fell back to the default filename and **overwrote the
first run's per-probe results**. Fixed (the parser now takes both forms) and the surviving file is
renamed `data/2026-07-28-link-quality-pipeline.json` to say what it actually holds.

**What survives:** both runs' summary tables, in the plan doc's "Results — step 4" and "step 4b"
sections, and in commits `2155f06` / `15c1278`. **What is gone:** the raw-API run's per-probe
detail. Re-running costs ~$12 if it is ever needed; it is not needed for any current conclusion,
because the pipeline run is the one that reflects shipped behaviour.

## Session 2026-07-29b — what changed since this doc was written

- **Next step 1 is done.** `docs/research/2026-07-29-hop-distance.md` +
  `scripts/measure-hop-distance.mjs` (`npm run measure:hops`). Graph expansion **survives**:
  hub-blocked 2-hop reaches 47% of the zero-score misses at 25 seeds (+11 points of recall@400),
  for ~85 extra shortlist slots. But **only for daily filing** — in a graph-blind catch-up the only
  edges are atom→hub, so every recovery is hub-mediated and hub-blocked reach is 0% by
  construction. ~40–50% of misses are in another component and unreachable at any depth.
- **Next step 3, the best free lever, is done.** `docs/research/2026-07-29-doc-expansion.md` +
  `scripts/measure-doc-expansion.mjs` (`npm run measure:expansion`). Indexing the model's link
  prose is **+16 links won / 0 lost** at k=400 (p<0.0001) — strictly dominant, +2 points at k=400
  and +5 at k=40 with the link field weighted ×3. It is a **floor**: the corpus's link prose is
  only hub titles, not the real reason-bearing sentences plus tags.
- **Item 3 below is resolved.** Sonnet 5 is $3/$15 with an introductory $2/$10 **through
  2026-08-31** — the secondary source was right. Opus 5 is $5/$25, Haiku 4.5 $1/$5.
- **Haiku 4.5 does *not* accept `output_config.effort`** — it errors, as it does on Sonnet 4.5.
  The bake-off harness must omit the field on that arm.
- **`classify.ts` sends no `temperature`/`top_p`**, so it is already Sonnet-5/Opus-5 clean (both
  reject non-default sampling params). Prefills are also absent.
- **BLOCKED: every real-vault measurement.** `analyze-vault-shortlist.mjs --hops` is written and
  read-only, but the sandbox permission classifier refuses to read `~/Documents/Remote Vault`.
  That blocks the hop cross-check, the tags-as-expansion test, and the 200-char body question.

## Not established — the actual work

1. **Model and effort.** Blocked on a fresh API key. See Next steps 2.
2. **Can graph expansion reach what BM25 misses?** One cheap measurement decides it — see Next
   steps 1.
3. **Sonnet 5 pricing reportedly leaves introductory rates on 2026-08-31** ($2→$3 in, $10→$15 out).
   Every dollar figure here uses $3/$15, so they are ~1.5× high today and correct from September.
   **Verify at source** — this came from a secondary source.
4. **OpenAI cache terms.** Reported as automatic caching, free writes, 24h retention vs Anthropic's
   1h max. If true this favours OpenAI for *daily filing* (captures arrive hours apart, so
   Anthropic's cache usually misses). Contradicts an earlier shallow search that said 5–10 minutes.
   Verify at source before it influences anything.
5. **The 10-point conversion gap.** Given a perfect shortlist the model still only links ~86-90%.
   That is prompt work, orthogonal to retrieval, and is the largest remaining pool.
6. Nothing has been reproduced against the **live** Plus service (needs a session token).

## Next steps

1. **Measure hop distance, then decide on graph expansion.** For each gold link, how many hops
   separate BM25's top-10 from the target — **excluding the edge being predicted**, or it is
   circular. If most misses are ≥3 hops or in another component, expansion cannot reach them and the
   idea dies cheaply. Use `scripts/measure-chrono-linking.mjs`'s corpus (it has a link graph) and/or
   the real vault via `scripts/analyze-vault-shortlist.mjs`. Free, no API key.
2. **Model bake-off, once the owner supplies a key.** Score on the **811 real links** in the
   chronological corpus, not the old 20-fixture rubric (`docs/qa/2026-07-27-plus-model-effort-bakeoff.md`),
   which saturated at 5.00 on three of four dimensions. Arms: `claude-sonnet-5` at high / medium /
   low effort, `claude-haiku-4-5`, plus **GPT-5.6 Terra ($2.50/$15) and Luna ($1/$6)**, and
   `claude-opus-5` as a ceiling check (the old bake-off scored Opus *worse* — worth re-testing
   against a metric that discriminates). Extend `scripts/measure-link-quality.mjs`; it already
   supports `--via-pipeline` and per-config comparison. Verify whether Haiku accepts
   `output_config.effort` before assuming it.
   **Quality is the priority — the owner has said so explicitly.** The question is whether the
   shortlist buys down the model requirement, not how cheap we can go.
3. **Free wins, cheap to measure with `measure:recall`:** index the LLM-written tags and link prose
   (doc2query for free), index more body text than 200 chars, and BM25F with separate title/tags/body
   weights. All three add *terms*, which is the only thing that moves an absolute miss.
4. **Grow the probe set before trusting small gaps.** n=80 puts the noise floor near 5 points.
   Target new probes at queries that currently score **zero** — those are the real failures.
5. **Then `ce-plan`.** The design is settled enough: body-scored BM25 shortlist behind the existing
   `ContextProvider` seam, chronological calendar chunks for backfill, per-capture for daily filing.
   Route the four call sites through `getCandidates(capture)` — see below.
6. **File the two defects** as GitHub issues (owner has not yet said go).

## Key files

**The seam to implement into**

- `src/pipeline/context.ts:19` — `ContextProvider.getCandidates(capture)` **already takes the
  capture** and is documented as "a future BM25 stage only changes this one function."
- **But it is dead code.** `MetadataContextProvider.getCandidates` ignores the capture (`_capture`)
  and every real caller bypasses it via `buildContext()`: `write.ts:120`, `preview.ts:247`,
  `backfill.ts:268`, `refreshAtoms.ts:727` and `:862`. Routing those four is the real work.
- The pipeline reads **no note bodies** today; `vault.cachedRead` is used only in
  `src/home/atomsHomeView.ts`. Body scoring needs new I/O.
- `backfill.ts:268` builds context **once**, before the run — the cause of the in-run linking loss.

**Harnesses (all committed, all reproducible)**

| Script | npm | Cost |
|---|---|---|
| `scripts/measure-classify-cost.mjs` | `measure:cost` | free; `--spend` for paid phases |
| `scripts/measure-shortlist-recall.mjs` | `measure:recall` | free |
| `scripts/measure-link-quality.mjs` | `measure:links` | paid, `--spend`, ~$11 per full run |
| `scripts/measure-chrono-linking.mjs` | `measure:chrono` | free |
| `scripts/spike-index-feasibility.mjs` | — | free, read-only |
| `scripts/analyze-vault-shortlist.mjs` | — | free, read-only, safe on a personal vault |
| `scripts/lib/shortlist.mjs` | — | shared selectors — both harnesses import this |

**Fixtures**

- `scripts/fixtures/vault-title-corpus.json` — 93 real atom titles, mean 42.13 chars
- `scripts/fixtures/link-probes-{abc,de,fg}.json` — 84 probes, 7 archetypes, 12 failure modes
- `scripts/fixtures/chrono-corpus-{a,b,c,d}.json` — **720 dated captures, 576 atoms, 811 in-run
  links, 3 years, 20 interleaving life threads.** The most valuable artefact here; any future
  selector change should be scored against it.

## Decisions & constraints

- **Never handle the API key value.** The owner places it; verify presence without printing, e.g.
  `zsh -ic '[ -n "${ANTHROPIC_API_KEY:-}" ] && echo set'`. Note: the key lives in `~/.zshrc`, which
  a non-interactive `zsh -lc` does **not** source — use `zsh -ic`. The 2026-07-28 key is dead; the
  owner is supplying a fresh one.
- **Quality over cost.** Stated explicitly. The retrieval fix already created a budget (monthly
  chunks are 39% below today) — spend it on quality rather than banking it.
- **Don't combine models.** Costed: Haiku-triage-then-Sonnet is ~$17 vs $18.81 single-Sonnet,
  because noise captures are already cheap (37 output tokens vs 355) and both passes pay the cache
  read. Escalation-on-uncertainty is worth building **only if** the bake-off shows Haiku is
  close-but-patchy on an identifiable subset.
- **Embeddings stay out of scope** — now for a documented reason, not a preference.
- **Vault lanes.** `analyze-vault-shortlist.mjs` is read-only and was run against the owner's Remote
  Vault with permission. Never write to it.
- **Plain English with this owner.** No growth/product jargon.
- **Multiplayer repo.** Research needs no claim; changing `context.ts` does — assigned Issue +
  `STATUS.md` row + draft PR first.

## Git state

Branch `claude/catch-up-cost-study`, base `master`, pushed. All work is committed — no WIP.
Commits from this session, oldest first:

```
ef1a8d5 research(#168): measure classify cost against the API, not arithmetic
88a9d57 research(#168): batch caching survives, but the first wave writes the prefix
b7393ae research(#168): warming the prefix gives 100% batch cache hits; final cost table
aa76760 research(#168): selector sweep — title-only shortlists plateau at 69%
953b29c research(#168): score shortlists on note bodies, not titles — 69% to 95%
2155f06 research(#168): add the paid model-side link-quality harness
1f36289 research(#168): validate the selector against a real vault, read-only
f77a9cb research(#168): mobile index spike — not a blocker
15c1278 research(#168): re-run through the real classifyCapture — capping penalty vanishes
15be6ee research(#168): blocks are dead — shortlist unions saturate to the whole vault
c0f160b research(#168): chronological chunking beats today on cost AND links
```

Note `15be6ee` is **superseded by `c0f160b`** — read them in order or the "blocks are dead"
conclusion misleads.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-catch-up-study
git fetch origin && git switch claude/catch-up-cost-study && git pull --ff-only
npm install
npm run measure:recall    # free, confirms the harness still reproduces
```

Then start at **Next steps 1**.
