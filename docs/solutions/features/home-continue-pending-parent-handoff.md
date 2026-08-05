---
title: Home Continue uses device-local pending parent, not body merge
date: 2026-08-04
problem_type: feature_pattern
module: home, pipeline, plus-service
tags:
  - continue
  - classify
  - body-sacred
  - dual-surface
category: features
applies_when:
  - Adding a handoff from home UI into Process/classify
  - Linking a new atom to an existing parent without rewriting it
---

# Home Continue: pending parent handoff

## Context

Users need to add a second thought to an existing atom without rewriting the parent body. Ask MCP already had `continue_atom` (new child + relation link). Home needed the same spirit through the daily capture loop.

## Guidance

1. **Continue** from home-open sets device-local `atoms-continue-parent-v1` (`title`, `path`, `setAt`) and opens today’s daily.
2. **Eligible inject** = capture on **today’s daily only**. Past-day auto-run must not burn the handoff.
3. Classify gets `VaultContext.continueParent` (BYOK messages + Plus `contextForPlus` + `anthropic.mjs` boundContext — not template-only).
4. After classify: `applyContinueEnsures` = distinct title, then `continues [[Parent]]` if link missing.
5. **Clear pending only after successful write** (marker appended), never on Preview or classify hard-fail.
6. Reuse `relationReasonProse` for Ask + home link templates.

## Why This Matters

- Body sacred: parent never `vault.modify`’d by the pipeline.
- Thin “seed a wikilink and hope” fails acceptance; explicit parent context is robust.
- Plus silently dropped unknown context keys until `boundContext` learned `continueParent`.

## When to Apply

Any home → classify handoff that must attach graph edges without a second compose UI.

## Examples

```ts
const { ctx, parentTitle } = withEligibleContinueParent(ctx, note.date, todayYmd, load);
// … classify …
if (parentTitle) result = applyContinueEnsures(result, parentTitle, existingAtoms, folder);
if (parentTitle && writeResult.markerAppended) clearContinueParent(save);
```

## Related

- Issue #16 / PR #275
- Plan: `docs/plans/2026-08-04-006-feat-continue-existing-atom-plan.md`
- Ask write path: `docs/plans/2026-07-27-003-feat-ask-write-path-plan.md`
