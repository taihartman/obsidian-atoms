---
title: "Obsidian's per-row card chrome fights a grouped-list primitive, and a computed-style assertion cannot see it"
date: 2026-08-14
category: ui-patterns
module: settings
problem_type: ui_bug
component: tooling
symptoms:
  - "A settings group rendered as a string of detached pills instead of one inset block"
  - "The hairline between rows was in the DOM and computed correctly, but invisible on device"
  - "Seven implementation units shipped against the wrong picture with the automated check green"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - obsidian
  - settings
  - css
  - mobile
  - visual-qa
  - grouped-list
---

# Obsidian's per-row card chrome fights a grouped-list primitive

## Problem

`group()` composes settings rows into one rounded block, the iOS grouped-list shape the design mock
asks for. On mobile it rendered as six separate floating pills, and the hairline that was supposed
to sit between neighbouring rows could not be seen anywhere — while a `getComputedStyle` assertion
confirmed, correctly, that the hairline was there.

## Symptoms

- Rows detached into individual cards rather than forming a single inset block.
- The between-row separator was present in the DOM with the expected computed color, and invisible
  in a screenshot.
- The automated check passed for seven consecutive implementation units.

## What Didn't Work

**Styling the container alone.** Giving `.atoms-setting-group` a fill and a radius produces a
correct block that nothing sits inside correctly, because Obsidian has already styled each child.
The container is not the only thing painting.

**Trusting the CSS assertion.** The test asked "does the separator rule apply to this element" and
got a true answer. That question cannot detect that the element it applies to has been turned into
a detached, rounded, opaque card by a rule from somewhere else — the separator was being painted
across the curved top edge of a floating pill, where nothing could see it. The assertion was true
and the screen was wrong, and no amount of the same kind of assertion would have closed the gap.

## Solution

On mobile Obsidian styles every `.setting-item` as its own card: an opaque `--background-primary`
fill, a 30px radius, and an 8px bottom margin. Measured at `is-tablet`, rows came out
`rgb(255,255,255)` against a group fill of `rgb(246,246,246)`.

The fix moves the fill Obsidian already painted **behind each row** onto the one block those rows
belong to, and flattens the rows inside it (`styles.css:1983-2008`):

```css
.atoms-setting-group {
  background: var(--background-primary);
  border-radius: 14px;
  overflow: hidden;
}

/* The block owns the fill, the corners and the separators; its rows are flush rows inside it. */
.atoms-setting-group .setting-item {
  border-top: none;
  background: transparent;
  border-radius: 0;
  margin-bottom: 0;
}

.atoms-setting-group .setting-item + .setting-item {
  border-top: 1px solid var(--background-modifier-border);
}
```

The separator goes on the adjacent sibling selector rather than on every row, so there is one
hairline *between* rows and none at the block's edges — the radius is the boundary there.

## Why This Works

A grouped list is one surface with divisions, not a stack of surfaces. Obsidian's default grammar
is the second one, so composing rows into a block means actively un-styling the child chrome, not
just adding a parent. Three of the four overridden properties (`background`, `border-radius`,
`margin-bottom`) exist only to undo something Obsidian set; without all of them the rows keep
enough card identity to read as separate objects.

The related failure at `styles.css:2015-2018` has the same shape: Obsidian sets row padding in the
modal *and* again under `.is-phone`, so a single selector loses to both and the rule has to be
written twice.

## Prevention

**A CSS assertion is not a fidelity verdict.** A computed-style check answers "is my rule applied."
It cannot answer "does the screen look right," because the thing that breaks the picture is usually
a *different* rule applied to a *different* element. When the claim is visual, the evidence has to
be visual — somebody has to look at the picture. See
[a-property-test-is-only-as-strong-as-its-observers](../logic-errors/a-property-test-is-only-as-strong-as-its-observers.md)
for the same failure in a different medium.

**When composing rows into a shared container in an Obsidian plugin, assume the child is already
styled.** Before writing the container's rule, inspect a real row on device at `is-phone` and
`is-tablet` and list what the framework already paints — fill, radius, margins, borders. Those are
the properties the container's rule has to neutralize.

**Keep the measurement in the comment.** The rule at `styles.css:1989-1998` carries the observed
values it was derived from, so the next reader can tell a deliberate override from a cargo-culted
one, and can re-measure if Obsidian's defaults move.
