---
module: testing
tags: [neuter-check, type-assertions, test-fixtures, fail-open, vitest, typescript]
problem_type: best-practices
---

# Three ways a test you just wrote asserts nothing

## Problem

Every guard in the #508 issuer gate was neuter-verified: break the guard, watch the tests go red, restore it. Sixteen neuters across five units. Three of them came back green, which is the failure mode the practice exists to catch — the guard was broken and the suite was happy.

None of the three was a careless test. Each was a specific, repeatable way a fresh assertion can be inert, and all three are easy to write again.

## 1. An optional field cannot be pinned by an assignability assertion

`PlusSession` gained `issuedBase?` and `verifiedBase?`, and they have to survive three separate allowlists between disk and the gate. The `FilingAuth` plus variant is the last one, and it is all `resolveClassifyAuth` ever sees, so a field dropped there vanishes silently and the gate reads `undefined` on every device: fail-open, compiling clean.

The obvious guard:

```ts
const _projectionIsEnough: (a: PlusVariant) => PlusBaseStamp = (a) => a;
```

This asserts nothing about the fields in question. Both stamps are **optional**, and `{ sessionToken, email }` is perfectly assignable to `{ sessionToken, email, issuedBase?, verifiedBase? }`. Delete both fields from the projection and the assertion still compiles.

Assert the keys exist instead:

```ts
type Assert<T extends true> = T;
type _StampFieldsSurvive = Assert<
  ("issuedBase" | "verifiedBase") extends keyof PlusVariant ? true : false
>;
```

Deleting `verifiedBase` from the projection now fails the build. (Parenthesize the union: `"a" | "b" extends K` parses as `"a" | ("b" extends K ...)`.)

**Rule: assignability checks the shape you can pass, not the shape you must keep. To pin an optional field, assert on `keyof`.**

There is a prerequisite the repo already learned once and had to apply again: `tsconfig.test.json` typechecks a named list of files, not all of `test/`. A type-level assertion in an unlisted file is inert. Add the file in the same change that writes the assertion.

## 2. `Object.create(Prototype)` skips class fields, so a dependency held as a field is undefined

The verifier was first written as a class field:

```ts
private readonly verifyPlusBase: ClassifyBaseVerifier = (input) => verifyPlusBase(...);
```

Class fields are installed by the **constructor**, not on the prototype. `test/backfillEntry.test.ts` builds the plugin with `Object.create(AtomsPlugin.prototype)` to skip the real constructor — a common and reasonable test shortcut — so the field was never installed and every test in that file died with `opts.verifyBase is not a function`.

That surfaced loudly here, but the general hazard is quieter: a field holding an *optional* dependency would have been `undefined` rather than throwing, and whatever it guarded would have been skipped in exactly the tests that build objects this way.

**Rule: a dependency that must exist on every instance goes on the prototype (a method), not in a class field — especially in a codebase where tests construct via `Object.create`.**

## 3. A fixture that matches leaves the check it was added for untested

The egress backstop compares `plus.verifiedBase` against `plus.baseUrl`. Adding the new required field to the existing test fixtures meant setting them equal — which is what a real caller does — so every fixture passed the comparison and **no test exercised the mismatch**. Deleting the backstop entirely kept the suite green.

The fix is not subtle once seen: a new check needs a test whose inputs make it *fire*, written in the same change. Making the type-checker happy at existing call sites is migration, not coverage.

Its sibling: the mismatch test has to be a case the *neighbouring* check cannot catch. `https://plus.tryatoms.app` is a perfectly allowed base under the #500 predicate, so pointing a session stamped elsewhere at it isolates #508's question. Reusing #500's `http://evil.example` fixture would have passed for the wrong reason.

## Why neutering is the only thing that found these

All three passed review by reading. Two of them I wrote myself, believing them load-bearing, minutes earlier. Reading a test tells you what it *intends* to assert; only breaking the code tells you what it *does* assert.

Related: [`a-guard-decays-and-a-red-baseline-proves-nothing.md`](../security/a-guard-decays-and-a-red-baseline-proves-nothing.md) — a suite that was already red proves nothing about a new guard either; and [`a-guard-needs-two-inventories-send-sites-and-input-classes.md`](../security/a-guard-needs-two-inventories-send-sites-and-input-classes.md), where two #500 tests passed against a broken guard until someone checked.

## Prevention

- **Neuter every new guard in the unit that adds it.** Break it, watch the specific test fail, restore. Record the count and what went red in the commit message so the claim is falsifiable.
- **Neutering cannot find a guard nobody wrote.** Pair it with an enumeration test that re-derives the inventory from source — for #508, `test/plusSenderInventory.test.ts` counts every Plus base resolution per file and pins the set of calls taking the verified-base config. A twenty-fourth sender fails a test instead of depending on a reviewer noticing.
- **Key such a census by file and count, not `file:line`.** Line numbers move whenever anything above them does, and a census that fails on every unrelated edit is a census people delete.
- **When a type change forces edits to existing fixtures, that is the moment to add the failing case** — the compiler just told you where the new invariant is observed.
