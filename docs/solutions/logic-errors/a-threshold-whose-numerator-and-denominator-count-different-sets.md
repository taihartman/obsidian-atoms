---
module: platform/askMirror
tags: [ask-mirror, data-loss, guards, thresholds, review]
problem_type: logic-error
date: 2026-08-04
issue: 248
---

# A threshold whose numerator and denominator count different sets

## The problem

The Ask mirror's completeness gate refuses to delete when the local scan looks too small
against this device's own hash evidence. Two prior learnings already cover where the
*denominator* comes from ([a completeness floor seeded from its own scan is not a
floor](a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md)) and when the
*evidence* is refreshed ([a guard that refreshes its evidence only when it
refuses](a-guard-that-refreshes-its-evidence-only-when-it-refuses.md)). This is the third
seeding failure in the same gate, on an axis neither covers: the numerator and the
denominator counted **different sets**.

```ts
const scannedCount = vaultPaths.size;                       // every file the scan found
const floor = mirrorCompletenessFloor(evidenceCount, ...);  // derived from the hash map
if (scannedCount < floor) refuse();                         // comparing apples to oranges
```

Both are integers, both are "how many atoms", and the comparison type-checks. But
`vaultPaths` is *whatever is in the vault now* and the floor is derived from *what this
device previously mirrored*. A file in one set need not be in the other, so a newly created
atom silently pays for a missing one:

| | evidence | vault shows | scan count | floor | verdict |
|---|---|---|---|---|---|
| Intended catch | 400 | 230 of the 400 | 230 | 320 | refuse |
| Actual | 400 | 230 of the 400 **+ 100 new** | 330 | 320 | **allow — deletes 170** |

Those 170 rows were missing only because Obsidian Sync had not finished downloading them.
Server deletes are hard deletes with no tombstone, and the only recovery — re-uploading
from the vault — is exactly what an incomplete scan means you cannot do. This is the
original #225 bug, reached through the guard added to prevent it.

## Why it happened

**One variable was answering two questions.** `scannedCount` was genuinely correct for the
other arm of the same function: the server tripwire asks "how many rows survive a
reconcile", and a reconcile sends `vaultPaths` as `keepPaths`, so vault cardinality *is*
the honest measure there. The name was true for one caller and a lie for the other, and
nothing in the type system distinguishes `number` from `number`.

**Cardinality reads as a proxy for membership.** "Did enough survive?" feels like a counting
question. It is a set question. Counting only answers it when the thing being counted is
the same set the threshold was built from.

## The fix

Split the variable, one per question, and name each after what it measures:

```ts
const scannedCount = vaultPaths.size;                            // keepPaths -> tripwire
const survivingEvidenceCount = evidenceCount - deletePaths.length; // -> completeness floor
```

Every path the delete planner named is an evidence path the scan did not find, so the
subtraction is exact rather than an estimate. The completeness arm uses
`survivingEvidenceCount`; the reconcile tripwire keeps `scannedCount`.

The high-water mark had to move with it. It previously ratcheted on
`max(highWater, scannedCount, evidenceCount)` — vault cardinality — which after this change
would pin the floor to exactly `evidenceCount` and refuse for any user who both added
atoms and deleted one. A threshold and its baseline have to measure the same thing.

## How to apply this next time

- **When a guard compares two numbers, name the sets they count and check they are the
  same set.** Same units and same type are not the same set. If you cannot say "both of
  these count members of X", the comparison is unsound however plausible the arithmetic.
- **A variable reused across two arms of one decision is a smell on a safety surface.** The
  question to ask is not "is this value correct?" but "is it correct *for this arm*". Here
  it was correct for exactly one of two.
- **Move the baseline when you move the measure.** A ratchet, floor, or high-water mark
  derived from the old quantity silently becomes a different (often stricter) rule.
- **Construct the adversarial row before believing the guard.** The table above is what
  made this legible; "230 + 100 = 330 > 320" is obvious once written and invisible in
  prose. Every threshold deserves one row where it *should* fire and one where the numbers
  conspire.

## Evidence

- Found by a post-merge multi-agent code review of #226, not by the pre-merge QA — the
  adversarial half of that QA pass had failed to run (the cross-model peer's CLI was
  broken and the in-process fallback had already been removed), which is why the finding
  set was a floor rather than a ceiling. If the adversarial lens does not run, say so.
- Fixed in #248 / [PR #249](https://github.com/taihartman/obsidian-atoms/pull/249).
- Regression coverage: `test/askMirrorGate.adversarial.test.ts` § "G: new atoms cannot pay
  for missing ones", including the control that a genuinely complete vault which also grew
  still passes — a fix that wedges the ordinary case is not a fix.
- Verified by mutation: reverting the numerator to `scannedCount` turns that suite red.

## Related

- [A completeness floor seeded from its own scan is not a floor](a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md) — same gate, where the denominator comes from.
- [A guard that refreshes its evidence only when it refuses](a-guard-that-refreshes-its-evidence-only-when-it-refuses.md) — same gate, when the evidence is refreshed.
