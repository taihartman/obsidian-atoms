---
module: platform/autorun
tags: [auto-run, filing-window, structural-coupling, thresholds, refactor]
problem_type: logic-error
date: 2026-08-10
issue: 427
---

# A bound resolved once for two consumers must reach both by construction, not by convention

## The problem

Bounding auto-filing to a window meant two different operations had to agree on the same `since`
day: the recount that decides whether the day can be stamped, and the write that actually files
captures. If the count kept scanning all history while the write filed only the window, the
recount would never reach zero, `shouldStampLastRunDay` would never stamp the calendar day, and
auto-run would rescan the whole vault every hour, forever — silently, because the cost is vault
reads rather than API spend (`src/platform/autorun.ts:295-300`, commit `8e067b0`).

Two call sites resolving `since` independently — one for the count, one for the write — would
type-check and pass code review; nothing about two separate `resolveAutoFilingSince(...)` calls
looks wrong. It is only wrong if the two calls can ever disagree, which they eventually would:
different call order, a stamp written between the two calls, a future edit to one call site that
forgets the other exists.

A second, narrower version of the same trap was found in the same unit. `countPastUnprocessed`
took a positional `fallback = 0` (`src/plugin/main.ts:1249-1267`, prior to this branch). Adding a
leading `since` bound to that same positional list would have silently shifted every existing
caller's `fallback` argument into the `since` position — the fallback value becoming the bound,
with no type error to catch it.

## The fix

`runAutoFilingCycle` (`src/platform/autorun.ts:304-320`) resolves `since` exactly once, at the top
of the cycle, and hands that one string to both the `count` callback and the `file` callback:

```ts
export async function runAutoFilingCycle(
  deps: AutoFilingCycleDeps,
): Promise<AutoFilingCycleResult> {
  const since = resolveAutoFilingSince(deps.load, deps.save, deps.today);
  // ...since is threaded to both deps.count(since, ...) and deps.file(since)
```

The doc comment names the property directly: *"Resolving `since` here, and handing that same
string to both callbacks, makes the drift unrepresentable rather than merely tested for."* There is
no code path left where the count and the write can see different bounds, because there is only
one place `since` is computed.

`countPastUnprocessed` was changed from a positional `fallback` to an options object —
`{ since?: string; fallback?: number }` — specifically because both are scalars sitting at the
same call-site shape a future edit could silently reorder:

```ts
private async countPastUnprocessed(
  opts: { since?: string; fallback?: number } = {},
): Promise<number> { ... }
```

## How to apply this next time

- **When two operations must agree on a derived value, resolve it once and pass the resolved value
  down — do not let each operation re-derive it.** Two calls to the same resolver function are not
  the same guarantee as one call whose result is threaded to both consumers; only the latter makes
  disagreement a compile-time impossibility rather than a runtime hope.
- **A pass with no visible failure mode (it just silently does more work than it should) is worse
  than a pass that crashes** — nothing surfaces it except vault-read cost climbing with vault age.
  Treat "the recount can never reach zero" as a structural risk worth designing out, not just
  testing for.
- **Two same-typed scalar parameters at the same position in a call signature are a rename hazard.**
  Adding a new leading parameter of the same type as an existing positional one silently shifts
  every caller. Prefer an options object once a function has more than one scalar parameter of the
  same primitive type, especially on a bound/threshold surface.
- **Extracting shared logic into one function that owns both consumers is often the actual fix**,
  not just a readability improvement — see `runAutoFilingCycle`, which exists specifically so the
  coupling is structural.

## Evidence

- `src/platform/autorun.ts:292-320` — `runAutoFilingCycle`, extracted from `maybeAutoRun` in commit
  `8e067b0` for exactly this reason.
- `src/plugin/main.ts:1249-1267` — `countPastUnprocessed`'s options-object signature and the
  comment explaining the positional-fallback hazard it replaced.
- Regression coverage: `test/autorun.test.ts` drives 600 captures through the real cycle to prove
  the recount terminates (commit `8e067b0`).

## Related

- [`a-threshold-whose-numerator-and-denominator-count-different-sets`](a-threshold-whose-numerator-and-denominator-count-different-sets.md)
  — a sibling failure on a different gate: there, two variables answering two different questions
  were compared as if they counted the same set. Here, the risk was two *call sites* re-deriving a
  bound that had to be the same value; the fix in both cases is the same instinct — make the shared
  quantity impossible to compute twice.
- Plan `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`, KTD2.
