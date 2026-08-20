---
title: "A paraphrased context title is still a foreign atom name"
date: 2026-08-20
category: logic-errors
module: classify
problem_type: logic_error
severity: high
tags:
  - classify
  - titles
  - markers
  - shortlist
  - expansion
  - integrity
---

# A paraphrased context title is still a foreign atom name

## Problem

The daily marker `↳ [[title]] <!--linker-->` is the atom's **name**, not a related-note chip. After #66, Process refused to attach a marker when the model reused an **exact** existing title for a different capture. A paraphrase of a neighbour still minted a new file: an iPhone capture was filed as `Farmers carries jumpstart workout habit motivation` while the morning capture on the same daily was correctly `Farmers carries are a great workout habit trigger`.

The body stayed sacred. The title, and therefore every graph edge that starts from that wikilink, did not.

## Root cause

1. Daily filing graph expansion is on by default. The daily note itself scores highly (it contains the capture). One-hop neighbours of that daily are previously filed **same-day** atoms, including unrelated ones.
2. Classify is shown those titles as link targets. The model sometimes **names this atom after** a neighbour instead of putting it in `links[]`, and it paraphrases so the #66 exact-path body-gate does not fire.
3. Home Continue can do the same on today's daily: a pending parent is injected; the prompt already forbids reusing the parent title, so the model paraphrases it.
4. No post-classify check asked whether the title was grounded in **this** capture.

Live Process is per-capture, not a day-batch. The contamination is context, not swapped responses.

## Fix (0.8.12)

- `repairBorrowedTitle` after link enrich: if the title shares **no** content tokens with the capture and covers ≥60% of its tokens (and at least two) from a context Note title, rewrite from `shortTitleFromCapture`.
- Continue parent is included as a neighbour even when it is missing from the shortlist.
- Dual-surface prompt: the atom title must be about this capture; related Note titles belong in `links[]`.
- Client-side, so Plus responses are repaired without a Fly deploy.

A title that shares any content token with the capture is left alone (real same-thread continues). A weak topical pair (sleep-debt vs a different sleep note) stays under the coverage floor.

## Prevention

- Never treat exact-path collision as the only foreign-title case — paraphrase is the production shape.
- Do not turn off daily graph expansion to "fix" this; same-day *related* links need those neighbours in context.
- Do not bump `CURRENT_ATOMS_QUALITY` for a rare poison: Update would refile the whole library. Existing bad markers are a rename, not a generation stamp.
- Regression: `test/titleCoherence.test.ts` (iPhone/farmers shape, grounded continue, weak abstract, continue-parent neighbour, `applyClassificationQuality` path). Coverage band is mutation-checked against both examples.

## See also

- `docs/solutions/logic-errors/collision-foreign-marker-integrity.md` — exact-title half of the same integrity rule
- Issue #66 / PR #67 · Issue #580
