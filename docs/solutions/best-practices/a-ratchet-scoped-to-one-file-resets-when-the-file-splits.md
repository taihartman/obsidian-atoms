---
title: "A ratchet scoped to one file resets itself when that file splits"
date: 2026-08-14
category: best-practices
module: settings
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - "Writing a budget or ratchet test that counts occurrences in a named file"
  - "Splitting a large module that a count-based guard points at"
  - "A guard's scope is a path rather than a property"
tags:
  - guards
  - ratchet
  - test-design
  - refactoring
  - settings
---

# A ratchet scoped to one file resets when the file splits

## Context

A ratchet test held the settings tab to a budget of direct `new Setting(` constructions, pushing
rows through the shared row grammar in `src/settings/rows.ts` instead. It worked: the count came
down from 27 to 18 to 12 to 6 to 5 across successive units, and the budget was lowered each time.

It read exactly one file:

```ts
const source = readFileSync(path.resolve(__dirname, "../src/settings/settings.ts"), "utf8");
const direct = withoutComments(source).match(/new Setting\(/g)?.length ?? 0;
expect(direct).toBeLessThanOrEqual(DIRECT_SETTING_BUDGET);
```

That is a guard whose scope is a path, and the path encodes an unstated assumption: *the settings
tab will always be one file*. Splitting a screen out of `settings.ts` — which the same project has
an open decision about — would move that screen's construction sites into a module nobody counts.
The remaining count drops, the ratchet reports a budget it never earned, and it can then be lowered
to lock in a number that is fiction.

Nothing would have failed. That is the whole problem.

## Guidance

**When a guard's scope is a path, make the scope itself an assertion.**

The naive fix — glob the whole directory — is wrong here, because several modules under
`src/settings/` legitimately construct `Setting`: the row grammar itself, and modals that build
their own button bars. Summing everything makes the budget meaningless in the other direction.

So name both sides, and assert the partition is total (`test/settingsRows.test.ts`):

```ts
const SCREEN_MODULES = ["settings.ts"];

/** Not screens: the row grammar itself, and modals that build their own button bars. */
const NON_SCREEN_MODULES = [
  "rows.ts", "captureSheet.ts", "captureShortcut.ts", "consent.ts",
  "destructiveButton.ts", "hubListPreviewModal.ts",
  "plusSignInConfirmModal.ts", "plusSignOutAllConfirmModal.ts",
];

it("every module in src/settings is on exactly one side of the budget", () => {
  const present = readdirSync(path.resolve(__dirname, "../src/settings"))
    .filter((f) => f.endsWith(".ts"))
    .sort();
  expect(present).toEqual([...SCREEN_MODULES, ...NON_SCREEN_MODULES].sort());
});
```

The budget now sums `SCREEN_MODULES`, and a new file under `src/settings/` fails the partition test
until somebody decides which side it is on. Splitting a screen out is still allowed — it just has to
say so, and its sites keep counting.

## Why This Matters

A ratchet's authority comes from the claim "this number cannot go up without someone noticing." A
path-scoped ratchet silently weakens that claim to "this number cannot go up *in this file*," and
the difference is invisible precisely when it matters — during the refactor the ratchet exists to
survive.

The general rule: **a guard that measures a property should not be scoped by an artifact that can
move.** If it must be (and often it must, since files are what you can read), then add a second
assertion that the artifact boundary is still where the guard thinks it is. The partition test is
cheap, and it converts a silent reset into a loud question.

This is the same failure family as
[an-exemption-needs-a-test-that-it-is-still-needed](an-exemption-needs-a-test-that-it-is-still-needed.md):
a guard whose assumptions are recorded in prose rather than in an assertion. There, the assumption
was "these strings cannot be reworded." Here it is "this is the only file that counts."

## When to Apply

- Any budget, ratchet, or occurrence-count test that names a file path.
- Any guard whose correctness depends on a directory containing exactly the files the author saw.
- Coverage floors, file-size limits, and import-boundary checks scoped to a module that is a
  candidate for splitting.

The tell: if you can satisfy the guard by *moving code* rather than by *changing it*, the guard is
scoped wrong.

## Examples

**Comments are stripped before counting, for a related reason.** They were not originally, and prose
above an exempt site that mentioned `new Setting(` spent a budget slot — the guard read 7 against 6
real constructions, so deleting that comment bought a free seventh construction with the guard still
green. A counting guard has to count the thing, not the text that talks about it.

**The partition message should name the decision, not the mechanic.** The assertion's failure
message says which list to add the file to and why leaving it off both is the actual bug — because
the person who trips this test is mid-refactor and needs to know what question they are being asked,
not that an array comparison failed.
