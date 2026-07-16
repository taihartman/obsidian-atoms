---
title: "Auto-run stamped last-run day on attempt, blocking same-day retry"
date: 2026-07-16
category: logic-errors
module: autorun
problem_type: logic_error
component: auto-run
severity: high
status: solved
tags:
  - auto-run
  - last-run-day
  - phone
  - invisible-filing
  - device-local
applies_when:
  - "auto-run appears enabled but never files after a flaky open"
  - "offline or missing key then online same day still skips"
  - "more than PER_LAUNCH_CAP past captures and second open same day does nothing"
---

# Auto-run stamped last-run day on attempt, blocking same-day retry

## Problem

Unattended filing (auto-run) wrote `atoms-last-run-day` **before** `runWritePath` finished. Offline, missing key, throw, or a partial cap drain still marked the calendar day as done, so the next open the same day returned `same_day` and never retried. That made “magic” filing feel broken on phone.

## Symptoms

- Settings show auto-run on + ack, but past unmarked captures stay forever until the next calendar day (or manual Process).
- Console: skip reason `same_day` after an earlier failed or empty-feeling open.
- Cap hit (15) with remaining past work: second open same day does not continue.

## What Didn't Work

- Assuming “once per day” attempt stamping prevented double-fire — in-flight guard + markers already do that; stamp-on-attempt only burned retries.
- Relying on “retry next day” as acceptable UX for mobile network flakiness.

## Solution

1. **Gate:** `shouldRunAutoProcess` still requires enabled + egress ack; same calendar day **re-enters** when `pastUnprocessedRemaining > 0`.
2. **Stamp:** `shouldStampLastRunDay({ threw, pastRemainingAfter })` is true only when `!threw && pastRemainingAfter === 0`. Never stamp on missing key or throw.
3. **Wire:** `maybeAutoRun` removes pre-run `writeLastRunDay`; after write, re-count past unprocessed (via list helper) and stamp only if drained. Empty queue success stamps so the hourly interval does not spam forever.
4. **Home:** automatic-filing status + one-tap enable (device-local ack+enabled) so the phone path is discoverable without Settings archaeology.

Core pure helpers live in `src/autorun.ts`; wiring in `src/main.ts` (`maybeAutoRun`, `countPastUnprocessed`, `getAutoRunSnapshot`, `enableAutomaticFilingFromHome`).

## Why This Works

Markers make re-processing safe. The day stamp is a **cost/skip optimization**, not correctness. Treating “attempted” as “done” confuses those roles. Stamping only when past work is gone preserves once-per-day calm when idle and same-day recovery when work or failure remains.

## Prevention

- Never write `LS_LAST_RUN_DAY` before a successful drain of past unprocessed (or explicit empty-success).
- Unit-test: same day + remaining → run; throw/failed stamp → false; empty success → stamp.
- Keep auto-run silent on progress UI; refresh home after filed > 0.
- Product: auto path never `includeToday`.

## Related

- Plan: `docs/plans/2026-07-16-010-feat-invisible-filing-autorun-phone-plan.md`
- Progress silence pattern: `docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md`
- Concepts: Auto-run, Automatic filing in `CONCEPTS.md`
