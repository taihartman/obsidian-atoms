---
title: "A parser that defaults missing created to today is not a missing stamp"
date: 2026-08-21
category: logic-errors
module: pipeline/refreshAtoms
problem_type: logic_error
component: plugin
symptoms:
  - "Update notes ranked an unstamped atom as the most recent thought"
  - "File mtime from a polish pass jumped an old note to the front of the wave"
  - "Tests passed while ranking still used a helper that fills in today"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags:
  - update-notes
  - created
  - ranking
  - mtime
---

# A parser that defaults missing created to today is not a missing stamp

## Problem

Update notes has to pick which older atoms to spend a wave on. "When was this thought captured" is the ranking question. Two existing clocks in the plugin answer a different question, and both look like the right helper until a wave is wrong.

## Symptoms

- An atom with no `created` line ranks as if it were written today.
- A polish-only `mtime` bump on a two-year-old file beats yesterday's capture.
- Reusing Home's `parseImmutableFrontmatter` / `parseCreatedMs` looks like reuse and still fails the product test.

## What Didn't Work

- **File `mtime` as recency.** Polish rewrites the file. The wave would then prefer notes we just touched, which is the opposite of catch-up.
- **`parseImmutableFrontmatter.created`.** That helper exists so *display* always has a date. Missing stamps become today. Ranking "newest capture first" then puts undated notes at the front of a paid wave.
- **Importing Home's `parseCreatedMs` into the pipeline.** Home already imports refresh. The cycle is real, and `parseCreatedMs` also has a `Date.parse` fallback the ranker must not inherit.

## Solution

`refileRecencyMs` in `src/pipeline/refreshAtoms.ts` is a local parse:

1. Source daily `[[YYYY-MM-DD]]` at noon local, when the thought was captured.
2. Else `created`, same day-only / `T` shapes, no timezone guess.
3. Else `null`, sorted last. Never today, never `mtime`.

`refileScore` (empty links, weak links, lower quality) is a tie-break only after recency.

A test that plants a recent `mtime` on the older file, and a test whose missing `created` would win if it defaulted to today, are the lock.

## Why This Works

Display helpers are allowed to invent a date so a row can render. Rankers that spend Plus filings are not. "Missing" has to stay missing, or the fill-in becomes the policy.

## Prevention

- Do not call a parser for ranking until you know what it returns on absent input. If the answer is today, it is the wrong parser.
- Pipeline ranking must not import Home. Duplicate the small stamp parse next to the ranker rather than taking Home's fallbacks with it.
- When a quality bump ships a new Update notes wave, keep the "mtime does not win" and "missing created is not today" tests.

## Related Issues

- [library-within-day-created-order](library-within-day-created-order.md) — Recents also must not use process wall-clock or file mtime.
- [update-notes-quality-stamp](../features/update-notes-quality-stamp.md) — the refresh job this ranker feeds.
- Plan: `docs/plans/2026-08-21-002-feat-update-notes-once-settings-plan.md` KTD9.
