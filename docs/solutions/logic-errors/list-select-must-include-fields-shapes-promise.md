---
title: "A list SELECT that omits a field makes every shape look empty"
date: 2026-08-11
problem_type: logic-error
module: plus-service ask mirror
tags: [open-loops, list_atoms, open_now, SELECT, projection]
severity: p0
---

# A list SELECT that omits a field makes every shape look empty

## Problem

`list_atoms` always returned `open_now: false` and `loop: null` even when search/fetch showed active open loops for the same notes.

## Symptoms

- Shape helpers and unit tests that inject `loop` on in-memory pubs passed.
- Live `mirrorList` store path failed silently: every listed item looked closed/unmarked.
- Agents that used list instead of search never saw intention honesty.

## What didn't work

Fixing only `paginateMirrorList` / `attachLoopFields` without checking the SQL. The list path deliberately avoids `body_enc` and used a narrow column list — and never added `loop_json`.

## Solution

Add `loop_json` to the `mirrorList` SELECT in both sqlite and postgres methods (memory already keeps the full prepareMirrorRow). Keep upsert `COALESCE(EXCLUDED.loop_json, atom_mirror.loop_json)` so older clients that omit loop do not wipe stored marks.

## Why this works

`rowToPublicAtom` can only project fields the store loaded. Search/fetch used `SELECT *` (or full rows); list used a subset. Tests that never hit the store SELECT cannot catch the gap.

## Prevention

- When adding a projected field, grep every `SELECT` that feeds the public shape, not only the hasher/upsert.
- Store-level test: upsert with loop → `mirrorList` → assert `open_now` / `loop.source`.
- Prefer one "list columns" constant shared by sqlite and postgres.

## Related

- Open loops plan: `docs/plans/2026-08-11-003-feat-open-loops-plan.md` (R11, SC10)
- PR #462 / Issue #461
