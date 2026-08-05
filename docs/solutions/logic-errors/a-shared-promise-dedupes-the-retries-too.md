---
title: "A shared promise dedupes the notice — and the retries with it"
date: 2026-08-04
category: logic-errors
module: plus-resume
problem_type: logic_error
component: plus-resume
symptoms:
  - "One Stripe checkout produced seven identical `Atoms Plus is ready` notices"
  - "The duplicates only appeared in production, never in the local suite"
  - "The obvious dedupe fix passed every test while making a worse failure reachable"
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components:
  - plus-client
  - stripe-checkout
tags:
  - toctou
  - check-then-act
  - single-flight
  - test-fidelity
  - mutation-testing
  - post-checkout-poll
---

# A shared promise dedupes the notice — and the retries with it

## Problem

The post-Stripe-checkout poll announced readiness once per *in-flight call* instead of once per checkout. The first real production trial signup produced seven identical `Atoms Plus is ready` notices ([#280](https://github.com/taihartman/obsidian-atoms/issues/280)).

The interesting part is not that bug. It is that the natural fix for it was worse than the bug, and every test still passed.

## Symptoms

- Seven stacked notices in Settings after one checkout.
- Zero reproduction locally — the race needs a slow backend, and the Fly app auto-stops, so the first request after idle pays a cold start.
- `src/platform/plusResume.ts` had **no test file at all**, so nothing exercised the poll wiring.

## Why it happened

The awaiting-checkout guard and the announcement sat on opposite sides of an `await`:

```ts
if (!isAwaitingCheckout(host.app)) return false;        // check
const record = await refreshPlusEntitlementRecord(...); // flag still set here
clearAwaitingCheckout(host.app);                        // act
new Notice("Atoms Plus is ready", 6000);
```

Classic check-then-act. The flag is synchronous `localStorage`, so clearing it works fine — but every caller already *past* the check is committed. Four uncoordinated triggers feed the function: initial load, a 5s `setInterval`, `visibilitychange`, and `focus` (the last two fire **together** on return from Stripe). When entitlement flipped, every in-flight caller cleared the flag and announced.

Same family as [[read-modify-write-lost-update-synced-file]] — a read, an `await`, and a write that assumes nothing moved in between.

## What didn't work

**Coalescing every caller onto one in-flight promise.** A `WeakMap<app, Promise<boolean>>`: the first call runs, everyone else awaits its result, only one body reaches the announce. It fixed #280, the new tests passed, and the full suite stayed green.

It was the wrong fix, and code review caught it — a reliability lens, a correctness lens, and the cross-model peer all landed on the same thing independently:

`plusFetchRequest` has **no timeout**. Before the change, four independent callers meant a hung request never blocked the others from trying fresh. After it, every subsequent tick, focus, and visibility change re-attached to the *same* hung promise. One cold-started backend that never answers would absorb the entire 40s poll budget, and the user would be told nothing at all.

On a code path whose only job is telling a paying user their entitlement landed, **silence is a worse failure than a duplicate**. That is the [#230](https://github.com/taihartman/obsidian-atoms/issues/230) shape again — a user who already paid, stranded. The dedupe traded a cosmetic bug for a revenue-visible one.

## Solution

Don't coordinate the callers. Make the announcement itself atomic.

```ts
// Re-read the flag here. Nothing below yields, so clear-and-notice is one
// synchronous block and only the first caller through can announce.
if (!isAwaitingCheckout(host.app)) return true;
clearAwaitingCheckout(host.app);
new Notice("Atoms Plus is ready", 6000);
return true;
```

JavaScript is single-threaded, so a check-then-act with **no `await` between the check and the act** cannot interleave. The second caller re-reads the flag, sees it cleared, and returns without announcing.

No shared promise, no `WeakMap`, and the four triggers keep issuing independent requests — the redundancy that made a hung request survivable in the first place. The fix is also smaller than the one it replaced.

## Why this works

The duplicate-notice bug and the hang-resilience property live at different layers, and the coalescing fix conflated them:

| | Mechanism | Consequence of removing it |
|---|---|---|
| Announcing once | must be **atomic** | duplicate notices (cosmetic) |
| Reaching the backend | must be **redundant** | silence (revenue-visible) |

Deduplication at the *call* layer bought announce-once by paying with redundancy. Deduplication at the *effect* layer buys announce-once for free. When a dedupe fix spans an `await`, ask which property you are actually deleting.

## Prevention

**Fix the effect, not the callers.** When several triggers legitimately race toward one side effect, guard the side effect with a synchronous check-and-clear. Reach for single-flight only when the *work* is genuinely too expensive to repeat — and then only with a timeout, because an unbounded shared promise converts one hang into total silence.

**Mutation-prove both directions.** Every test here was checked by breaking the code and confirming the right test failed:

- remove the atomic re-check → `announces once … in flight` fails
- reintroduce coalescing → `keeps polling independently` times out

**A passing test is not evidence until you have seen it fail for the right reason.** The review demonstrated this on the original test suite: it copied the repo to scratch, swapped the per-app `WeakMap` for a module-global slot — the exact regression the code's own comment warned against — and **all five tests still passed**, including the one named "does not couple two devices' polls to each other". That test awaited device B to completion *before* device A's gated refresh was ever called, so the two never overlapped. A concurrency test whose calls do not overlap is asserting nothing. Start the first call, then await the second:

```ts
const releaseA = deferredRefresh(deviceA);
const a = refreshPlusSessionQuiet(hostFor(deviceA)); // pending, gated
const b = await refreshPlusSessionQuiet(hostFor(deviceB)); // must not wait on A
```

**Untested modules are where four-trigger races live.** `plusResume.ts` had no test file; the wiring that made the race reachable (`schedulePlusCheckoutResume`) had no coverage at all until [#282](https://github.com/taihartman/obsidian-atoms/issues/282). Absence of a test file next to timing-sensitive code is itself the signal.

## See also

- [[read-modify-write-lost-update-synced-file]] — the same read-`await`-write shape, losing data instead of duplicating notices
- [[a-signal-nobody-receives-is-not-a-signal]] — the other half of this area: an alert that sends successfully to nobody
