---
title: "A paraphrased context title is still a foreign atom name"
date: 2026-08-20
category: logic-errors
module: classify
problem_type: logic_error
component: plugin
symptoms:
  - "Process mints a new atom whose title paraphrases a same-day context neighbour (iPhone capture filed as a farmers-carries title)"
  - "Issue #66 exact-title body-gate refuses only verbatim reuse; paraphrased neighbour titles slip through"
  - "Fixture Process injected a Home Continue parent but applyClassificationQuality did not forward it, so repair was blind to that neighbour"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - write-path
  - enrichment
tags:
  - classify
  - titles
  - markers
  - shortlist
  - expansion
  - integrity
  - continue-parent
---

# A paraphrased context title is still a foreign atom name

## Problem

The daily marker `↳ [[title]] <!--linker-->` is the atom's **name**, not a related-note chip. After #66, Process refused to attach a marker when the model reused an **exact** existing title for a different capture. A paraphrase of a neighbour still minted a new file: an iPhone capture was filed as `Farmers carries jumpstart workout habit motivation` while the morning capture on the same daily was correctly `Farmers carries are a great workout habit trigger`.

The body stayed sacred. The title, and therefore every graph edge that starts from that wikilink, did not.

## Symptoms

- A capture about topic A gets an atom whose title reads like a paraphrase of a different note already in vault context.
- The daily `↳ [[borrowed title]]` points at a file whose body is this capture; the capture looks processed.
- Exact-title collision (#66) still holds when the filename is reused; paraphrase creates a distinct path, so the body-gate never runs.
- Home Continue on today's daily can produce the same shape: the prompt forbids reusing the parent title, so the model paraphrases it.

## What Didn't Work

- **Exact-path collision alone (#66).** `planWrite` only hits `skip_existing_atom` when the sanitized title path already exists. A paraphrase is a different filename, so Process creates a new atom and appends a foreign-named marker.
- **Prompt-only "title must be about this capture."** Dual-surface copy still helps, but models still name atoms after neighbours.
- **Turning off daily graph expansion.** Same-day *related* links need those neighbours in context. Expansion is not the bug; naming this atom after a neighbour is.
- **Bumping `CURRENT_ATOMS_QUALITY`.** A rare title poison is not a generation-stamp event. Update would offer a refile of the whole library. Existing bad markers are a rename, not a quality bump.

## Solution

On this branch (PR #581, unmerged as of this writing): client-side post-classify repair in `src/pipeline/enrich/titleCoherence.ts`, after link enrich on **both** live `classifyCapture` and offline `applyClassificationQuality`. The production incident is the one reported in Issue #580.

`isTitleBorrowedFromContext` returns true when:

1. The proposed title shares **no** stemmed content tokens with this capture (any overlap is treated as a real same-thread continue).
2. It shares at least two stems with a context Note title, covering ≥60% of the proposed title's tokens (`TITLE_CONTEXT_COVERAGE`, `TITLE_CONTEXT_MIN_SHARED`).
3. The neighbour list is non-empty. Empty context cannot prove a borrow.

`repairBorrowedTitle` then replaces the title with `shortTitleFromCapture`. Atom verdict only. Body, links, and verdict stay. Continue parent is merged into the neighbour list even when it is missing from the shortlist (`neighbourTitlesForBorrowCheck`).

**Live path:** `classifyCapture` passes `context.continueParent?.title` as the fourth argument.

**Offline path:** `applyClassificationQuality` takes `opts.continueParentTitle`. Fixture Process in `src/pipeline/write.ts` forwards `ctx.continueParent?.title` after `withEligibleContinueParent`. Backfill and refresh usually have no Continue parent; the option stays optional there.

Plus responses are repaired on the device, so no Fly deploy is required.

## Why This Works

Classify sees expanded shortlist titles (and optionally a Continue parent) as link targets. The model sometimes **names** this atom after a neighbour instead of putting it in `links[]`, and it paraphrases so the #66 exact-path body-gate never fires. Asking whether the title is grounded in **this** capture, after enrich, closes that gap without turning off expansion.

A title that shares any content token with the capture is left alone. A weak topical pair (sleep-debt vs a different sleep note) stays under the coverage floor. The coverage helper `titleNeighbourCoverage` is the one ratio both production and tests use.

Wiring the parent only into `classifyCapture` is the same trap as a repair that lands on one branch: `process-fixture-sample` injects Continue onto `ctx` and then ran quality with titles only, so a parent missing from the shortlist was invisible. Forwarding `continueParentTitle` makes the fixture path match live Process.

## Prevention

- Never treat exact-path collision as the only foreign-title case — paraphrase is the production shape.
- Any path that calls `applyClassificationQuality` after injecting a Continue parent must pass `continueParentTitle` (mirror `write.ts`).
- Do not turn off daily graph expansion to "fix" this.
- Do not bump `CURRENT_ATOMS_QUALITY` for a rare poison.
- Regression: `test/titleCoherence.test.ts` (iPhone/farmers shape, grounded continue, weak abstract, continue-parent neighbour, parent already in the shortlist, task verdict, `applyClassificationQuality` with `titles: []` plus `continueParentTitle`, marker line from the repaired title).

## Related Issues

- Issue #580 / PR #581 — borrowed-title repair (unmerged as of this writing)
- Issue #66 / PR #67 — exact-title collision body-gate
- `docs/solutions/logic-errors/collision-foreign-marker-integrity.md` — exact-title half of the same integrity rule
- `docs/solutions/logic-errors/security-fix-repair-wired-into-only-one-branch.md` — repair that exists on only one call path
- `docs/solutions/logic-errors/partial-adoption-of-a-cited-solution-doc.md` — citing a learning while shipping only part of its guards
