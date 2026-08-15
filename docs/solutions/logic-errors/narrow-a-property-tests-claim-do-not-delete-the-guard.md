---
title: "When a screen outgrows its property test, narrow the claim to what survives — do not delete the guard or widen its allowlist"
date: 2026-08-14
category: logic-errors
module: settings
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - "A property test asserting a screen does nothing now has a row whose job is to act"
  - "A test's allowlist is about to grow to accommodate new behavior"
  - "A DOM walk over every control loops forever after a control gains a re-render"
tags:
  - property-tests
  - settings
  - guards
  - test-design
  - allowlist
---

# Narrow a property test's claim; do not delete the guard

## Context

The Advanced settings screen carried a property test asserting it reached the plugin *not at all* —
a read-only screen, proven by walking every control and checking that no plugin method was called.
Then the screen gained `Sync everything now` and a resume toggle: two rows whose entire job is to
act. The old claim was now false, and the three obvious responses were all wrong:

- **Delete the test.** The screen still holds an escape hatch behind a consent gate; losing the
  guard loses the thing worth guarding.
- **Widen the allowlist quietly.** Then the test passes forever and no longer says anything — every
  future acting row gets added to the list by whoever is annoyed by the red.
- **Keep the old claim and special-case the new rows.** The assertion becomes a description of
  today's screen rather than a rule.

## Guidance

**Narrow the claim to the invariant that actually survived, then pin the exception set so widening
it is a visible decision.**

"This screen touches nothing" became **"this screen grants nothing"** — the property that still
holds and still matters, because the risk on Advanced was never that it calls the plugin, it was
that a control there could grant consent or move a gated value without asking.

That is paired with a second, tighter test naming the exact plugin entry points the screen reaches
(`test/settings.test.ts`, "reaches a named handful of plugin entry points, and widening that is a
decision"):

```ts
expect([...new Set(calls.slice(from))].sort()).toEqual([
  "getLastCatchupLine",
  "getResumeEnabled",
  "runSyncEverythingNow",
  "saveSettings",
  "setResumeEnabled",
]);
```

The comment above it carries the rule the list cannot: a sixth name appearing here means a row that
acts was moved onto Advanced, **which is the thing to look at rather than the thing to add to this
list**.

## Why This Matters

A property test's value is entirely in what it forbids. When the screen changes under it, the
question is not "how do I make this pass" but "which forbidden thing is still forbidden." Answering
that honestly usually produces a *narrower and stronger* pair of tests than the original: one
invariant claim that cannot rot, plus one exact-set claim that fails loudly on any drift.

The exact-set half is what makes the narrowing safe. Without it, "grants nothing" is a claim about
consent that a future acting row could satisfy while still being a bad idea to put on that screen.
With it, the screen's reach is pinned by name, and growing it costs a deliberate edit next to a
comment explaining why you probably should not.

Compare
[a-property-test-is-only-as-strong-as-its-observers](a-property-test-is-only-as-strong-as-its-observers.md):
there the claim was fine and the observer was blind. Here the observer was fine and the claim had
expired. Both end the same way — the test stays green while meaning less than the reader thinks.

## When to Apply

Whenever a "this thing never does X" test starts failing because the thing now legitimately does
some X. Before touching the assertion, write down what the test was protecting against in one
sentence. If that sentence is still true, the claim narrows to it. If it is no longer true, the
screen changed in a way that deserves review, not a test edit.

## Examples

**The walk itself had to change, for a related reason.** `exerciseEveryControl` clicks every control
on a screen. It remembered which ones it had already touched **by element identity**, which worked
until the new toggle called `redisplay()` — that replaces every element, so an identity set treats
the same row as new on each pass and the walk flips the toggle forever.

Fix: remember rows **by name** (`test/settings.test.ts:2542`). A name is what "this control has been
touched" actually means, and the set of names is finite, so the walk terminates:

```ts
const exercised = new Set<string>();
// ...
!exercised.has(candidate.querySelector(".setting-item-name")?.textContent ?? "")
```

The general form: **a fixed-point walk over a re-rendering UI must key on identity that survives the
re-render.** Element references do not; stable names do. This soundness depends on names being
unique on the screen, which is worth asserting rather than assuming.
