# Model bake-off — GPT-5.6 vs Claude on real capture filing

**Date:** 2026-07-29 · **Issue:** #186 · **Branch:** `feat/bm25-shortlist`
**Harness:** `scripts/model-bakeoff.mjs` · **Corpus:** `scripts/fixtures/chrono-corpus-{a,b,c,d}.json`
**Raw data:** `docs/research/data/2026-07-29-model-bakeoff-*.json`

## Verdict

**Stay on Claude Sonnet 5.** No GPT-5.6 tier files captures well enough to justify the switch, at
either reasoning effort, at either sample size. The catch-up cost problem this study was opened to
dissolve is **not** dissolved by a cheaper model; it still has to be answered by the frozen-versus-
per-capture shortlist decision in U5.

## Headline result (n=300, 269 in-run gold links)

Each provider at its better observed setting: Sonnet as the plugin ships it, the OpenAI pair at
`medium` reasoning effort.

| model | link precision | **link recall** | F1 | verdict acc. | in-run links proposed | $/1k uncached |
|---|---|---|---|---|---|---|
| **claude-sonnet-5** | 64.2% | **48.7%** | **55.4%** | 98.3% | 204 | $25.87 |
| gpt-5.6-terra | 63.4% | 30.9% | 41.5% | 97.7% | 131 | $11.92 |
| gpt-5.6-luna | 60.2% | 20.8% | 30.9% | 98.0% | 93 | $4.98 |

**Precision is a three-way tie; recall is not.** When these models commit to a link they are about
equally trustworthy (60–64%). What separates them is how often they commit at all. Against 269 real
links, Sonnet proposed 204, Terra 131, Luna 93.

**Verdict classification is solved for everyone** (97.7–98.3%). Deciding atom / task / noise is easy.
Deciding *what a capture connects to* is the hard part, and it is where the models separate.

## Why recall is the metric that decides this

The plan this study serves rests on a measured property: **a miss is absolute.** A note that shares
no term with a capture scores exactly zero, so no amount of widening `k` recovers it. The same logic
applies one layer up. A link the model never proposes is not a link filed slightly worse — it is a
connection the user never sees, silently, with no error and nothing to review.

So the efficiency framing is a trap. Links found per dollar per thousand captures actually *favours*
the cheap tiers — Luna 4.18, Terra 2.59, Sonnet 1.88. But a second brain is not a throughput
problem. You cannot buy back a missed connection by filing more captures. A model that surfaces a
fifth of your connections is not a cheaper version of this product; it is a worse and different one.

## Reasoning effort does not close the gap

Raising the OpenAI arms from `low` to `medium` (n=50) bought almost nothing:

| model | recall @ low | recall @ medium |
|---|---|---|
| gpt-5.6-terra | 48.3% | 51.7% |
| gpt-5.6-luna | 20.7% | 27.6% |

Terra gained one link out of 29; Luna gained two. Luna's precision reached a perfect 100% at medium
— it is never wrong because it barely proposes anything. Confirming the same timidity at a second
effort setting is what rules out a bad-configuration explanation.

## Sample size, and why the n=50 numbers were flattering

Every arm scored substantially higher at n=50 than at n=300:

| model | recall @ n=50 (29 links) | recall @ n=300 (269 links) |
|---|---|---|
| claude-sonnet-5 | 72.4% | 48.7% |
| gpt-5.6-terra | 51.7% | 30.9% |
| gpt-5.6-luna | 27.6% | 20.8% |

This is the **task** getting harder, not the models getting worse. At 50 captures the vault holds a
few dozen atoms; at 300 it holds hundreds, so there is more to find and more to confuse. The drop
hits every arm, so the ranking is stable — but **quote the n=300 numbers, not the n=50 ones.** The
smaller run is a 29-link sample that could swing on a handful of judgements.

## What these runs did *not* test

**The shortlist itself.** At n=300 the vault reaches roughly 250 titles — below the k=400 cap — so
the cap never binds and every arm saw a full-vault context. That is correct for a *model* bake-off,
which is what this was, but it means these numbers say nothing about shortlist quality and the
`$/1k` column reflects a ~250-title context, not a saturated k=400 one. A real 1,200-note vault
costs more per capture than the table shows.

**Batch API pricing.** Everything here is synchronous. Batch halves both providers.

**Anthropic extended thinking.** Sonnet ran as the plugin ships it, without extended thinking, while
the OpenAI arms got their better effort setting. The comparison is therefore *generous to OpenAI*,
which is the right direction for a should-we-switch question: OpenAI lost while favoured.

## Speed and tokens (secondary, real)

OpenAI is roughly **2.6× faster** (2.2s vs 5.9s per capture) and uses **~40% fewer input tokens** for
the byte-identical prompt — a tokeniser difference, not a prompt difference. Neither outweighs an
18-point recall gap, but both matter if a future OpenAI tier closes that gap.

## Cost of this study

Approximately **$16** across five runs: a 2-capture live-adapter probe, a 50-capture five-model
sweep, a 50-capture two-model medium-effort rerun, and two 300-capture runs. Slightly over the $15
ceiling the owner set, because medium-effort reasoning tokens bill as output and the estimator
assumes a flat 250 output tokens per capture.

## Follow-ups this opens

- **`gpt-5.6-luna` is not a candidate for anything user-facing on the linking path.** 20.8% recall.
- **Terra is the only OpenAI arm worth re-testing** when a new generation ships — half the price for
  roughly two-thirds of Sonnet's recall is the closest anything came.
- **Re-run at a saturated vault** (n≥720, or with `--pre-run`) before quoting any `$/1k` figure as
  the real per-capture cost of a shortlist-capped prompt.
- The harness takes `--replay`, so all five runs can be re-scored against a changed scorer without
  spending again.
