# Shortlist quality experiment — does capping the title context lose links?

**Date:** 2026-07-28 · **Status:** design, not yet run · **Tracks:** #168 step 5
**Depends on:** [`docs/research/2026-07-28-classify-prompt-cost-measurement.md`](../research/2026-07-28-classify-prompt-cost-measurement.md) §0

## Why this exists

The cost measurement says the note-title context must be capped: uncapped, a 3,000-capture catch-up
costs $3.23 per thousand at a 200-note vault and $13.32 at 5,000, so no single honest price exists.
Capped at 400 titles it is flat at $3.65 per thousand at any vault size.

The obvious objection is that capping loses links. The owner's case: *a capture today that belongs
with a note from a year ago must not be lost because the note is old.*

Two things make this less of a gamble than it sounds, and one makes it more urgent:

- **A cap already ships.** `plus-service` truncates the title list to 40
  (`ATOMS_PLUS_MAX_CONTEXT_TITLES`), and since `buildVaultContext` sorts alphabetically, those 40 are
  the alphabetically-first titles. Plus users already cannot link to most of their vault. The
  question is not "should we cap" but "replace an accidental cap with a designed one."
- So the bar is **not** "as good as uncapped." For Plus it is "better than alphabetical-40," which is
  a low bar. For BYOK backfill it is "as good as uncapped," which is the real bar.
- **Recency is the wrong selector** and it is the cheapest one, so it is the one we would have
  reached for. The owner's year-ago case kills it. That has to be a test, not a footnote.

## The design

**Separate the two questions.** A link can be lost in two different places, and they cost very
different amounts to measure:

1. **Was the right note even in the shortlist?** Pure computation over titles. **Free**, no API call,
   so we can sweep hundreds of selector configurations across the whole corpus.
2. **Given it was in the shortlist, did the model link it?** Needs a real classify call. Expensive,
   so it runs on a subset, and only after (1) has narrowed the field.

Most of the value is in (1) and almost none of the cost. Any selector that cannot get the target into
the shortlist cannot possibly link it, so (1) is a hard ceiling on (2).

**Ground truth by construction, not by opinion.** Rather than classify a real vault and argue about
whether a link is good, we plant known relationships:

- A **target note** with a known title.
- A **probe capture** written to belong with that target.
- **Distractors** — the rest of a synthetic vault, sized 200 / 1,200 / 3,000 / 5,000, drawn from the
  real title corpus plus generated same-domain near-misses.

Then *recall of the planted target* is objective. No human adjudication needed for the planted cases,
which is what makes a sweep possible. Human judgment is still required for the *unplanted* links a
model finds — but those are a bonus, not the measurement.

**Metrics**

| Metric | Level | Cost |
|---|---|---|
| `recall@k` — planted target appears in the shortlist of size k | selector | free |
| `rank` — where it appears, so we can see margin | selector | free |
| `link recall` — model actually emitted the link | model | paid |
| `false links` — model invented a link to a distractor | model | paid |
| `supersession recall` — model named the superseded atom | model | paid |

## Failure modes the corpus must probe

A selector can lose a link in structurally different ways. Each needs its own probe, because a
selector that handles one may fail another:

1. **Temporal distance** — target is a year old. Kills recency-only selectors. *(owner's case)*
2. **Vocabulary mismatch** — capture and target say the same thing in different words
   ("knee hurts on long runs" ↔ "IT band flares past 10k"). Kills keyword-overlap selectors.
3. **Person by nickname or role** — "Sam" ↔ "Samantha Chen", "my girlfriend" ↔ a named person hub.
4. **Entity drift** — the project was renamed; the capture uses the old name.
5. **Hub plus specific** — should link both the "Movies" hub and the specific film.
6. **Supersession** — the capture contradicts an old atom. If the old atom is not in the shortlist,
   we get a duplicate contradictory atom instead of a supersession link. **The most damaging miss**,
   because it silently corrupts the graph rather than merely thinning it.
7. **Thread continuation** — a running thought revisited over months ("the pricing thing again").
8. **Cross-domain bridge** — a work insight that connects to a personal one. Kills any selector that
   clusters by domain.
9. **Frequency domination** — a daily journaller's shortlist fills with near-duplicates of this
   week's obsession and crowds out the one rare relevant note.
10. **Ambiguous referent** — "she said it wouldn't work" with several women in the vault.
11. **Cold start** — nothing relevant exists. Correct behaviour is *no link*; probes false positives.
12. **Intra-run linking** — during catch-up, capture #2,999 belongs with an atom filed at #1 in the
    same run. A frozen prefix makes this structurally impossible; measures what block-refreshing buys.

## User archetypes

Breadth matters because selectors overfit to whatever vault shape they were tuned on. Each archetype
generates probes across several failure modes above.

| # | Archetype | What their vault looks like | Failure modes it stresses |
|---|---|---|---|
| A | **Knowledge worker** | meetings, decisions, projects, colleagues; dense named entities | 4, 6, 10 — decisions get reversed and things get renamed |
| B | **Relationship keeper** | partner, friends, family; recurring people over years | 1, 3, 10 — long gaps, nicknames |
| C | **Hobbyist** | films, games, books, recipes; hub notes and series | 5, 7 — hub-plus-specific, long-running series |
| D | **Body / health tracker** | symptoms, workouts, sleep; patterns over long spans | 1, 2 — lay wording vs the atom's declarative title |
| E | **Thinker / journaller** | beliefs and half-formed theories that evolve | 6, 7, 9 — heavy supersession, daily volume |
| F | **Social organiser** | events, group plans, who-said-what | 3, 10 — many people, ambiguous referents |
| G | **Side-project builder** | one project, changing name, tools, decisions | 4, 8, 12 — drift and cross-domain bridges |

Target: **~12 probes per archetype, ~85 total**, each with a planted target, a stated failure mode,
and the vault-age of the target in days.

## Selectors to sweep

All are cheap to compute in the plugin from `metadataCache`. None needs embeddings — that is
explicitly out of scope in `CLAUDE.md`.

| Selector | Rationale | Expected weakness |
|---|---|---|
| `alphabetical-40` | **the shipped Plus behaviour** — the control we must beat | everything |
| `recency-k` | cheapest plausible | failure mode 1, by construction |
| `keyword-k` | token overlap between capture and title | failure mode 2 |
| `tag-k` | shared tags | needs tags to exist |
| `person-first` | person hubs always included, rest by keyword | 5, 8 |
| `hybrid-k` | keyword ∪ recency ∪ person hubs ∪ tag, quota'd per source | the one we expect to ship |
| `full` | uncapped — **the ceiling**, and what BYOK does today | cost |

Sweep k ∈ {40, 100, 200, 400, 800} against vault sizes {200, 1200, 3000, 5000}.

## Protocol

1. Author the probe corpus (archetypes × failure modes) as a committed fixture.
2. Build the distractor vaults from the real title corpus plus generated same-domain near-misses.
3. **Sweep selectors, free** — `recall@k` and `rank` for every (selector, k, vault size, probe).
   Report where recall stops improving, and specifically where the *year-ago* and *supersession*
   probes stop being recovered.
4. **Model-side check, paid** — take the two or three best selectors and the `full` ceiling, run real
   classify calls on a subset, and compare emitted links. Uses the warm-prefix trick from §0.8 so
   repeat runs are cheap.
5. **Owner review.** A benchmark can say the shortlist picked a *different* link. Only the owner can
   say it picked a *worse* one. Every disagreement between a selector and `full` gets eyeballed.

## What would change our mind

- If no selector recovers the year-ago and supersession probes at any k below full, the cap is not
  safe for backfill and the cost problem has to be solved another way (smaller model for triage,
  two-pass classify, or pricing by vault size).
- If `hybrid-400` matches `full` on link recall, cap at 400 and ship the same selector to
  `plus-service` to replace alphabetical-40.

## Results — step 3 (free selector sweep), run 2026-07-28

84 probes, 80 with a target. `npm run measure:recall`. Raw:
[`data/2026-07-28-shortlist-recall.json`](../research/data/2026-07-28-shortlist-recall.json).

Recall at a 3,000-note vault, by shortlist size:

| Selector | 40 | 100 | 200 | 400 | 800 |
|---|---|---|---|---|---|
| `alphabetical` — **what plus-service ships** | 0% | 0% | 0% | 0% | 13% |
| `recency` | 8% | 8% | 8% | 16% | 55% |
| `keyword` — BM25 over titles | 68% | 69% | 69% | 69% | 74% |
| `bodyKeyword` — BM25 over bodies | 76% | 76% | 83% | 84% | 89% |
| **`bodyPlusTitle` — BM25 over title + body** | **90%** | **91%** | **93%** | **95%** | **96%** |
| `hybridBody` — same, with hub and recency quotas | 88% | 91% | 93% | 95% | 95% |
| `full` — uncapped | | | | | 100% |

At 5,000 notes the picture is unchanged: `bodyPlusTitle` holds 88–95% while every title-only
selector decays.

**Finding 1 — title-only shortlists plateau at 69%, and budget does not fix it.** Going from 100 to
800 titles buys five points. The entire gap is one failure mode: vocabulary mismatch, at **10%**
recall. Every other mode scored 70–100%. The captures being lost share no words at all with their
target — *"knees been grumpy on the sunday long one"* against *"IT band flares past 10k, never on
shorter efforts"*. No shortlist size can recover a note that is invisible to word-matching.

**Finding 2 — scoring against note bodies fixes it, at zero cost.** An atom's body is the user's
**original capture, verbatim**. People phrase things consistently over time, so matching a user's
words against their own past words is a far easier problem than matching them against the model's
paraphrase. Vocabulary mismatch goes **10% → 100%** at k=400. Crucially the *prompt is unchanged* —
only titles are ever sent — so every figure in the cost measurement still holds.

**Finding 3 — the owner's year-ago case is not an age problem.** `recency` scores **0%** on
temporal-distance probes at every k below 800, confirming the instinct that killed it as a selector.
But BM25 ignores age entirely and `bodyPlusTitle` reaches **100%** on those probes at k=400. Age was
never the mechanism; wording was.

**Finding 4 — the shipped Plus cap is not merely weak, it is ~0%.** `alphabetical-40` never surfaces
the target in a vault of any realistic size. Replacing it with `bodyPlusTitle-40` moves Plus from
**0% → 90%** with no change to prompt size, cost, or latency.

**What is still lost at k=400 (4 of 80), and why each is honest:**

| Probe | Mode | Why no text-matching selector can win |
|---|---|---|
| C05 | hub plus specific | needs to know *The Goldfinch* is by Donna Tartt — world knowledge, not overlap |
| G01 | entity drift | the project was renamed Ledgerly → Tallyroom; no shared text exists to match |
| E01 | supersession | the capture restates an abstract belief in wholly different terms |
| E05 | thread continuation | same |

C05 and E01/E05 are what the model itself is for; the shortlist only has to get the note in front of
it, and for those it cannot. G01 argues for a rename/alias record rather than a better selector.

### Recommendation

- **Backfill: `bodyPlusTitle` at k=400.** 95% recall, flat **$3.65 per 1,000 captures at any vault
  size** — versus $5.33 at a 1,200-note vault and $13.32 at 5,000 uncapped. It makes one published
  price honest.
- **plus-service: replace `alphabetical-40` with the same selector at k=40.** 0% → 90%, mean rank
  3.3, no cost change. This is a bug fix, not a feature.
- k=40 already buys 90%; k=400 buys the last five points. If prompt size ever needs to shrink again,
  40 is a defensible floor.

## Results — step 4 (paid model-side check), run 2026-07-28

84 probes × 4 configs = 336 real classify calls at a 3,000-note vault, Sonnet 5, **$11.76**.
`npm run measure:links -- --spend`. Raw:
[`data/2026-07-28-link-quality.json`](../research/data/2026-07-28-link-quality.json).

| Config | Target linked | Ceiling (in shortlist) | **Converted** | Invented links |
|---|---|---|---|---|
| `full` — uncapped | **90%** | 100% | 90% | 2 |
| `bodyPlusTitle:400` | **86%** | 95% | **91%** | 2 |
| `bodyPlusTitle:40` | **85%** | 90% | **94%** | 2 |
| `alphabetical:40` — shipped | **0%** | 0% | — | 0 |

*Converted* = of the targets the selector did surface, how many the model actually linked.

**Finding 5 — capping is not the dominant error source; the model is.** Given a perfect shortlist,
`full` still only links **90%**. Ten points are lost *after* the note is in front of the model. So
the gap between uncapped and `bodyPlusTitle:400` is **4 points**, against an 80% cut in prompt size.

**Finding 6 — a smaller shortlist converts better.** Conversion rises as k falls: 90% → 91% → 94%.
A shorter list is a less noisy one, and the model picks from it more reliably. The capped configs are
*better* at using what they are given; they simply have less. That is why k=40 lands within a point
of k=400 despite a much lower ceiling.

**Finding 7 — capping does not make the model invent links.** Two invented links on the cold-start
probes, identically, at every k. The worry that a thin list would push the model to force a
connection is not borne out. (`alphabetical:40` invents none because it links nothing at all.)

**Finding 8 — the shipped Plus selector links nothing.** `alphabetical:40` produced **72 regressions
against `full`** and a 0% link rate. Not degraded — inert.

**The 7 regressions at k=400, split by cause:**

| Cause | Probes | Fix |
|---|---|---|
| Not in shortlist | C05, E01, E05, G01 | the honest limits from step 3 — world knowledge, a rename with no shared text, two abstract restatements |
| In shortlist, model skipped it | B05, D10, E10 | prompt work, not selector work — the note was right there |

### Recommendation (updated)

- **Backfill: `bodyPlusTitle` at k=400.** 86% against an uncapped 90%, flat **$3.65 per 1,000
  captures at any vault size** versus $5.33–$13.32 uncapped. Four points is the price of a single
  honest published price, and three of the seven losses are prompt bugs we can chase separately.
- **plus-service: replace `alphabetical:40`.** 0% → 85% at the same 40 titles, same cost, same
  latency. At 5,000 notes k=40 slips to an 88% ceiling against k=400's 94%, so prefer 400 there too —
  10,095 tokens is ~0.3¢ on a warm realtime call.
- **Chase the conversion gap separately.** Ten points sit in the prompt, not the context, and that is
  the largest remaining pool — bigger than everything capping costs.

### What is still owed

Step 5 — owner review of the disagreements. The numbers above score against *planted* targets and
against what `full` linked. Neither can tell you whether a link a capped run found *instead* was
worse. The per-probe links are in the raw JSON for exactly that pass.

## Explicitly out of scope

Embeddings and semantic search (`CLAUDE.md` out-of-scope list). Any change to what lands in the vault
— this experiment classifies into throwaway vaults only and writes no atoms to a real one.
