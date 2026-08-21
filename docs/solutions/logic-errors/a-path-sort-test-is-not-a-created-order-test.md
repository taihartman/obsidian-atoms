---
title: "A path-sort test is not a created-order test"
date: 2026-08-21
category: logic-errors
module: pipeline/refreshAtoms
problem_type: logic_error
component: plugin
symptoms:
  - "at equal source day, newer created wins stayed green after created was ignored"
  - "Evening.md beat Morning.md by filename, not by created"
  - "Same-day Update notes waves ordered by link-score then path"
root_cause: test_isolation
resolution_type: test_fix
severity: medium
tags:
  - update-notes
  - ranking
  - created
  - tests
---

# A path-sort test is not a created-order test

## Problem

R12 / U2 want same-source-day atoms ranked by `created`, then link-health, then path. `refileRecencyMs` returns source noon when a daily exists, so equal source days are equal recency. The comparator then skipped `created` and used score + `path.localeCompare`. The unit test named for the second key still passed.

## Symptoms

- `Atoms/Evening.md` @ 20:00 vs `Atoms/Morning.md` @ 08:00: path sort already picks Evening. Swapping the two `created` stamps does not fail the test.
- A wave of notes from one daily is ordered by filename, not capture time.

## What Didn't Work

- **Asserting the winner that path sort already prefers.** The test cannot see whether `created` was consulted.
- **Keeping recency as a single source-else-created number.** That is correct for "has a stamp," but it cannot break a same-day tie.

## Solution

Sort source-day recency first, then `created` (nulls last, newer first), then score, then path. Lock it with inverted paths: later `created` on the lexicographically later filename (`Zulu.md` @ 20:00 vs `Alpha.md` @ 08:00). Add a swap so reversing `created` reverses the winner.

## Prevention

- When a comparator has a final `localeCompare(path)` key, the fixture for every earlier key must make path sort pick the *loser*.
- A test name that says "newer created wins" must fail if you invert only the timestamps.

## Related

- `docs/solutions/logic-errors/a-parser-that-defaults-missing-created-to-today-is-not-a-missing-stamp.md`
- `docs/solutions/logic-errors/library-within-day-created-order.md`
