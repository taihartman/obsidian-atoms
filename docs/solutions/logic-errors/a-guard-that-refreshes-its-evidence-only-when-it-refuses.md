---
module: platform/askMirror
tags: [ask-mirror, data-loss, guards, sync, thresholds, single-flight]
problem_type: logic-error
date: 2026-08-02
issue: 225
---

# A guard that refreshes its evidence only when it refuses

## The problem

Two separate P0 data-loss holes in the mirror deletion gate, found by the adversarial half of QA
*after* the gate's own tests were green, both live-reproduced destroying 400 cloud rows. They look
unrelated. They are the same mistake twice.

**H1 — the gate asked for a fresh server count only after the stale one had already refused.**

```ts
let decision = judge();                       // judged against the STORED count
if (decision.allowed || !force) return { decision, ... };
const st = await host.status();               // refresh — but only on the refusal path
```

The comment directly above that `status()` call already said the stored count "is old by definition
on exactly the device at risk." The code acted on that sentence when the number said *no* and
ignored it when the number said *yes*.

The scenario it misses has no local signature at all. A phone holding 3 of 400 atoms scans 100% of
its own hash evidence, so the completeness floor passes; its stored server count was written when it
last synced its 3, so the reconcile tripwire passes too. **Nothing locally distinguishes that phone
from a complete 84-atom vault** — the two differ only in a fact that lives on the server. One
`status()` call separates them, and the gate skipped it precisely when it mattered.

**H2 — a force flag survived the run that owned it.** `syncAskMirror` is single-flight: a concurrent
caller joins the running pass rather than racing it, and a *forced* joiner upgrades the run by
setting `askMirrorForceFollowUp`. The `do` loop consumed that flag at the top of each pass, but the
`failed` and `refused` early returns exited without consuming it, and `finally` cleared only
`inFlight`. The next unforced push — the vault watcher fires one on any edit — then computed
`runForce = false || true` and ran a **full keepPaths reconcile with no user gesture behind it**.

## Why it happened

Both are *stale-evidence* bugs, and both were invisible to the tests that existed:

1. **The evidence was refreshed on the path where it was already sufficient.** A refusal is
   self-correcting — the user retries. An *allow* is irreversible. So the cheap path got the fresh
   data and the expensive path got the stale data. Whenever a guard's inputs can go stale, ask which
   verdict is unrecoverable, and refresh *before* that one.
2. **The dangerous state was shared mutable state written by a caller other than the one that reads
   it.** `force` here is not a parameter — it is a flag a *joining* caller sets during an `await`.
   That makes its lifetime a property of the control flow, and control flow with three exits has
   three places to forget.
3. **H2 was untestable, so it was untested.** Nothing in the repo imports `src/plugin/main.ts`
   (`test/mocks/obsidian.ts` stubs `Plugin` as an empty class). The state machine lived in the one
   file no test can reach, which is why U1 and U9 each had to begin with an extraction and why this
   fix did too.

## The fix

- **Refresh before the verdict, on every reconcile** — not only after a stale count refuses. An
  unreachable `status()` now fails closed rather than falling back to the stored number.
- **Consume the follow-up flags in `finally`**, so neither can outlive its run. Dropping a force is
  safe (nothing is deleted, and Sync now is one tap away); carrying one into an unforced run is not.
- **Extract the state machine.** `runMirrorSingleFlight` in `plugin/catchUp.ts` takes a
  `MirrorSingleFlightState` the plugin owns but never mutates by hand. `main.ts` keeps the lifecycle
  wiring and nothing else.
- **Put the unreachable-by-design case in the type.** The `no-server-count` modal reason could never
  render, because a run without a count refuses before asking — correct behaviour, so it became
  `MirrorDeletionAskReason = Exclude<MirrorDeletionRefusal, "no-server-count">` with a non-null
  count, rather than a comment claiming it.

## How to apply this next time

- **A guard's freshness policy must be keyed to which verdict is irreversible, not to which branch
  is cheap.** If the allow path is the destructive one, it is the path that must pay for fresh data.
- **A shared flag that upgrades a run's blast radius gets cleared in `finally`, always.** Not on the
  paths you remembered — on all of them, structurally.
- **A test that characterises current behaviour on a safety surface can be encoding the bug.** This
  fix deliberately flipped a *previously green* scenario ("unreachable status() does NOT stop an
  already-allowed forced reconcile"). It was describing H1's benign face. Before preserving a green
  test through a safety fix, ask whether it asserts a property you want or merely a behaviour you had.
- **A fix in an unreachable file is not a fix you can defend.** If the bug lives somewhere no test
  can import, the first step is the extraction, not the patch.

## Evidence

- Fix: `732ca20`. Report: `docs/qa/2026-08-01-fix-mirror-delete-gate-and-outbox-ack-world-class-qa.md`
  § Re-run 2026-08-02.
- Regression tests: `test/askMirrorGate.adversarial.test.ts` (39 scenarios; its 3 reds were all H1)
  and 4 single-flight scenarios in `test/catchUp.test.ts`, 3 of which were observed red against the
  pre-fix `finally`.
- H2 proven live against the shipped bundle via `obsidian eval`, driving the real `syncAskMirror`
  with only the network pass faked: `forces: [false, false]` — the push after the leak now runs
  unforced, where pre-fix it runs forced.

## Related

- [A completeness floor seeded from its own scan is not a floor](a-completeness-floor-seeded-from-its-own-scan-is-not-a-floor.md) —
  the same gate, the same class of mistake, one layer down.
- [Security fix repair wired into only one branch](security-fix-repair-wired-into-only-one-branch.md) —
  a guard applied on one path and not its twin.
