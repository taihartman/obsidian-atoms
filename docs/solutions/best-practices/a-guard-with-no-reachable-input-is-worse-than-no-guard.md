---
module: platform/autorun
tags: [auto-run, filing-window, dead-code, guards, readability]
problem_type: logic-error
date: 2026-08-10
issue: 427
---

# A guard with no reachable input is worse than no guard

## The problem

`includeTodayForRun` existed in the auto-filing path to force every unattended source — onload,
the hourly interval, the manual catch-up, resume — back to `includeToday: false`, no matter what
they individually passed. It read as a safety net: the one place a caller's mistaken `true` would
be caught and corrected before reaching `runWritePath`.

Once commit `4fa7cef` fixed the enable path so no caller ever threaded `includeToday: true` into
the auto-filing cycle in the first place (see
[`a-consent-parity-test-that-freezes-words-does-not-freeze-behavior`](../security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md)),
`includeTodayForRun` had no remaining caller that could supply anything other than `false`. It kept
compiling, kept passing its tests, and kept reading as protection — a parameter with "for-run"
right in its name, guarding against a value nothing produced anymore.

## Why it happened

**A guard's presence is read as evidence that the thing it guards against can still happen.** A
reviewer or future editor scanning this code sees `includeTodayForRun` forcing a value to `false`
and reasonably concludes some caller somewhere might pass `true` — that is what the parameter is
*for*. Once the last such caller is removed, the guard's meaning inverts without any of its own
code changing: it stops being protection and becomes a claim about the codebase that is no longer
true.

**Removing the last caller of a defensive parameter is easy to do without revisiting the parameter
itself.** The fix in `4fa7cef` was about the enable path's behavior; `includeTodayForRun` was
several calls upstream of that fix and kept working exactly as before. Nothing about fixing the
bug forced anyone to look at whether the guard it had made obsolete.

## The fix

`includeTodayForRun` and `maybeAutoRun`'s attended parameter were deleted, not defaulted. The call
site now passes the literal it always resolved to:

```ts
// Never today, from any source — onload, the hourly interval, resume, the manual
// catch-up, and the enable tap all land here. The egress disclosure the user accepts
// says "today's daily note is never auto-touched"; written as a literal so no caller
// can thread a different value in.
includeToday: false,
```

`countPastUnprocessed` got the same treatment on its own guard: it is past-only "by type" now —
there is no parameter through which a caller could ask it to include today, rather than a parameter
that is always passed `false`.

## How to apply this next time

- **When you remove the last caller that could pass a non-default value to a defensive parameter,
  remove the parameter, not just its callers.** A parameter still accepting a value nothing supplies
  is a claim — "this can vary" — that stopped being true and now misleads the next reader.
- **Prefer "there is no value to pass" over "the value is always false."** A literal at the call
  site (`includeToday: false`) is a stronger statement than a variable that always evaluates to
  `false`: it is not just currently false, it is *structurally* unable to be anything else, and a
  future caller who wants today's daily has to add a new parameter rather than flip an existing one
  — a visible change instead of a silent one.
- **When fixing a behavioral bug, check whether the fix obsoletes a guard upstream of it.** The
  guard is often not wrong to remove, but it is easy to leave in place because removing it is a
  separate, unglamorous diff from the fix itself.

## Evidence

- `src/plugin/main.ts:1179` — `includeToday: false` literal, replacing `includeTodayForRun`.
- `src/plugin/main.ts:1256-1267` — `countPastUnprocessed`'s past-only-by-type signature.
- Fixed in commit `4fa7cef`, alongside the behavioral fix that made the guard's input unreachable.

## Related

- [`a-consent-parity-test-that-freezes-words-does-not-freeze-behavior`](../security/a-consent-parity-test-that-freezes-words-does-not-freeze-behavior.md)
  — the behavioral fix that removed the guard's last caller.
- Plan `docs/plans/2026-08-10-003-feat-auto-filing-window-backfill-split-plan.md`.
