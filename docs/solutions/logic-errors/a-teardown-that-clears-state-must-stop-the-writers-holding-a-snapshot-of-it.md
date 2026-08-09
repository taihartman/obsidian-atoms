---
title: "A teardown that clears state must stop the writers already holding a snapshot of it"
date: 2026-08-09
category: logic-errors
module: ask-mirror/teardown
problem_type: logic_error
component: plugin
symptoms:
  - "Sign-out cleared the hash baseline, and moments later the baseline was back"
  - "The next account's first sync uploaded almost nothing while Settings read 'last pushed just now'"
  - "Every unit test of the teardown passed; the hole only opened when a sync happened to be running"
  - "The bug the fix was written to close reappeared through the fix's own new code path"
root_cause: race_condition
resolution_type: code_fix
severity: high
tags:
  - consent
  - egress
  - teardown
  - race-condition
  - in-flight-writes
---

# A teardown that clears state must stop the writers already holding a snapshot of it

## Problem

[#372](https://github.com/taihartman/obsidian-atoms/issues/372) made sign-out clear the Ask mirror's device-local hash baseline, so a different Plus account could not inherit it. The teardown was correct in isolation and fully tested. It still lost the baseline race: a mirror sync pass already running had read the hash map *before* the teardown and wrote its copy back afterwards, restoring exactly the state sign-out had just deleted.

## Symptoms

Sign out while a sync is in flight, then sign in as a different account:

- `LS_ASK_MIRROR_HASHES` is `"{}"` immediately after the teardown, then repopulates when the running pass finishes its next chunk.
- The new account's first sync sees a full baseline, concludes nothing is dirty, and uploads almost nothing — its cloud holds a handful of atoms out of ~407 while Settings reports a healthy `last pushed just now`.
- `saveAskMirrorStatus` can likewise rewrite the mirror email that the teardown cleared.

The window is only as wide as one sync pass, but the trigger is *the user signing out during a sync*, which is not rare — a long sync is exactly when someone reaches for the off switch.

## What Didn't Work

**Testing the teardown in isolation.** Eight tests covered the teardown: the disarm, the persist, the ordering, ack preservation, the network-failure path, idempotence. All green, all correct, none capable of seeing this — every one of them ran the teardown with nothing else in flight. The gap was not in what the teardown did but in what it failed to stop.

**Reasoning about the gate.** The egress predicate `askMirrorPermitted()` is consulted at the entry to every push path, and the teardown flips its input synchronously before the first `await`. That reasoning is sound and it is why the *entry* is safe. It says nothing about a pass that already passed the gate: `runSyncOnce` documented in a comment that it does not re-check between scan and upsert, and that comment was read as a known-minor deferral rather than as the thing that would undo the fix.

## Solution

Give the in-flight pass a live predicate and consult it at the moment of writing, not at the moment of entry.

The host interface gained one optional member, wired to the predicate that already existed:

```ts
// AskCoordinator
stillPermitted: () => this.mirrorPermitted(),   // askMirrorPermitted(plugin.settings)
```

Inside the sync pass, the guard sits on a single wrapper rather than on each call site:

```ts
const permitted = () => host.stillPermitted?.() ?? true;
const save = (k: string, v: string) => {
  if (!permitted()) return;
  host.save(k, v);
};
```

Every device-local write in the pass already routed through that local `save` — the hash write, the status write, the high-water mark, the refusal record, the error and success stamps — so all of them inherited the guard at once, and a write added later inherits it without anyone remembering to. The pass also checks between chunks and abandons the rest of its work rather than finishing uploads nobody consented to.

No new state was introduced. The teardown already set `askEnabled = false` and persisted it *before* clearing device state, and `mirrorPermitted()` reads that object live — so the flip the guard needs is the disarm itself.

Optional-with-a-default of permitted keeps every existing caller and the entire uninterrupted path byte-for-byte unchanged.

## Why This Works

The bug was a read-modify-write straddling an `await`, with the modify happening in another task. The pass reads the map at start, holds it across many awaits, and writes it back repeatedly. Any state the teardown clears inside that window is state the pass will helpfully restore, because from the pass's point of view nothing changed — it never looked again.

Re-checking at the write is what closes it, and the write wrapper is the right seam precisely because it is the *narrowest* place all the writes pass through. Guarding the call sites individually would have worked today and rotted on the next write added.

The deeper reason this was easy to miss: the fix and the bug were in different files, written at different times, by people thinking about different problems. The teardown author reasons about the gesture; the sync author reasons about the pass. Neither is wrong locally.

## Prevention

**When a change starts clearing shared state, enumerate who else holds it.** The question is not "is my clear correct?" but "who read this before me and will write it after me?" Grep the writers of every key the teardown touches. If any of them is a long-running pass that snapshots, there is a race.

**Prefer a guard on the shared write path over guards on call sites.** One wrapper that every write already flows through is a fix; N guards at N call sites is a policy someone has to remember.

**A gate consulted only at entry is not a gate for long operations.** Entry checks answer "may this start?" A pass that runs for seconds across many awaits also needs "may this still write?" Both are needed; they are not the same check.

**Write the race test so it can observe the race.** The regression test parks a real sync inside `upsert` — where a slow network parks it — presses the real Sign out row, then releases the pass. It gates on a promise resolved from *inside* `upsert`, so the snapshot is provably already read before the teardown runs. A race test that relies on timing is a flake; a race test that cannot go red is decoration. This one was verified red before the fix:

```
× cannot be un-torn-down by a sync pass that was already in flight
  → expected '{"Atoms/a.md":"h1"}' to be '{}'
```

**Treat a deferred-gap comment as a live claim when new code depends on it.** `askCoordinator.ts` already carried a comment saying the mid-pass re-check was deliberately deferred and would need a live predicate threaded into the mirror host. That note was accurate and it was the fix. It sat unread because nobody re-read the sync path while changing the teardown path — see [partial adoption of a cited solution doc](../logic-errors/partial-adoption-of-a-cited-solution-doc.md) for the same failure shape.

## Related

- [Consent gate must be checked at egress, not at entry](../security/consent-gate-must-be-checked-at-egress-not-at-entry.md) — the same principle one layer up; this learning is that rule applied *within* a single long operation.
- [Read-modify-write lost update on a synced file](read-modify-write-lost-update-synced-file.md) — same hazard shape, different medium.
- [A completeness floor seeded from its own scan is not a floor](a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md) — the neighbouring "the baseline lied" family.
- Issue [#397](https://github.com/taihartman/obsidian-atoms/issues/397) was found while fixing this: on non-force passes the hub planner's hash copy clobbers freshened atom hashes, so background syncs never converge. Unrelated cause, same file.
