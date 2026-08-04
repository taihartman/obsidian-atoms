---
module: platform/askMirror
tags: [ask-mirror, data-loss, guards, sync, thresholds]
problem_type: logic-error
date: 2026-08-01
issue: 225
---

# A completeness floor seeded from its own scan is not a floor

## The problem

The Ask mirror deletes cloud atoms the local vault no longer has. On a device whose vault has not
finished downloading, "no longer has" and "has not arrived yet" are the same observation, so a
partially-synced phone deleted the user's cloud brain. Deletes are hard deletes with no tombstone
(`plus-service/src/store/askPostgresMethods.mjs:230-243`), and the only recovery — re-uploading from
the vault — is exactly what an incomplete scan means you cannot do.

The fix is a completeness floor: refuse deletion when the scanned path count falls too far below a
baseline. **The floor is only as good as where the baseline comes from, and there are three separate
ways to get that wrong. Each one produces a guard that passes its own tests while deleting the user's
data.**

## The three seeding failures, in the order they were found

### 1. The baseline is the server's count, not this device's evidence

The natural reading of "is this scan complete?" is "does it cover what the server holds?" But
`deletePaths` is derived from *this device's* hash evidence, while the server's total spans all
devices. Comparing them makes the floor a no-op on precisely the at-risk devices: 60 paths in
evidence against a 400-row server clears a `max(5, 400 × 0.2)` bar and deletes all 60.

**Rule: the denominator is the evidence the delete plan was derived from.** Anything else is
comparing two different populations.

### 2. The baseline is seeded from the scan being judged

Persisting a high-water mark of the scanned count is right. Initializing it from the current scan
makes the ratio self-referential: a device holding 300 of 400 atoms seeds `highWater = 300`, computes
a floor of 240, passes, and deletes the 100 that had merely not downloaded yet.

What makes this dangerous is that **the obvious test does not catch it.** The headline 3-of-400 case
passes through the `max(5, …)` arm — scan 3 is below 5 whichever denominator you chose — so the suite
goes green with the guard defeated for every vault above ~6 atoms. Catching it requires a scenario
whose scan is large enough to clear the absolute arm but small relative to the evidence: **400 in
evidence, 300 scanned, no prior mark.** That one test is the entire difference between a real guard
and a decorative one.

**Rule: a refused pass writes no mark, and a mark is never derived from the scan currently under
judgment.**

### 3. The baseline is recorded before the gate ever runs

This is the one that survived the first implementation *and* its test suite, and it is the subtlest.
The gate was evaluated only when there was something to delete (`deletePaths.length > 0 || force`) —
sensible, since otherwise every ordinary pass flips a refusal state on with nothing being refused.

But a **fresh device has empty hash evidence, so it plans zero deletes.** The gate is skipped, the
pass succeeds as upsert-only, and the success tail records the high-water mark from that first
partial scan. A phone holding 10 of 400 atoms now has `highWater = 10`. The next "Sync now" computes
a floor of 8, sees 10, and reconciles the other 390 away — through the forced path, with the delta
guard working perfectly the whole time.

The failure is not in the floor's arithmetic. It is that **the bookkeeping ran on a path the gate did
not.** Any pass that writes the baseline must be a pass the gate evaluated.

The fix was a second, independent tripwire on the reconcile path keyed to the last known server
count. Note this does *not* contradict rule 1: rule 1 forbids the server count as the denominator of
a rule that **permits** deletion. Using it in a rule that only ever **refuses** more is strictly
additive. A delete must clear both floors. The direction of a comparison decides whether reusing a
population is safe.

## The generalizable rule

**A guard that derives its own threshold from the observation it is judging has no threshold.** Every
gate keyed to "is this input complete?" needs its baseline to come from a source the current input
cannot move — a prior high-water mark, an independent counter, a server-side figure — and that
baseline must only ever be written on a path the gate itself evaluated.

Three corollaries worth carrying:

- **Test the case that clears the absolute floor.** A `max(N, ratio × baseline)` guard has two arms,
  and the dramatic scenario usually exercises the wrong one. Write the scenario that is large enough
  to pass the constant and small enough to fail the ratio, or the ratio is untested.
- **The absolute arm is a floor on the requirement, so it wedges small inputs.** `max(5, …)` written
  to protect tiny vaults is what breaks them: a fully-scanned 3-atom vault fails a floor of 5 forever
  and escalates a data-safety alarm at a user with nothing wrong. Clamp it: `min(baseline, max(5, …))`.
- **Every refusal needs a release valve that ships in the same change.** A user who legitimately
  pruned half their atoms must be able to say so. A guard whose only escape hatch is scheduled for a
  later phase is a permanent stuck state for anyone who hits it in between.

## The adjacent bug this rhymes with

The outbox had the same shape from the other direction: `applyAskOutbox` acked on a `0` return, but
`0` meant both "nothing to upload" and "deferred to an in-flight pass", so a concurrent push acked
writes the cloud never received. **An overloaded sentinel is the same class of error as a
self-derived threshold** — in both cases a value that should have carried provenance carried only a
magnitude. The fix was the same in spirit: make the states distinct and named (worked / joined /
refused / failed) so the ambiguous one cannot be read as the safe one.

## See also

- `docs/qa/2026-08-01-225-plus-service-delete-semantics.md` — hard-delete confirmation, chunked
  reconcile session semantics, and two server-side hazards found while answering them
- `docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md` — the sibling hazard on
  the inbox side, where Obsidian Sync replaces a file out-of-band
- `docs/architecture.md` invariant 7 — the ack rule this work rewrote
