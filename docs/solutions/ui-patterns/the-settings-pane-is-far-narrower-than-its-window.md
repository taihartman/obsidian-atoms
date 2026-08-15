---
title: "The Obsidian settings pane is far narrower than its window, so a width media query is the wrong tool for a row-layout problem"
date: 2026-08-14
category: ui-patterns
module: settings
problem_type: ui_bug
component: tooling
symptoms:
  - "At 768px one text row ellipsed its name to 54px and grew to 311px tall"
  - "Another text row on the same screen left its URL field only 66px"
  - "Neither Obsidian's phone stacking nor the existing min-width floor fired at that size"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - obsidian
  - settings
  - css
  - responsive
  - tablet
  - flexbox
---

# The settings pane is far narrower than its window

## Problem

Two text rows on the same settings screen failed in opposite directions at tablet width. `Plus
service URL` kept a 300px name column and left its URL field 66px. `Custom shortcut link` did the
reverse: it starved its name to 54px, ellipsed the label, and towered to 311px tall as the
description wrapped inside a 54px gutter. Both were rendered in a window 768px wide.

## Symptoms

- A row's name column ellipsed at a viewport size nowhere near narrow.
- The same screen showed the opposite failure one row away.
- `.is-tablet` was on the body and no row-stacking rule fired.

## What Didn't Work

**Reaching for a `@media (min-width: …)` query.** The window is not the row. At 768px the settings
modal keeps its nav sidebar, so the measured chain is: modal 691px, pane 489px, group 410px, and
the row's actual content line about **366px**. A media query on window width is answering a
different question than the one the layout is asking.

**Assuming the platform class carries a width signal.** `.is-tablet` and `.is-phone` say what kind
of device this is, not how wide the container is. Obsidian's own row stacking gates on `.is-phone`,
which does not fire on a tablet — so at 768px neither the framework's stacking nor the existing
`min-width` floor was active, and the two halves of each row split a 366px line by whichever one
happened to assert a width.

## Solution

Put a floor under **both halves** of the row and let flexbox decide, rather than gating on any
width or platform class (`styles.css:2157-2182`):

```css
body:not(.is-phone) .atoms-setting-text {
  flex-wrap: wrap;
}

body:not(.is-phone) .atoms-setting-text .setting-item-info {
  /* Grows far harder than the field on purpose. */
  flex: 100 1 0;
  min-width: 240px;
}

body:not(.is-phone) .atoms-setting-text .setting-item-control {
  flex: 1 1 auto;
}
```

The row then stays inline wherever both floors fit — desktop, and a wide tablet pane — and stacks
exactly where they do not, with no platform class to get wrong.

Two details are load-bearing:

- **`flex-basis` must be `0`, not `auto`.** Left at `auto` the name column asks for its
  *description's* max-content width, which on a 596px desktop pane is wider than the line, so the
  field wrapped under it on desktop too — stacking rows that had every reason to stay inline.
- **The name column's grow factor is deliberately lopsided (`100`).** While the row is inline the
  surplus belongs to the name, exactly as it did before the rule existed. Letting the field take it
  instead shrank `Atom folder`'s desktop name from 371px to 240px and added 16px of height — a
  tablet fix charging desktop for it.

The rule is scoped off `is-phone`, where Obsidian already turns the row into a column and a
`flex-basis` would be read as a *height*.

## Why This Works

The failure is a container-width problem, and flex floors are a container-relative tool: they
resolve against whatever line the row actually gets, at any nesting depth, without anyone having to
know that a sidebar is stealing 279px. A media query would have to encode that measurement, and
would be wrong again the moment the sidebar collapses or Obsidian changes the modal's proportions.

## Prevention

**Never reach for `@media (width)` — or a platform class — to solve a row-layout problem inside a
pane whose width the plugin does not control.** The plugin owns the row; Obsidian owns the pane, the
sidebar, and the modal. Prefer intrinsic sizing (flex floors, `flex-wrap`, or container queries where
available), which answers against the real line.

**Measure the content line, not the viewport, before writing any width rule.** At `is-tablet` the
chain was 768 -> 691 -> 489 -> 410 -> ~366. Assuming a 768px viewport means a 768px row was the
whole bug.

**Verify at three widths, not two.** These two rows failed in opposite directions, so a fix
validated at only one of them looks correct while making the other worse. This rule was checked at
390px, 768px, and desktop; the `flex: 100 1 0` choice exists only because desktop was re-measured
after the tablet fix.
