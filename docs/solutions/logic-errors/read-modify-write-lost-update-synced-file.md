---
title: "read → await → modify silently discards what Sync appended"
date: 2026-07-28
category: logic-errors
module: inbox-drain
problem_type: logic_error
component: write-path
symptoms:
  - "A capture made on the phone during a drain vanished from the inbox"
  - "Inbox count dropped by more than the number of captures actually filed"
  - "Nothing in the logs — the write reported success"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - lost-update
  - vault-modify
  - vault-process
  - sync
  - inbox
  - capture-loss
---

# read → await → modify silently discards what Sync appended

## Problem

`drainInbox` read the inbox note once at the top (`src/pipeline/inbox.ts:565`), then
awaited daily-note resolution and a `vault.modify` per date (`:593`–`:606`), then wrote
filed markers back into the inbox. If those markers had been computed from and spliced
into that opening snapshot, the final `vault.modify` would have written a version of the
file that predates anything the iOS Shortcut or Obsidian Sync appended during the await
window — deleting it, with no error and no log line.

The window is not theoretical. The drain runs on `onLayoutReady`, which is exactly when
Sync delivers a phone's pending appends, and each `ensureDailyForDate` can create a folder
and a file. That is capture loss in the one file whose entire purpose is never losing a
capture.

## Symptoms

- A capture typed on the phone seconds before opening the desktop is simply not in the inbox
- No error, no Notice, no `devLog` — the write succeeded, it just wrote the wrong content
- The loss is invisible in the drain's own counters, which only report what it filed

## What didn't work

- Trusting the opening read for the whole pass — the plan (`docs/plans/2026-07-28-002-feat-ios-capture-inbox-drain-plan.md:302`) specified `vault.read` / `vault.modify` matching `src/pipeline/write.ts:384` and never named the window
- Re-locating captures by `startLine` / `endLine` across the re-read — parse-time indices describe the snapshot they came from, and a merge that reflows the file invalidates all of them
- Making the marker write append-only — append-only protects against *our* deletions, not against a whole-file `modify` that carries a stale body

## Solution

Two halves, both required (`src/pipeline/inbox.ts:617`–`:628`):

1. **Re-read immediately before the write.** Markers are computed against `fresh`, a second
   `vault.read(inbox)` taken after every daily write has settled, and `appendFiledMarkers`
   splices into `fresh` — never into the opening `content`.
2. **Re-locate by content key, not line number.** `captureKey` (`:506`) is `stamp + "\n" +
   body`; `relocateFiledCaptures` (`:519`) walks the fresh parse and consumes one match per
   key from a multiset of what was actually filed. Greedy per key, so two genuinely
   identical captures (same second, same text) each take their own marker instead of one
   collecting both — see `test/inbox.test.ts:804` "files both of two captures with identical
   stamp and text (T3)".

A capture that filed but cannot be re-located (its inbox line was edited mid-pass) gets no
marker and is reported as `pending`, not `filed` (`:634`–`:635`) — the drain never claims a
marker it did not write.

```text
read inbox (snapshot)  ─┐
  group pending by date │  ← Shortcut / Sync can append anywhere in here
  per date: ensureDaily │
            read daily  │
            modify daily┘
re-read inbox (fresh)
  relocate filed captures by (stamp, body), greedy per key
  splice markers into fresh
modify inbox
```

Regression test: `test/inbox.test.ts:644` "keeps a capture appended mid-drain, and marks
only what it filed" — the injected `ensureDaily` appends a new capture into the inbox
mid-pass; the test asserts both captures survive, the drained one filed and the arrival
not. It fails if the marker write goes back to the opening snapshot.

## Why this works

The re-read makes the write-back's base a version that already contains the mid-drain
arrival, so splicing markers into it preserves rather than reverts it. Content keys survive
the re-read because they describe the capture, not its position; line numbers describe the
position and nothing else.

**This narrows the window, it does not close it.** An append that lands between the
`vault.read` at `:623` and the `vault.modify` at `:626` is still lost. The real fix is
Obsidian's `Vault.process(file, fn)` — an atomic read-modify-write, available since app
1.1.0 and typed in `obsidian.d.ts:7510`, well under this plugin's `minAppVersion` of 1.11.4.
Its callback must be synchronous, which suits this shape exactly: do the awaits first, then
pass a pure `(data) => appendFiledMarkers(data, relocate(parseInboxCaptures(data), filed))`.

## Prevention

- **Any `vault.read` … `await` … `vault.modify` pair on a file an external process can write
  is a lost update.** Phone Shortcut, Obsidian Sync, another vault window, the user typing.
- The whole repo is on that shape. Thirteen `vault.modify` call sites, **zero** `vault.process`:
  `src/home/atomsHomeView.ts:563,1209,1228,1354`, `src/pipeline/refreshAtoms.ts:710,801,834`,
  `src/pipeline/runHubProjection.ts:204`, `src/pipeline/reconsider.ts:240`,
  `src/pipeline/write.ts:384`, `src/pipeline/render.ts:639`, `src/pipeline/inbox.ts:606,626`.
  Migrating them to `vault.process` is unclaimed work; until then every one of them carries
  this hazard proportional to its await window.
- The inbox's own daily write (`:598` read, `:606` modify) has only synchronous work between
  read and modify. Small window, same shape.
- When you cannot make the write atomic, **make the loss detectable**: report what was
  actually written, not what was attempted, so a mismatch surfaces as pending work rather
  than as a false success.
- Re-entrancy is the same bug from a second thread. `main.ts:286` `drainInboxOnce` joins
  concurrent callers onto one in-flight pass so bootstrap and the manual command cannot both
  read the same pre-write state.
- Any regression test for this must inject the concurrent write *inside* the awaited
  dependency — a test that only calls the function twice will never open the window.

## Related

- `docs/solutions/logic-errors/marker-line-drift-batch-process.md` — the in-file index-drift
  cousin; this doc is the cross-process one
- `docs/plans/2026-07-28-002-feat-ios-capture-inbox-drain-plan.md` — KTD2 (append-only inbox),
  Risk 1 (divergent merge)
- Commits `a8549da` (re-read + relocate) and `3ec330c` (counters report markers written)
