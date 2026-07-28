---
title: "Citing a solution doc while implementing two of its three guards"
date: 2026-07-28
category: logic-errors
module: inbox-drain
problem_type: logic_error
component: write-path
symptoms:
  - "A filed inbox capture read as pending and filed a second time"
  - "Two <!--atoms:filed--> markers stacked under one capture"
  - "The code comment cited the solution doc that describes this exact failure"
root_cause: process_gap
resolution_type: code_fix
severity: high
tags:
  - markers
  - idempotency
  - solution-docs
  - review
  - test-coverage
---

# Citing a solution doc while implementing two of its three guards

## Problem

`appendFiledMarkers` in `src/pipeline/inbox.ts:482` carried this comment from the day it
was written:

> Insert filed markers after each capture's extent, highest line first so an earlier
> insertion does not shift a later capture's indices (KTD11 —
> `docs/solutions/logic-errors/marker-line-drift-batch-process.md`).

It implemented guard 1 (bottom-up ordering) and the drain implemented guard 2 (re-locate
before insert). It silently omitted guard 3: **the idempotent marker region check.** Marker
detection in `parseInboxCaptures` was adjacency-only — the old code tested `lines[i]`, the
single line right after the capture extent, and nothing further.

Consequence: one blank line drifting between a capture and its marker — a Sync merge, a
hand edit, a Shortcut that appended an extra newline — made a filed capture read as pending.
The next drain re-filed it into its daily and spliced a **second** marker. That is precisely
the symptom `marker-line-drift-batch-process.md` exists to prevent, reproduced in a new file
whose comment pointed at that doc.

## Symptoms

- `<!--atoms:filed-->` appears twice under one inbox bullet
- Home shows a capture as pending that already has a marker and already reached its daily
- Everything looks correct on a file that has never been merged or hand-edited, so it passes
  every local smoke test

## Root cause

Not a coding mistake — a **reading** mistake. The doc lists five items under Solution; the
implementation took the two that the plan had already named as KTD11 and stopped. The
citation in the comment made the omission invisible in review: a reader sees a solution doc
referenced and reads that as "this class of failure is handled here."

The tests told the same story. `marker-line-drift-batch-process.md` §Prevention says
literally: *"Add/keep unit tests for: already-has-marker, relocate after insert, empty
capture filter."* The inbox suite had relocate-after-insert and had the empty-bullet case.
It had no already-has-marker test. The missing test is exactly the missing guard.

## Fix

`inboxMarkerLineInRegion` (`src/pipeline/inbox.ts:98`) scans forward from `endLine + 1`,
stopping at the next top-level bullet or the next non-indented non-blank line, and returns
the marker's line or null. It deliberately mirrors `captureAlreadyHasMarker`
(`src/pipeline/render.ts:225`), the daily path's guard 3, rather than reusing it — the inbox
owns its own sentinel and never teaches `parse.ts` about it (KTD9).

It is applied in two places, because the guard is needed on both the read and the write:

- `parseInboxCaptures` (`:186`) sets `filed` from the region scan, so a drifted marker still
  reads as filed and the capture never re-enters the queue
- `appendFiledMarkers` (`:489`) filters out any capture whose region already holds a marker,
  so even a caller that hands it a filed capture cannot stack a second one

Regression tests: `test/inbox.test.ts:179` "reads a capture as filed when a blank line
drifted before its marker (F4)" for the parse half, and `test/inbox.test.ts:763` "does not
splice a second marker when one drifted below a blank line (F4)" for the write half, which
asserts the marker count stays at 1.

## Why this works

Marker presence is a property of the **region after a capture's extent**, not of one
adjacent line. Whitespace between a capture and its marker is semantically nothing, and any
file two devices both write will eventually contain some. An adjacency test encodes an
assumption about formatting that Sync is free to violate; a region scan encodes the actual
rule.

## Prevention

- **When code cites a solution doc, it owes that doc every guard the doc lists.** A citation
  is a claim of coverage. Partial adoption is worse than no citation, because the reference
  suppresses the review question that would have caught the gap.
- **Use the doc's §Prevention section as the checklist.** These docs end with a test list for
  this reason. Before landing code that cites one, diff the doc's test list against the suite
  you just wrote; a missing test is the tell for a missing guard.
- Reviewing a citation means opening the cited doc, not trusting the sentence around the link.
- Copying a guard between modules is fine when a seam forbids sharing (here KTD9), but copy
  *all* of it and say what it mirrors, so the next reader can diff the two.
- Tests will not catch this class on their own: the happy path, a fresh file, and a
  single-device run all pass. Review caught both this and the lost-update hazard on this
  branch; the tests were written afterward, to pin the fixes.

## Related

- `docs/solutions/logic-errors/marker-line-drift-batch-process.md` — the doc that was cited
  and partially applied; guard 3 is `captureAlreadyHasMarker`
- `docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md` — the other
  capture-loss hazard found in the same review
- Commit `3ec330c` "fix(inbox): close capture-loss and re-entrancy holes found in review" (F4)
