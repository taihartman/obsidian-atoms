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

## Explicitly out of scope

Embeddings and semantic search (`CLAUDE.md` out-of-scope list). Any change to what lands in the vault
— this experiment classifies into throwaway vaults only and writes no atoms to a real one.
