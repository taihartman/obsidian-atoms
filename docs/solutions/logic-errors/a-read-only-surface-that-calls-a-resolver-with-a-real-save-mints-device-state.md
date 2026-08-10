---
module: platform/autorun
tags: [auto-run, filing-window, migration, read-write-separation, device-local]
problem_type: logic-error
date: 2026-08-10
issue: 427
---

# A read-only surface that calls a resolver with a real `save` mints device state

## The problem

`resolveAutoFilingSince(load, save, today)` (`src/platform/autorun.ts:179-188`) both returns the
filing-window bound *and*, as a side effect, persists it the first time an enabled device has no
stamped start day. That is the correct behavior for the one caller that is actually filing. Two
other call sites — Atoms home's view refresh and the `atoms:auto-run-status` command — used to call
the same resolver with the plugin's real `save`, because it was the function that returned the
bound they needed to display.

Home's `onOpen` runs on every leaf refresh; the status command runs on demand. Neither is the user
turning filing on. But both were writing device state as a side effect of being *looked at*.

Beyond the general wrongness of a sidebar view writing persistent state on render, this broke a
specific downstream mechanism: `migrateAutoFilingWindow` (`src/platform/autorun.ts:137-148`) stamps
a start day for a device that already had filing on before the window existed, but **only when no
start day is stored yet** (`if (readAutoFilingStartDay(load) !== null) return false;`). Home's
`onOpen` can run before the migration does — the migration waits on the vault index being ready.
So the sequence became: home renders, home's call to the resolver stamps a start day (because none
existed yet), the migration runs moments later, sees a start day already present, and skips —
never setting `LS_AUTO_RUN_WINDOW_MIGRATED`. The flag exists specifically so a later UI surface can
explain *why* an already-enabled device's silent sweep paused (upgrading via auto-update shows no
release notes). With the flag never set, the device just stopped filing history it had been filing
before, with nothing on screen to say why.

This was independently found by three different reviewers on the same diff.

## Why it happened

**A function that both computes and persists looks safe to call from anywhere that needs the
computed value.** `resolveAutoFilingSince` is correct for its one intended caller (the cycle that is
about to file). It reads as a general-purpose "give me the bound" accessor because its return type
is exactly what a read-only caller wants, and nothing in its signature marks the side effect.
Nothing forced the two new call sites to notice that "get the bound" and "get the bound, and maybe
stamp it" are different operations with the same return value.

**A migration guarded by absence-of-state is fragile against any other writer of that state.**
`migrateAutoFilingWindow`'s guard is correct in isolation — "stamp once, only if nothing is stamped
yet" is the right rule for a one-time migration. It becomes wrong the moment something else can
write that same key before the migration runs, because the guard cannot distinguish "the migration
already ran" from "something else got there first."

## The fix

A second, named function with the write removed:

```ts
/**
 * The same bound, for surfaces that only *read* it — home's refresh, the status command.
 * Opening a sidebar view or running a diagnostic is not the user turning filing on, so
 * neither may mint device state.
 */
export function readAutoFilingSince(
  load: (key: string) => unknown,
  today: string,
): string {
  const stored = readAutoFilingStartDay(load);
  if (stored) return stored;
  return isFilingDay(today) ? today : localDateString();
}
```

Home and the status command now call `readAutoFilingSince`; only `runAutoFilingCycle` (the actual
filing pass) calls `resolveAutoFilingSince`. The two functions return the identical bound in every
case — the only difference is whether a missing stamp gets written.

The doc comment on `readAutoFilingSince` states directly why this is a named function and not a
`() => {}` passed as `save` at each read-only call site: *"a `() => {}` says nothing about why and
is one careless edit away from being undone."* A no-op lambda at the call site records only that
nothing happens, not that nothing is *supposed* to happen — a future edit could reattach a real
`save` without anything flagging that the surface was deliberately read-only.

## How to apply this next time

- **A function that reads-and-maybe-writes is not safe to call from a surface that should only
  read.** If a getter has a persisting side effect for its intended caller, give read-only callers
  a separate function rather than trusting them to pass a no-op — the no-op is silent about intent
  and gets undone by a later edit that "simplifies" the call site back to the real `save`.
- **A migration or one-time stamp guarded by "does this state exist yet" is only as safe as the set
  of things that can write that state before the migration runs.** Audit every writer of the guarded
  key, not just the migration's own write — a `View.onOpen` firing before your migration is a real
  ordering, not a hypothetical one, whenever the migration itself is gated on something slower (here,
  the vault index).
- **Multiple independent reviewers converging on the same finding is a signal the bug is real, not
  a signal to stop looking for others on the same surface.** This was reviewer finding #1 of four
  fixed together in commit `f866f0e`; the other three (a disabled device still claiming the
  in-flight lock, `filingStartedAt` set before the gate, an unwrapped migration throw killing
  filing until restart) were on the same code path and none subsumed another.

## Evidence

- `src/platform/autorun.ts:179-211` — `resolveAutoFilingSince` and `readAutoFilingSince` side by
  side, with the comment on each explaining which callers may use it.
- `src/plugin/main.ts` — Atoms home's refresh and the `atoms:auto-run-status` command now call
  `readAutoFilingSince`.
- Fixed in commit `f866f0e`, one of four findings from a multi-agent review including an
  independent cross-model adversarial pass.

## Related

- [`a-guard-that-refreshes-its-evidence-only-when-it-refuses`](a-guard-that-refreshes-its-evidence-only-when-it-refuses.md)
  — a different read/write-timing failure on a gate: there, evidence was refreshed only on the
  refusal path; here, a read-only surface was writing when it should never write at all.
- Plan `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`, KTD5/KTD6.
