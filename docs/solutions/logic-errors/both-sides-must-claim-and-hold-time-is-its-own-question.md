---
module: plugin/main
tags: [concurrency, in-flight-lock, backfill, mutual-exclusion, code-review]
problem_type: logic-error
date: 2026-08-11
issue: 433
---

# Both sides of a mutual-exclusion pair must *claim*, and hold time is its own question

## The problem

Backfill and the two attended write passes (Process, Update notes) all rewrite the same daily notes
through a whole-file `vault.modify` taken from their own cached copy. Whichever finishes last wins,
and the loser's appended sentinels are gone — which matters more than a normal lost write, because
sentinels are the only thing making the pipeline idempotent. A capture with no sentinel gets filed
again, on a metered path the user pays for.

A code review of #433 asked for a guard, and the obvious fix went in: `runProcessUnprocessed` and
`runUpdateNotes` each got `if (this.backfillBusy()) return;` before doing any work. Tests passed,
and the direction the review had described was genuinely closed.

It closed nothing. `backfillBusy()` reads two flags, and neither attended pass set either one. So a
backfill started *after* Process was already mid-write saw an idle system and started a second paid
writer against the same dailies — the exact race the fix was written to prevent, reachable by doing
the same two things in the other order.

Three independent reviewers caught it, including a cross-model adversarial pass that rated it
confidence 100 and correctly marked it pre-existing rather than a regression.

## Why it happened

**"Check the flag" and "claim the flag" are different contracts, and only one of them is
symmetric.** A pass that checks without claiming is protected *from* the other party but is
invisible *to* it. Mutual exclusion needs both halves on both sides; one-directional exclusion is
not a weaker version of the same guarantee, it is a different and much smaller one. The asymmetry
is easy to miss precisely because the guarded direction demonstrably works — there is a passing
test, a user-visible Notice, and a real refusal to point at.

The naming helped it hide. `backfillBusy()` reads as a complete question about system state, and
its own doc comment claimed it covered "both directions, in one place". It did — for the two flags
it knew about. A predicate named for a *question* invites callers to treat it as authoritative
about the whole system, when it only ever knows about the state someone remembered to set.

**Hold time is a second, independent property that a refactor can change silently.** This same
session widened `backfillInFlight` to span the BYOK confirm gate — correct, and the reason the fix
exists. But the sibling learning
[`extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set`](extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set.md)
proved the check-and-set pattern safe for a *bounded, machine-paced* cycle: resolve, count, write,
done in seconds. A confirm modal resolves when a human clicks, or never. Reusing the pattern was
right; inheriting the assumption about how long the hold lasts was not automatic.

Then the consumer set widened. Adding `backfillBusy()` to the two attended passes was reviewed for
whether *those* passes need the guard — they do — and not for how long the flag they now depend on
can already be held. A user who opens the gate and walks away now blocks Process and Update notes
indefinitely. That is arguably correct behavior, but it was never a decision anyone made.

## The fix

A second flag, claimed by the attended passes in the same synchronous step as their check, and read
by every other entry:

```ts
// src/plugin/main.ts:2446
async runProcessUnprocessed(opts?: { includeToday?: boolean }) {
  if (this.backfillBusy()) return;
  this.manualFilingInFlight = true;
  try {
    await this.processUnprocessedRun(opts);
  } finally {
    this.manualFilingInFlight = false;
  }
}
```

`runUpdateNotes` takes the identical shape (`src/plugin/main.ts:575-590`), and the shell/inner-method
split exists for one reason: its body opens with an `await`, so a claim placed after it would leave
a real window — the sibling learning's trap, in a function that had never had a guard at all.

The new flag is then read everywhere the other two are: `backfillBusy()` (`src/plugin/main.ts:1412`)
and auto-run's `beginWork` (`src/plugin/main.ts:1213`).

## How to apply this next time

- **For every mutual-exclusion guard, ask both questions separately: who *checks* it, and who
  *claims* it.** Write the pairs out. If a party appears in the check column and not the claim
  column, exclusion is one-directional, and the failing order is whichever one your test did not
  try. A passing test for the guarded direction is not evidence about the other.
- **Test the reverse order explicitly.** The regression test that would have caught this is not
  "Process refuses during a backfill" but "backfill refuses during Process" — same two actions,
  swapped. Both now exist (`test/backfillEntry.test.ts`).
- **When a shared flag gains a new consumer, audit the flag's worst-case hold time, not just the new
  caller's correctness.** The new consumer inherits every existing holder's hold time. Ask: what is
  the longest this can be held, did that change recently, and is anything now waiting on a human?
- **Distinguish bounded from unbounded holds when reusing a concurrency pattern.** A pattern proven
  across a machine-paced cycle carries no guarantee across a human-paced gate. The pattern usually
  still applies; the *reasoning about duration* does not transfer with it.
- **Be suspicious of a predicate named for a question rather than for its inputs.** `backfillBusy()`
  sounds total. If it cannot see state that would make its answer wrong, either it should claim that
  state too, or the name and comment should say what it actually knows.

## Evidence

- `src/plugin/main.ts:268` — `manualFilingInFlight` and the comment explaining why checking without
  claiming closed nothing.
- `src/plugin/main.ts:2446` / `575` — the two attended passes, each a thin shell that checks and
  claims in one synchronous step around an inner run method.
- `src/plugin/main.ts:1403-1416` — `backfillBusy()` reading all three flags.
- `src/plugin/main.ts:1213` — auto-run's `beginWork` observing the same claim.
- `test/backfillEntry.test.ts` — "the backfill refuses to start while Process holds its flag" and
  "holds the flag across Update notes' first await, not just its guard". Both were confirmed to fail
  before the fix.
- Live-vault verification, including the exclusion probes re-run against a genuine open confirm
  gate: [`docs/qa/2026-08-11-433-backfill-p1-fixes-world-class-qa.md`](../../qa/2026-08-11-433-backfill-p1-fixes-world-class-qa.md).

## Related

- [`extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set`](extracting-a-cycle-behind-an-await-un-atomizes-its-check-and-set.md)
  — the check-and-set atomicity rule this builds on. That doc establishes *when* to claim; this one
  adds *who* must claim and *for how long* they hold it.
- [`a-shared-promise-dedupes-the-retries-too`](a-shared-promise-dedupes-the-retries-too.md) — a third
  variant of the same family: a shared exclusion primitive whose semantics for late arrivals changed
  without anyone deciding they should.
- [`a-guard-with-no-reachable-input-is-worse-than-no-guard`](../best-practices/a-guard-with-no-reachable-input-is-worse-than-no-guard.md)
  — the same session hit this too: the backfill card's button bound `disabled` to a flag that is
  never true when the card renders. Same diagnosis, opposite resolution — that guard needed a real
  input rather than deletion.
