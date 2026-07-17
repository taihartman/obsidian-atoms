---
title: "Collision must not attach foreign atom markers"
date: 2026-07-17
category: logic-errors
module: write-path
problem_type: logic_error
severity: high
tags:
  - collision
  - markers
  - integrity
  - process
---

# Collision must not attach foreign atom markers

## Problem

Process treated title collision as success: append `↳ [[existing title]]` under the capture even when the existing atom body was a **different** claim. Captures looked processed forever; daily arrows pointed at the wrong atom. Classify failures only incremented `failed` with no reason.

## Root cause

`planWrite` → `skip_existing_atom` + `applyWrite` always inserted the marker. No body match. Model often reuses vault titles from context as the atom title.

## Fix (0.6.13)

- `captureTextsMatch` + `extractCaptureBody` before marker on collision / create race
- Mismatch → `collisionBodyMismatch`, no marker, `WritePathReport.failures[]`
- Notice surfaces first failure reason + snippet

## Prevention

- Never mark processed unless this capture owns that atom body
- Integrity regressions in `test/collision-integrity-repro.test.ts`
- Already-poisoned dailies need strip marker / repair (not auto in this fix)

## See also

- `docs/qa/2026-07-16-process-marker-integrity-investigation.md`
- Issue #66 / PR #67
