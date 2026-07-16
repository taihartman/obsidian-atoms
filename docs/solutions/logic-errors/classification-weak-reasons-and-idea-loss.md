---
title: "Classification quality: weak link reasons and keepable idea loss"
date: 2026-07-16
module: classify
tags:
  - classification
  - links
  - triage
  - media
problem_type: logic-error
---

# Classification quality: weak link reasons and keepable idea loss

## Problem

First live Remote Vault run produced correct markers and verbatim bodies, but:

1. Link reasons were category stickers (`preference about [[Nichita]]`, `media work to watch`).
2. Product/app idea dumps were marked `task`/`noise` and never became atoms.
3. Media work links pointed at unresolved titles that became empty notes when opened.

## Root cause

- Prompt examples still modeled weak reasons; person/media **repair** injects the same boilerplate.
- Soft-retired `task` was not enough — model still used task/noise on long “create a website” pitches.
- Architecture allowed unresolved work titles; empty stubs appear on click.

## Fix (0.6.6)

- `src/linkQuality.ts` — detect weak reasons; rewrite from capture cues; optional `People` index link.
- `src/ideaRescue.ts` — promote keepable product pitches from task/noise → atom with short title.
- `src/media.ts` — work-title links only when vault already has that title.
- Single choke: `classifyCapture` + `applyClassificationQuality` for fixtures/backfill.
- Prompt/schema aligned with the quality bar.

## Prevention

- Prefer local post-classify repair over API retries for deterministic quality.
- When testing triage, include multi-sentence product pitches, not only “buy milk”.
- Demo seed (`npm run seed:demo`) should show **target** reasons, not legacy boilerplate.
