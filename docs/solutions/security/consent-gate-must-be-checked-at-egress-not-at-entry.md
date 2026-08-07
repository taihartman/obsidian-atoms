---
title: "A consent gate belongs at the egress call, not at the entry point that schedules it"
date: 2026-08-06
category: security
module: ask-mirror
problem_type: security_issue
component: consent-gate
symptoms:
  - "Consent withdrawn on the phone; the desktop kept uploading note bodies"
  - "The gate was present and correct, and the upload happened anyway"
  - "Tests were green throughout the leak"
root_cause: security_issue
resolution_type: code_fix
severity: high
tags:
  - consent
  - egress
  - single-flight
  - lost-update
  - sync
  - obsidian-sync
  - mutation-testing
---

# A consent gate belongs at the egress call, not at the entry point that schedules it

## The problem

`AskCoordinator.sync()` checked `askEnabled && askPrivacyAckAt` and then handed off to
`runMirrorSingleFlight`, which runs `do { await once() } while (followUp)`. The loop calls
`once()` — it never re-enters `sync()`. So the gate answered for the first pass only, and a
follow-up queued by a vault edit before a withdrawal uploaded note bodies after it.

The gate was not missing. It was one function too early. Everything between the check and the
network call — a single-flight loop, a debounce timer, a retry — is a place where the world can
change, and consent is exactly the thing that changes there, because `data.json` is replicated
by Obsidian Sync while the plugin runs.

**Rule:** put the predicate on the call that performs the egress, and read it live at that
moment. Entry-point checks are for user feedback (a Notice on a forced gesture), not for
authorization. Give the predicate exactly one home so a condition added later cannot land on one
gate and miss the other.

## The second bug, which is the more interesting one

The fix for the cross-device *read* path — `Plugin.onExternalSettingsChange()` — introduced a
generation counter so an external read that a local save overtook is discarded. That is the
textbook answer to a read-modify-write lost update on a synced file (see
[`../logic-errors/read-modify-write-lost-update-synced-file.md`](../logic-errors/read-modify-write-lost-update-synced-file.md)),
and applied wholesale to consent it is **wrong in the dangerous direction**:

1. The phone withdraws; Sync lands the cleared file.
2. The hook snapshots the generation and starts reading.
3. Any unrelated local save runs mid-read — in this codebase, the hourly auto-run merging
   `proposedTags` needs no user gesture at all. It bumps the generation, and because
   `saveSettings()` persists the *whole* settings object, it writes the still-granted in-memory
   copy over the withdrawal on disk.
4. The read resolves, the generation mismatches, and the hook drops it.

The withdrawal is now gone from memory and disk at once, and Sync carries the resurrected grant
back to the device that revoked it. Note the sting: **without the guard, step 4 would have
applied the withdrawal.** The fix made its own case worse than the code it replaced.

**Rule:** a last-writer-wins guard is symmetric, and consent is not. Let exactly one thing cross
a lost race — the withdrawal — and never the grant, in either direction. Concretely:
`adoptExternalWithdrawal` clears only explicitly-falsy consent fields, mutating in place so the
race winner keeps every other field, then persists and cancels pending work.

Two corollaries worth carrying:

- **A guard's blast radius is every writer, not the writer you were thinking about.** The
  generation counter was designed against "a local withdrawal races the read." It fired for a
  background tag merge. When adding a global counter, enumerate who bumps it.
- **Review a fix as new code, not as a patch.** F6 was found by three reviewers reading the
  diff cold. It would not have been found by asking "does this close F2?", because it does.

## Tests that would have caught it

The first round of #323 tests asserted `plugin.settings.askPrivacyAckAt === ""` and a re-render
counter. Both stay true *while the post-withdrawal upload happens* — they assert a proxy for the
defect, not the defect. The production failure mode is bodies leaving the device, so the test
must observe bodies leaving the device: stub the network `upsert`, drive the real coordinator,
and assert the call never happens.

**Mutation-test every guard.** Nine mutations were run against this change; each killed only its
own tests. That is also how a *missing* test was found — the first regression test for the race
passed an over-restrictive mutation (revoking a consent nobody withdrew), so a second case was
needed. Failing closed is the safe direction, but silently revoking consent stops the feature for
no reason the user can see, and only a test that starts from a granted state can see it.

## Where this generalizes

Any predicate that authorizes an outbound side effect and can change mid-flight: consent,
entitlement, feature flags read from synced or remote config, session validity. The pattern is
the same — check at the call, read live, one home for the predicate, and make the race
asymmetric in the safe direction.

Related: [`../logic-errors/read-modify-write-lost-update-synced-file.md`](../logic-errors/read-modify-write-lost-update-synced-file.md)
(the same synced-file race, in the vault write path rather than the settings path).
Full review: [`../../qa/2026-08-06-323-followup-ce-code-review.md`](../../qa/2026-08-06-323-followup-ce-code-review.md).
