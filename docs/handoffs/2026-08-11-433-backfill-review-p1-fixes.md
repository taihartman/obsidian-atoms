---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-11T12:30:00Z"
title: "#433 backfill offer — fix three validated P1s from code review"
summary: "ce-code-review passed on the branch; three P1 bugs let a run exceed, drop, or race what the user confirmed. Fix them with ce-debug, one regression test each."
keywords: ["backfill", "433", "434", "p1", "ce-debug", "maxCaptures", "backfillInFlight", "markers", "atoms"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
resume_focus: "Run ce-debug on findings #3, #4, #6 from docs/reviews/2026-08-10-433-backfill-offer-code-review.md — in that order, regression test each"
repository: "taihartman/obsidian-atoms"
branch: "claude/backfill-offer-u5-u8"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8"
---

# Handoff — #433: three P1 fixes from code review

## What already happened

`ce-code-review` ran on this branch: nine local reviewer personas plus an independent cross-model
adversarial pass on Grok. Full report, with evidence and the reviewer roster, is committed at
[`docs/reviews/2026-08-10-433-backfill-offer-code-review.md`](../reviews/2026-08-10-433-backfill-offer-code-review.md).
Verdict was **Ready with fixes** — no P0 in new code.

Eight findings survived. This handoff covers **three of them**. Every one was independently
validated by a fresh agent against the real files, so the diagnosis is already done — do not
re-derive it. Go straight to a failing regression test.

Baseline before you start: **1,662 tests across 91 files pass, build clean, lint clean.** Anything
else is drift.

## Read this first — a collision risk

A separate background session (`task_9afc01d1`) is fixing the pre-existing P0 where the BYOK
confirm path calls `prepared.run.end()` while `confirmed` is still false, then submits the batch
against the ended run. **That fix lands in `runByokBackfillFlow`, which is also where fix #4
below goes.** Check whether that work has landed before you touch that function, and rebase or
sequence rather than editing in parallel. Nothing else in this handoff overlaps it.

## The three fixes, in order

Do them in this order. #3 is a one-liner and unblocks nothing; it just costs the least. #4 and #6
are the two that can actually lose user work.

### 1. Finding #3 — a confirmed Plus run has no capture ceiling

**Where:** `executePlusBackfill`, `src/plugin/main.ts:1605` (the `runWritePath` options block).

**What goes wrong:** the offer is priced at derivation time, then `runWritePath` re-scans by date at
write time. Captures that land inside `[since, before)` in between — a phone Sync dropping bullets
onto a mid-range daily, the capture inbox draining into a past note — get filed with no count
ceiling. The confirm modal said "files 20 captures"; the run can spend well past 20 and eat the
period reserve the whole budget model exists to protect. Only the server's 402 stops it.

**Fix:** add `maxCaptures: range.captures` to the `runWritePath` options. The existing comment there
argues a cap is unnecessary *because the range is already budget-bounded* — that reasoning is the
bug, so replace the comment too, do not leave it contradicting the code. With
`order: "newest-first"` the slice comes off the front of the sorted work list, so the cap drops the
oldest end, which the range already treats as spillover.

**Regression test:** in `test/backfillEntry.test.ts`, add unmarked captures to a daily inside
`[since, before)` after the offer is derived but before the confirm callback fires, then assert the
filed count never exceeds `range.captures`.

### 2. Finding #4 — BYOK holds no in-flight flag across its estimate and confirm window

**Where:** `runByokBackfillFlow`, `src/plugin/main.ts:1707`. See the collision warning above.

**What goes wrong:** it calls `backfillBusy()` and then runs a long `count_tokens` estimate and
opens a modal without ever taking `backfillInFlight`. `runPlusBackfillFlow` holds the flag for its
whole duration; this one does not. So two taps produce two estimates, two pinned context corpora,
and two gates. The user confirms the second, `executeBackfillBatch` finds the flag already held and
returns early **with no Notice**, and a consented paid Batch submit silently does nothing. Auto-run
can also file the same dailies during the unguarded estimate window.

The home card compounds it: `renderBackfillOffer` disables its button on `this.busy`, but the card
is only rendered in phases where `this.busy` is false, so that guard is dead — the button is always
enabled.

**Fix, two parts:**
- Move `this.backfillInFlight = true` to immediately after the `backfillBusy()` check at the top of
  `runByokBackfillFlow`, and release it in a `finally` that spans the whole method, mirroring
  `runPlusBackfillFlow` (`src/plugin/main.ts:1499`). Keep the check and the set as one synchronous
  step — `docs/solutions/logic-errors/extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set.md`
  is exactly this trap.
- Give `AtomsHomeView` its own `backfillCardBusy` field, set in `startBackfillFromCard()` before the
  async call and cleared when it settles, and bind the card button's `disabled` to that instead of
  `this.busy`.
- Where `executeBackfillBatch` refuses because the flag is held, emit a Notice. A silent refusal
  after the user consented to spend money is the actual harm.

**Regression test:** drive two rapid `runBackfillFlow("card")` calls on a BYOK device with the first
parked at the modal, and assert exactly one estimate and one batch submit. There is already a
matching test for the Plus double-tap in `test/backfillEntry.test.ts` — mirror its shape.

### 3. Finding #6 — Process can run during a backfill and overwrite its markers

**Where:** `runProcessUnprocessed` (`src/plugin/main.ts:2381`) and `runUpdateNotes`
(`src/plugin/main.ts:566`); the missing busy signal is in `executePlusBackfill`
(`src/plugin/main.ts:1605`).

**What goes wrong:** both entries pass only `requireClassifyAuth`, which has no concurrency check,
before `beginHomeRun`. Meanwhile `executePlusBackfill` runs inside `backfillInFlight` but never
calls `beginHomeRun`, so `AtomsHomeView.busy` stays false and home's Process button stays enabled
for the entire run. `render.ts` does a whole-file `vault.modify` from each run's own daily cache, so
a Process started mid-backfill can write back a snapshot that predates the backfill's appended
sentinels. Those sentinels are what makes the pipeline idempotent — losing them means the same
captures get filed twice, on a metered path.

The backfill also shows no progress anywhere, which is precisely what makes a user reach for
Process while one is running.

**Fix:** add `if (this.backfillBusy()) return;` before `requireClassifyAuth()` in both entries, and
wrap `executePlusBackfill` in `beginHomeRun("process")` / `finishHomeRun(...)` so home is visibly
busy for the duration. An `onProgress` hook is the natural companion but is scope you can defer —
say so explicitly if you do.

**Regression test:** start a Plus backfill, and while `backfillInFlight` is held, call
`runProcessUnprocessed` and assert it refuses. The existing in-flight block in
`test/backfillEntry.test.ts` covers only backfill-to-backfill and backfill-to-auto-run.

## Out of scope for this session

Do not fix these here; they are recorded in the review and stay open:

- **#5** — the home card prices with `fresh: false` while the modal prices after a live `/v1/me`, so
  the two can show different counts. **This is a product decision, not a bug fix** — the offline
  card is deliberate. Needs the owner's call on whether the card shows a count at all.
- **#1, #2, #7, #8** — duplicated complement/period logic, top-up timers surviving unload,
  newest-first sorting by path instead of date, and the per-round vault re-scan. All validated, all
  actionable, all lower urgency than the three above.
- **#9** — U7's release-notes line about paused sweeps. Release step, no code.
- The two pre-existing findings in the report's Pre-existing section. One is already being handled
  by `task_9afc01d1`; the egress-sheet wording must **not** be fixed by rewording
  `EGRESS_DISCLOSURE` (version-stamped; rewording strands every device's consent, #315).

## Constraints that still bind

- **Vault lane:** `test_vault/` or `docs/media/demo-vault/` only. Never `~/Documents/Remote Vault`.
- **No AI attribution** in commits, PR bodies, or PR comments.
- **Never** edit `EGRESS_DISCLOSURE` or bump `EGRESS_ACK_VERSION`.
- Every bug fix ships a regression test at the lowest level that would have caught it. A fix
  without one is unfinished.

## After the fixes

The shipping tail from the previous handoff still stands and is still unrun:
`ce-compound` (the durable learnings are worth writing — the entry-source lesson and the
`refreshedAt`-is-not-freshness trap), then `world-class-qa` ending in `adversarial-qa` against
`test_vault/` only, then fill out PR #434 and mark it ready. `0.7.0` auto-Releases on merge.

## How to resume

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/community-store-split-settings-21e7d8
git switch claude/backfill-offer-u5-u8 && git pull --ff-only
npm install && npm test && npm run build && npm run lint
```
