---
title: "A bulk action inherits none of the per-item action's bounds"
date: 2026-08-06
category: architecture-patterns
module: settings
problem_type: design_error
component: settings-tag-vocabulary
severity: high
status: solved
tags:
  - settings
  - row-grammar
  - destructive-action
  - bulk-action
  - snapshot-vs-live
  - confirm-sheet
  - proposed-tags
  - cross-model-review
applies_when: "Replacing N per-item actions with one bulk action — 'Dismiss all', 'Clear', 'Remove selected', 'Archive everything' — especially when the per-item version was a small, obviously safe button."
resolution_type: code_fix
---

# A bulk action inherits none of the per-item action's bounds

## Context

[#342](https://github.com/taihartman/obsidian-atoms/issues/342): in Settings → Atoms → Tag vocabulary,
every classifier-proposed tag rendered **two** full-width rows — `#tag` with an Approve button, and a
second row whose entire name was the literal string `Dismiss #tag`, carrying a Dismiss button. Three
proposals meant six cards. The fix was obvious and small: delete the per-tag row, add one
section-level destructive row for the whole queue.

The diff read as a *deletion*. One `destructiveRow` call removed, one added, net negative. Nothing in
it looked like new risk, and two local reviewers plus two simplification passes said so.

It was not a deletion. It was a quiet promotion of a bounded action to an unbounded one.

## Guidance

**When you collapse N per-item actions into one bulk action, enumerate the bounds the per-item
version enforced for free — and re-establish each one deliberately.** They are invisible in the diff
because they were never written down; they were properties of the shape.

Two of them mattered here.

**1. Scope was implicit, and the collapse widened it silently.** The per-tag handler filtered:

```ts
// before — bounded by construction: it can only ever remove `tag`
this.plugin.settings.proposedTags = this.plugin.settings.proposedTags.filter(
  (t) => normalizeTag(t) !== normalizeTag(tag),
);
```

The bulk version did the natural thing:

```ts
// after (wrong) — reads nothing, destroys everything present at click time
this.plugin.settings.proposedTags = [];
```

A `Process` or auto-run merges into `settings.proposedTags` from eight call sites in
`src/plugin/main.ts` **without redisplaying an open settings tab**. So the row could be labelled
`2 proposals waiting` — a name computed at render — while `[]` destroyed four, two of which the user
had never seen. The label and the effect disagreed, and nothing surfaced the disagreement.

The fix is to destroy the snapshot you rendered, not the live collection:

```ts
const rendered = new Set(proposed.map(normalizeTag));
// …
onConfirm: async () => {
  this.plugin.settings.proposedTags = this.plugin.settings.proposedTags.filter(
    (t) => !rendered.has(normalizeTag(t)),
  );
  await this.plugin.saveSettings();
  this.redisplay();
},
```

Rule of thumb: **if a row's name states a count, its handler must be bounded by the same set that
produced that count.** A count-bearing label is a promise.

**2. Reversibility was implicit too.** One tap dismissing one suggestion is cheap. One tap dismissing
twelve is not — and the recovery story turned out to be weaker than the first draft's copy claimed.
The row initially read *"A later classify run can propose the same tags again."* That is false for the
batch that produced them: a processed capture carries a sentinel and is **never classified twice**, so
a dismissed tag returns only from a capture not yet written. Per-tag dismissal made that acceptable by
being small. Bulk dismissal does not, so it now routes through a confirm sheet that names the count,
and the misleading `desc` is gone.

Rule of thumb: **"is this reversible?" is a question about the whole action, not one item.** An
irreversibility you were willing to absorb ×1 is a different decision ×12.

## Why This Matters

**The widening is invisible to a diff-shaped review.** Both defects live in code the diff *deleted*
— in the bounds the old shape carried implicitly. A reviewer reading added lines sees
`proposedTags = []`, which is correct-looking, small, and obviously does what it says. Neither local
reviewer flagged either one, and neither did two `ce-simplify-code` passes; both came from the
**cross-model adversarial peer**, which was briefed to attack the destructive scope specifically.
(See [give-the-cross-model-peer-a-brief-not-a-diff](../workflow-issues/give-the-cross-model-peer-a-brief-not-a-diff.md)
— the brief that found these named "destructive scope" and "the row's name is derived state" as two
of its four divisions. The peer also returned a third finding, a read-modify-write race between
Approve and Dismiss, which was **wrong**: both handlers read and write synchronously before their
first `await`, so they cannot interleave. Two out of three is a good peer; adjudicate anyway.)

**A safety property that exists only as a side effect of a shape will not survive a change to that
shape.** Nobody deleted the scoping — nobody had ever written it.

## When to Apply

Whenever a change replaces per-item controls with one aggregate control. Before merging, answer:

1. **Scope** — does the handler act on the set that was rendered, or on whatever is live at click
   time? If they can differ, they will.
2. **Label truth** — if the control states a count or a scope, is the handler bounded by it?
3. **Reversibility ×N** — is the recovery path real, and is it still acceptable at N rather than 1?
   Verify the recovery claim against source rather than assuming it; the copy here was wrong until
   someone traced the sentinel.
4. **Confirmation** — the repo's precedent is `confirmWipeCloudCopy` (irreversible → asks) versus
   `Sign out` (recoverable → does not). Place the new bulk action against that line, not against the
   per-item control it replaced.

Also applies in reverse: a control that *is* correctly bounded should say so in a comment, because the
next person to widen it has no other way to learn the bound existed.

## Examples

The one that mattered, end to end:

| | Per-tag Dismiss (before) | `Dismiss all` (first draft) | `Dismiss all` (shipped) |
|---|---|---|---|
| Scope | `filter` on one tag | `= []`, whatever is live | `filter` against the rendered set |
| Label vs effect | trivially agree | can disagree silently | agree by construction |
| Confirm | none, and fine at ×1 | none, not fine at ×12 | confirm sheet naming the count |
| Copy | n/a | "a later run can propose them again" (false for that batch) | no desc; the sheet states permanence at the tap |

**The bound has a twin: the *count*.** Adversarial QA on the shipped version found the same class of
error one level down. The row's name counted `settings.proposedTags.length` — the raw stored array —
while the confirm counted `rendered.size`, the normalized set it actually dismisses. Those are the
same number for every array the plugin itself writes, because `mergeProposedTags` dedupes and
lowercases. They are *not* the same number for an array that reached `data.json` another way, and
`loadSettings` assigns `data.json` straight through:

```text
proposedTags = ["design", "Design", "  #PACKING  ", "packing"]
  row   : "4 proposals waiting"
  sheet : "Dismiss 2 proposals?"     ← then cleared all four
```

A bulk action states its reach in a number, so **that number is part of the bound, not decoration**.
Derive it from the same set the handler acts on — here by normalizing at the render boundary rather
than trusting the stored array — so the two cannot drift. The tell is generic: if a label's count and
a handler's scope are computed from the same data by *different* expressions, they are one malformed
input away from disagreeing, and the disagreement always favours destroying more than the label
promised.

Note where it was caught. The unit tests all passed, because they seeded the array the way the merge
path writes it. It took the break-it half of QA, deliberately feeding a `data.json` the plugin would
never produce, to separate "the two expressions agree" from "the two expressions are the same bound."

**Secondary learning — the ratchet did the design work.** Writing the confirm inline would have been
a second hand-rolled modal in `src/settings/settings.ts`, and the row-grammar repository guard in
`test/settingsRows.test.ts` failed it: `settings.ts constructs Setting directly 6 times (budget 5)`.
That is the ratchet working as intended. The fix was not to raise the budget but to extract
`confirmSheet()` into `src/settings/rows.ts`, where the confirm sits next to the `destructiveRow` it
belongs to — a confirm sheet is the destructive row's other half. A budget that only ever moves down
converts "I'll just paste it" into "extract the primitive" without anyone having to argue for it.

## See also

- `CONCEPTS.md` → **Row grammar (settings)** — the rule this change works within; the per-tag Dismiss
  row existed because no primitive carries two kinds, which is correct, and was applied mechanically
  to an inbox item, which was not.
- [give-the-cross-model-peer-a-brief-not-a-diff](../workflow-issues/give-the-cross-model-peer-a-brief-not-a-diff.md)
  — how the brief that caught this was written.
- [read-modify-write-lost-update-synced-file](../logic-errors/read-modify-write-lost-update-synced-file.md)
  — the adjacent failure this is *not*: that one is an `await` gap between read and write, this one is
  a render-to-click gap between a label and its handler.
