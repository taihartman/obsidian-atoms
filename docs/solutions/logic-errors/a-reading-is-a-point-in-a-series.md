---
title: "A reading is a point in a series, and the second point is the trigger"
date: 2026-08-21
category: logic-errors
module: classify
problem_type: logic_error
component: plugin
symptoms:
  - "A bare odometer capture (My car is at 73089 miles) classifies noise; the prompt's own examples (pure logistics, lone timestamps) endorse it"
  - "Reconsider re-runs the same judgment and still skips; Keep as note then files links: [] and tags: [list] even with the prior reading in the shortlist"
  - "The earlier capture's stated return intent (come back into QGS automotive) opened no loop; looksLikeOpenLoop only knew write/share intents"
  - "Retrieval was never the failure: the prior reading shared tokens (car, mil) and sat in the shortlist; the verdict and linking pressure were the misses"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - enrichment
  - open-loops
  - home
  - refresh
tags:
  - classify
  - noise
  - measurement
  - series
  - open-loops
  - reconsider
  - invites
---

# A reading is a point in a series, and the second point is the trigger

## Problem

Two live captures, three stacked failures (#589). An odometer reading filed as
noise because each reading, alone, genuinely is logistics-shaped — the prompt's
noise examples ("lone timestamps") describe it exactly. The user's rescue path
made it worse in an instructive way: Reconsider re-ran the identical classifier
(same prompt, same verdict), and the Keep-as-note override built its result
from a constant (`forceKeepAtomResult`: `tags: ["list"], links: []`), so the
kept atom was an island while its sibling reading sat in the shortlist the
override never looked at.

## Why every layer missed

The product had no concept for **a recurring measurement of a durable thing**.
It is not an idea (`rescueKeepableIdea` false), not a packing list
(`isEntityShaped` false), not a person, not media. Each rescue hatch was a
shape check, and this shape was not in the list. Meanwhile the numbers that
make two readings a series to the user (`73042`, `73089`) share no token, so
nothing retrieval-side could ever join them — the series has to form through a
**thing** (`My car`), and no thing existed.

## Solution shape (three layers, in trust order)

1. **Model, taught generally** — the prompt learns "a number attached to a
   durable thing is a reading: one point in a series; readings are atoms" with
   cross-domain examples. Generalizes to weight/meter/rent with no code.
2. **Heuristic, narrow** — `isMeasurementReading` rescues only the observed
   shape from a lingering noise verdict (chore leads, activity distances,
   times, and places all excluded). A seatbelt, not the feature.
3. **User, sovereign** — Keep-as-note now runs `applyClassificationQuality`
   with the classify context, so an override files with whatever same-thread
   links the chain can prove.

Series formation is split by determinism: hub links are exact-title and
deterministic (`enrichMeasurementLinks`); prior-reading chaining is fuzzy and
stays the model's prompt duty ("Series linking (MUST)").

## The offer, never the verdict

The same pair teaches why loop-closing must ask instead of act: the loop said
"drive 60–70 miles from 73042" (return ≈ 73102–73112) and the new reading was
73089 — short by 13–23 miles. Any arithmetic auto-close would have been
confidently wrong, and doing that arithmetic at all is task-app gravity. The
Home card shows both captures verbatim; the user judges; decline is a
permanent told for that pair.

## Durable learnings

- **A rescue path that rebuilds a result from a constant will always under-file.**
  If a human forces a keep, they deserve the full enrichment chain, not a
  hand-rolled `ClassificationResult` literal.
- **Reconsider cannot out-think Process** — same prompt, same verdict. A
  re-ask is only worth offering when something changed (prompt version, vault
  context); otherwise the honest affordances are override-and-enrich.
- **When two notes are the same series to a human but token-disjoint to
  retrieval, mint the entity.** Numbers, dates, and codes never match; the
  noun they measure does.
- **Refresh may infer what filing would have inferred.** Update notes now runs
  `looksLikeOpenLoop` when frontmatter has no loop keys — unset is
  classifier-writable under the existing `canClassifierWrite` policy, so old
  atoms gain loops the current pipeline would have given them on day one.

## Verification

`test/measurement.test.ts` (recognition truth table, both live captures
verbatim, island-never regression), `test/hubInvite.test.ts` (Track at reading
two, pairing at one with an existing hub), `test/loopCloseOffer.test.ts`
(offer/told/redeemed/ordering), `test/openLoopHeuristic.test.ts` (return
intents + refresh inference). Live pair repair (AE6) is owner-run via Update
notes on the personal vault.
