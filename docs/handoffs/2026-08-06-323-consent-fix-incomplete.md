---
artifact_contract: "ce-handoff/v1"
created_at: "2026-08-06T17:40:00Z"
title: "#323 code is done and reviewed; the live two-device smoke is the remaining gate"
summary: "F1–F5 are closed, a P0 the review found in the fix itself is closed, and the branch is green locally — what is left is a human running a real withdrawal on a real phone against a real running desktop, which no agent can do from this worktree."
keywords: ["323", "330", "consent", "ask-mirror", "egress-gate", "lost-update", "qa-gate"]
cwd: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c"
resume_focus: "Run the two-device Sync smoke, then mark PR #330 ready"
repository: "taihartman/obsidian-atoms"
branch: "fix/ask-consent-cross-device"
head: "fix/ask-consent-cross-device @ 0.6.81-beta.1"
worktree_path: "/Users/a515138832/StudioProjects/obsidian_plugin/.claude/worktrees/nervous-hodgkin-cb3f8c"
---

# #323 — the code is done; the gate that remains is a human with two devices

> Supersedes the version of this file that said F1 was the remaining work. It is closed.
> This file lives on `fix/ask-consent-cross-device`, not master.

## State

[PR #330](https://github.com/taihartman/obsidian-atoms/pull/330) — **still draft, deliberately**,
rebased onto master. 1254 tests green, build clean, version **0.6.81** — 0.6.80 was taken by #337 as a stable release while this branch
was in review, so this rebased onto that and bumped past it.
Working tree clean, branch pushed. CI was pending at handoff — check it.

## What landed

Four commits past the original fix:

- `a57bbb3` — closes F1–F5 from the first review. The load-bearing one is the gate on
  `runSyncOnce`: `runMirrorSingleFlight` loops into `once()` and never re-enters `sync()`, so the
  original check answered for the first pass only.
- `9ae4ed9` — `ce-simplify-code`. The egress predicate now has one home (`mirrorPermitted()`).
- `6248b77` — **a P0 the code review found in the fix itself.** The generation counter added for
  F2 discarded an external read on *any* concurrent local save, and `saveSettings()` persists the
  whole object — so an unrelated background save (the auto-run `proposedTags` merge, no user
  gesture) could drop a remote withdrawal from memory and disk at once. Without the guard, that
  read would have applied the withdrawal; the F2 fix made its own case worse. Now only a
  withdrawal crosses a lost race, never a grant.
- `c4543b2` — `applyOutbox` asks the gate instead of re-deriving it; the gate's comment stops
  claiming to be "the last check before the upsert," which it is not.

Reviews: [`docs/qa/2026-08-06-323-followup-ce-code-review.md`](../qa/2026-08-06-323-followup-ce-code-review.md).
Learning: [`docs/solutions/security/consent-gate-must-be-checked-at-egress-not-at-entry.md`](../solutions/security/consent-gate-must-be-checked-at-egress-not-at-entry.md).

## Do this first — it is not code

**Run the two-device smoke.** `test_vault/` is gitignored and absent from this worktree, so
nothing has driven two real vaults through real Obsidian Sync. The unit tests prove the
mechanism against a stubbed network; they cannot prove the thing the issue is about.

1. Install the branch build on a desktop and a phone sharing one vault. Confirm
   **Settings → Atoms → Version 0.6.81-beta.1** on both.
2. Grant Ask consent, let a mirror pass run, confirm atoms reach the cloud.
3. On the phone, withdraw the privacy ack. **Do not touch the desktop.**
4. On the desktop: the Settings screen should rebuild itself, and no further push should leave.
   Watch for a "Ask mirror is off" outcome rather than a silent success.
5. Repeat step 3 while the desktop is mid-pass (edit a few atoms first so a follow-up is queued).
   This is the case the whole change exists for.
6. Grant again on the phone; the desktop should pick it up without a restart.

Then mark #330 ready, or record what broke.

## Do not redo

- **The diagnosis and the F1–F5 fixes.** All five are closed with mutation-tested guards — nine
  mutations run, each killing only its own tests.
- **The `JSON.stringify` re-render guard** and **not inventing a blank read as a withdrawal.**
  Both survived two rounds of adversarial review.
- **`devLog` in the hook's catch.** It is a no-op everywhere and throws under vitest.

## Carried, not closed — each deserves its own issue

1. **A pass already past the gate finishes.** `runAskMirrorSync` scans the vault, resolves hubs,
   and upserts in chunks with no re-check between them. A withdrawal landing inside that stretch
   still ships the rest of that pass. Closing it means threading a live predicate into
   `AskMirrorHost` and checking before each chunked `upsert`. **The test for it does not exist
   either** — the current tests mock `runAskMirrorSync` to upsert once, so they cannot see that
   window.
2. **Withdrawal purges nothing already mirrored.** Pre-existing. Relevant to anyone who reads
   "withdraw" as "delete my bodies from the server."
3. **A remote grant is adopted as silently as a remote withdrawal** on the non-race path. Confirm
   that is the intended reading of a synced ack.
4. **`applyOutbox`'s multi-item loop** does not re-check between items, and no test drives a
   mid-loop withdrawal of `askWriteAckAt`.

## Coverage gaps in the review itself, disclosed

The follow-up review ran correctness, security, and adversarial as three independent dispatched
contexts. **project-standards, testing, and learnings did not run** — session budget. The
adversarial lens ran in-process rather than through the `grok-cli` cross-model peer: that route
is buffered under `--json-schema`, so exceeding its 600s window returns an empty string at full
cost, and a cross-model pass had already run on this branch's earlier commits. Three separate
contexts is real independence; a different *model* is not among them.

## Adjacent claims

- **#320 is unowned.** [PR #322](https://github.com/taihartman/obsidian-atoms/pull/322) carries a
  complete U1–U7 implementation. Its version is `0.6.78-beta.2`, behind master, and its
  `versions.json` drops the `0.6.79` entry and invents a `"0.6.78"` stable mapping never cut.
  Re-derive the version from master; never resolve that conflict toward the branch.
- **Another session owns #315/#314** (`fix/consent-wording-parity`, draft
  [PR #329](https://github.com/taihartman/obsidian-atoms/pull/329)) and extracts
  `ConsentSheetModal` from `settings.ts`. A `settleOpenSheet()` helper across
  `hide()`/`openRoute()`/`refreshFromExternalSettings()` was flagged by review and **deliberately
  skipped here** to stay clear of that extraction — hand it to them.
