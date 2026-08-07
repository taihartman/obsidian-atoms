---
title: "A rule that keeps producing an ugly shape is missing a kind"
date: 2026-08-06
category: architecture-patterns
module: settings
problem_type: design_error
component: settings-row-grammar
severity: medium
status: solved
tags:
  - settings
  - row-grammar
  - shared-primitive
  - god-widget
  - draft-state
  - obsidian-css
  - specificity
applies_when: "A design rule keeps forcing an awkward shape at one kind of call site — and the choices on the table look like 'weaken the rule' or 'keep paying it'."
resolution_type: code_fix
---

# A rule that keeps producing an ugly shape is missing a kind

## Context

The settings row grammar ([#304](https://github.com/taihartman/obsidian-atoms/issues/304)) says a row
carries one grammar and one right edge. Applied mechanically, every "type a value, then commit it"
interaction became **two** rows: a field row, then a second row whose entire content was its own
button label. Account did it three times — `Email` / `Start free trial`, `Sign in with a link` /
`Send sign-in link`, `Advanced: paste session` / `Save session` — and Tag vocabulary once. Each pair
cost an extra 111px card that said nothing the button did not already say.

[#342](https://github.com/taihartman/obsidian-atoms/issues/342) had already deleted the identical
shape for per-tag Dismiss, so this was the second sighting. The code even admitted it, in a comment
nobody had acted on: *"Field and button were one row, which the grammar allows only one right edge
for. Splitting them keeps both rather than dropping the field or committing on every keystroke."*

Plan: [`docs/plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md`](../../plans/2026-08-06-004-fix-settings-form-rows-and-back-chevron-plan.md)
— [#347](https://github.com/taihartman/obsidian-atoms/issues/347) (form rows) and
[#348](https://github.com/taihartman/obsidian-atoms/issues/348) (back chevron).

## Guidance

**When a rule keeps producing an ugly shape at one kind of call site, the rule is usually missing a
kind — not too strict, and not something to keep paying.** A comment apologizing for the shape is the
tell: the author already knew the output was wrong and concluded the rule left no move.

A field and the single button that commits it is **one** grammar — "type this, then commit it" — the
way a destination row's name and chevron are one. So `formRow` became the sixth kind in
`src/settings/rows.ts`, **composed** out of parts that already existed: the text-control config from
`settingRow`, and the in-flight guard from `actionRow` (extracted as `addGuardedButton`, so the
double-tap behaviour has one implementation reached two ways rather than a fork).

The rejected alternative was an optional `button` on the shared `settingRow`. That is the god-widget
move: one PR later there is a button on a toggle row, and "one row, one right edge" means nothing.
A new kind stays enumerable and stays testable — `test/settingsRows.test.ts` asserts over *the other
five* kinds that none pairs an input with a button, so the exception is one named kind rather than a
flag anyone may set.

## Why This Matters

Adding a kind and adding a flag both make the ugly shape go away. They differ in what happens next:
a kind keeps the grammar a closed set you can assert over, a flag opens it. The repo already has the
enforcement to prove it — the row-grammar guard in `test/settingsRows.test.ts` and the direct-`Setting`
budget it ratchets. Neither can say anything useful about an optional `button` that any caller may
pass.

## When to Apply

You are about to write a comment explaining why a rule made you build something awkward, or you are
about to add an optional field to a shared component so one call site can escape. Ask whether the
awkward call site is a *kind* the vocabulary does not have yet.

## The four traps a doc-review caught

These are the concrete failure modes of "replace a helper with a shared primitive", and none is
obvious from the diff.

**1. A deleted helper's `.trim()` is part of its contract.** The `accountInput` helper it replaced
ended in `.value.trim()`, and `savePastedSession` validates `startsWith("sess_")` — which only
survives on a trimmed string. Replacing a DOM-reading helper with a value-passing callback silently
drops the trim unless the new contract states it. `formRow` now trims at the primitive and documents
that it does, so a token pasted with a leading space still validates at all four call sites.

**2. "Passing the value in" does not subsume draft state.** `customTagDraft` looked like plumbing
that falls out once `onSubmit` receives the typed value. It does not. Toggling any other tag calls
`redisplay()`, and the draft field is what puts a half-typed tag back afterwards — a rebuild is
exactly the case a submit callback knows nothing about. Regression test:
`keeps a half-typed tag when deactivating another tag rebuilds the screen`.

**3. A CSS decision needs a class hook, and the plan had none.** The phone rule (let the control wrap
so the field owns a full line) was specified before anything gave the new row a `settingEl` class to
target. `formRow` adds `atoms-setting-form` itself, for the same reason the other kinds own their
classes: the rule and the hook ship together or the rule targets nothing.

**4. Not every adjacent pair is a pair.** `Add a custom tag` / `Add to Active` looked like the same
duplicate-label shape as the three account pairs, where the button label merely restated the row
name and could be shortened on merge. It is not: the row name and the button label were already
*different* strings, and shortening the button to "Add" would have dropped which list the tag joins.
Merging the rows was right; shortening the label was not.

## The other half: diagnosing borrowed chrome

The back row's chevron floated mid-row — 104px in on phone, 236px in on desktop. It was tempting to
blame the plugin's own `.atoms-setting-back` or the recent phone-stacking fix
([#346](https://github.com/taihartman/obsidian-atoms/issues/346)). Neither was it. Obsidian's
`.setting-item-control` is `flex: 1 1 auto` with `justify-content: flex-end`, so in a `row-reverse`
row it grows to fill the leftover space and parks its 28px chevron at the far end of the box it grew
into. Because that is upstream and axis-independent, the bug was **pre-existing and cross-platform**,
which is what decided where the fix goes: the base rule, not the `.is-phone` block.

The transferable part is how the specificity question was settled. Rather than guessing whether a
plugin override would win, the real `app.css` was unpacked out of `obsidian.asar` and read: nothing
upstream declares `flex` on that selector except the base rule, so a (0,3,0) override is uncontested
and needs no `!important` and no arms race. **When a layout bug traces to borrowed chrome, read the
borrowed stylesheet.** It is one `npx asar extract` away, and it converts a specificity guess into a
fact — including the fact that the phone block's tie with Obsidian's (0,4,0) row rule is won on
source order, not by luck.

## See also

- `CONCEPTS.md` → **Row grammar (settings)** — now six kinds; `formRow` is the one added here.
- [a-bulk-action-inherits-none-of-the-per-item-actions-bounds](a-bulk-action-inherits-none-of-the-per-item-actions-bounds.md)
  — [#342](https://github.com/taihartman/obsidian-atoms/issues/342), the first sighting of the same
  two-rows-per-thing shape, removed there by giving a queue one section-level control instead.
- [obsidian-button-chrome-reset](../ui-patterns/obsidian-button-chrome-reset.md) — the other case of
  Obsidian's own stylesheet deciding what a plugin row looks like.
- Code: `src/settings/rows.ts` (`formRow`, `addGuardedButton`), `styles.css`
  (`.atoms-setting-back .setting-item-control`, `.atoms-setting-form`),
  `test/settingsRows.test.ts` (the five-kind exclusion assertion).
