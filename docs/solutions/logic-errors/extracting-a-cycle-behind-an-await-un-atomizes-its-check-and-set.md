---
module: platform/autorun
tags: [auto-run, concurrency, await, in-flight-lock, refactor]
problem_type: logic-error
date: 2026-08-10
issue: 427
---

# Extracting a cycle behind an `await` can silently un-atomize a check-and-set

## The problem

Auto-filing's in-flight guard exists to stop two concurrent passes — onload, an hourly interval,
the manual catch-up, and CLI commands can all land in the same tick — from both paying for a
classification API call. Before this branch, the check-and-set (`if in-flight, refuse; else claim`)
sat directly at the top of `maybeAutoRun` with no `await` between the check and the set: one
synchronous step, safe by construction.

Extracting that logic into `runAutoFilingCycle` (`8e067b0`) moved the whole pass — resolve bound,
count, gate, file — behind a single `async function` boundary. The refactor's obvious shape was to
resolve `since` first (an `await`-free step) and check the in-flight guard as part of the `gate`
callback, which runs after the count — itself asynchronous. That would have reopened exactly the
race the guard exists to close: two callers both observing "not in flight" during the count, both
proceeding to `gate`, both claiming the write.

## Why it happened

**An `await` inserted anywhere between a check and its matching set breaks the atomicity, even if
neither the check nor the set individually changed.** The code before and after a refactor can look
almost identical — same `if (inFlight) return false; inFlight = true;` shape — while the refactor
silently moved something asynchronous in between. Nothing in the diff of the guard itself would
show this; the danger is in what now runs *before* it that didn't before.

**A synchronous guard's safety is a property of its position in the call graph, not just its own
code.** `beginWork`/`endWork` in `AutoFilingCycleDeps` are typed as ordinary optional callbacks —
nothing in the type system says "this must run before the first `await` in the function that calls
it." The constraint is enforced by discipline at the one call site (`runAutoFilingCycle`), not by
anything the compiler checks.

## The fix

`runAutoFilingCycle` explicitly claims the in-flight slot as the very first thing it does, before
resolving anything that requires an `await`:

```ts
export async function runAutoFilingCycle(
  deps: AutoFilingCycleDeps,
): Promise<AutoFilingCycleResult> {
  const since = resolveAutoFilingSince(deps.load, deps.save, deps.today); // synchronous

  // Claim before the first await, and hold it for the whole cycle. Everything below can
  // yield, so any check that lived past this point would be a check another caller could
  // slip through.
  if (deps.beginWork?.() === false) {
    return { ran: false, reason: "in_flight", since, filed: 0, stamped: false, pastRemainingAfter: 0 };
  }
  ...
```

The doc comment on `beginWork` in `AutoFilingCycleDeps` (`src/platform/autorun.ts:266-274`) states
the constraint directly: *"The claim must be one uninterrupted check-and-set: the cycle calls this
before its first `await`."* The concrete claim in `main.ts` is a plain boolean flag —

```ts
beginWork: () => {
  if (this.autoRunInFlight) return false;
  this.autoRunInFlight = true;
  return true;
},
```

— and it stays synchronous precisely because everything that could make it asynchronous (resolving
auth, counting past captures) happens after the claim, inside the cycle, where losing the race no
longer matters because the slot is already held.

A related ordering bug surfaced in the same review: `filingStartedAt` (used by the resume logic and
home's status card to show "filing in progress") was originally set inside `beginWork`, which meant
a pass the *gate* went on to refuse was still briefly reporting itself as actively filing. It was
moved into the `file` callback instead — marked only once a write pass is actually about to run,
not merely once the lock is claimed (commit `f866f0e`).

## How to apply this next time

- **After any refactor that wraps existing logic in an `async` function, re-check every guard that
  was previously atomic by adjacency.** A check-and-set that used to be two adjacent synchronous
  lines is not automatically still atomic once it lives inside a function with `await` in it
  somewhere — trace what now executes between the check and the set, not just whether the check and
  set themselves changed.
- **State the ordering constraint in a comment at the point of call, not just at the point of
  definition.** The type signature of `beginWork` cannot express "call this before your first
  await"; only a comment at the one call site that must honor it can, and it should say what breaks
  if a future edit moves something ahead of it.
- **Distinguish "the slot is claimed" from "the work described by the slot has started."** Setting a
  status flag inside the claim conflates the two and can report a refused pass as an in-progress
  one; move status flags to the point where the guarded work actually begins.

## Evidence

- `src/platform/autorun.ts:266-320` — `AutoFilingCycleDeps.beginWork` doc comment and
  `runAutoFilingCycle`'s claim-before-first-`await` structure.
- `src/plugin/main.ts:1143-1161` — the concrete `beginWork`/`endWork`/`file` wiring, including the
  comment explaining why `filingStartedAt` moved out of `beginWork`.
- Fixed/verified across commits `8e067b0` (extraction preserved the invariant) and `f866f0e`
  (`filingStartedAt` ordering, found in the same multi-agent review pass).

## Related

- [`a-shared-promise-dedupes-the-retries-too`](a-shared-promise-dedupes-the-retries-too.md) — a
  different concurrency hazard on a shared in-flight primitive; both are about what a refactor
  changes for concurrent callers even when the guarded logic itself looks unchanged.
- Plan `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`, KTD3.
