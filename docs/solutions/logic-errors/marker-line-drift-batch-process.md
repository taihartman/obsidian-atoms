---
title: "Batch process stacked markers when line indices drift"
date: 2026-07-15
category: logic-errors
module: write-path
problem_type: logic_error
component: tooling
symptoms:
  - "Process once left multiple <!--linker:*> lines under one bullet"
  - "Double Process doubled markers or wrote under the wrong capture"
  - "Home library stayed stale after Process from dry-run modal"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - markers
  - line-indices
  - write-path
  - bottom-up
  - idempotency
---

# Batch process stacked markers when line indices drift

## Problem

Processing several unprocessed bullets in one daily note used parse-time `startLine`/`endLine` as if they stayed valid for the whole run. Each inserted marker shifted later lines, so the next insert landed on the wrong place—or a re-run stacked another sentinel under an already-marked capture.

## Symptoms

- Only noise/task markers visible under some bullets while atom ↳ lines looked “missing” or mis-attached
- Second Process pass added a second `<!--linker:noise-->` (or similar) under the same capture
- Empty bullets like `- ` still entered the work queue and burned API calls or wrote junk markers
- Process from the dry-run modal wrote markers but Atoms home counts did not refresh until a manual reopen

## What Didn't Work

- Trusting the original parse indices for every item in top-down order — each insert invalidates indices below
- Assuming “one Process” is always one pass over stable content — users double-tap when feedback is weak
- Relying only on “don’t rewrite capture lines” without a “marker already present” guard for the post-capture region

## Solution

Three complementary guards (landed together in the process reliability fix):

1. **Bottom-up per daily** — sort work so higher `startLine` runs first; inserts below earlier captures cannot shift later work still in the queue (`src/write.ts` sort before the classify loop).
2. **Re-locate before insert** — `resolveCaptureEndLine` prefers the original start when the bullet still matches, otherwise searches by bullet body; `insertMarkerAfterCapture` uses that end line (`src/render.ts`).
3. **Idempotent marker region** — `captureAlreadyHasMarker` scans after the capture until the next top-level bullet; if any plugin sentinel is there, leave content unchanged (covers stacked orphans from older bugs).
4. **Skip empty bullets** — `isEmptyCaptureText` / `unprocessedCaptures` drop whitespace-only `- ` captures (`src/parse.ts`).
5. **Refresh home after write** — any path that finishes a process/preview should refresh open `atoms-home` leaves (or finish via home progress helpers that already refresh).

Directional shape:

```text
list unprocessed → sort by path, startLine DESC
for each capture:
  onProgress(...)
  classify
  resolveCaptureEndLine(current daily text)
  if already has marker → skip insert
  else insert marker after resolved end
  cache updated daily content for next item in same file
```

## Why This Works

Markers are **append-only lines after a capture extent**, not in-place edits of the bullet. Inserting a line changes every later index. Processing bottom-up means “later in the file” is already finished before “earlier” inserts move it. Re-location and already-has-marker make the path safe even if order, partial runs, or older stacked markers break pure index math. Empty-bullet filtering keeps noise out of the API and out of the daily.

## Prevention

- Any multi-edit pass over one daily must assume **indices are stale after the first insert** — bottom-up, re-resolve, or both
- Marker presence is defined by **sentinel after extent**, not “any wikilink in the capture body”
- Add/keep unit tests for: already-has-marker, relocate after insert, empty capture filter
- After Process (including modal **Process these**), always refresh open home leaves
- Prefer durable in-home progress so users do not double-tap out of uncertainty (see related progress pattern)

## Related Issues

- `docs/spec-amendments.md` — sentinel design (atom vs task/noise)
- `docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md` — progress UI so Process is not a black box
- Plan unit U8 write path: `docs/plans/2026-07-15-001-feat-obsidian-ai-linker-plugin-plan.md`
