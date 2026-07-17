---
title: "Never ship raw Obsidian buttons without ghost chrome reset"
date: 2026-07-17
category: ui-patterns
module: ui-kit
problem_type: ui_regression
severity: medium
applies_when:
  - "Adding a <button> on Atoms home or any plugin view"
  - "Text-looking actions (bridge, back, row, tab)"
  - "Phone / mobile Obsidian layout QA"
tags:
  - ui-kit
  - buttons
  - mobile
  - css
  - resurface
---

# Never ship raw Obsidian buttons without ghost chrome reset

## Problem

Connected For-you card showed “Same thread · via …” inside a tall bordered empty box. Title/date spacing looked wrong because the bridge ate vertical space as a system button, not a text line.

## Root cause

`atomsHomeView` used bare `createEl("button")` for the connected bridge. Mobile Obsidian (and desktop) apply default button chrome: border, fill, box-shadow, padding, min-height. Partial local CSS (`border: none; background: transparent`) is easy to miss pieces of (`appearance`, `box-shadow`, `border-radius`) and every new call site re-learns the bug.

## Fix

1. **Prefer no `<button>`** for pure text actions — `textControl()` renders a `div[role=button]`. Mobile Obsidian still paints border/fill on real buttons even after CSS reset (seen again on 0.6.15 with ghost class).
2. **Shared reset** — `.atoms-ui-ghost-btn` (full chrome strip, `!important` on border/bg/shadow/appearance).
3. **Factories** — `textControl()` for bridges; `textButton()` only when a real button is required; graded `button()` for CTAs.
4. **Bridge copy** — `connectedBridgeLabel()` is `Same thread · via X` or `Open {seed}` — never repeats the kicker (`Because of …`).

## Prevention

| Do | Don't |
|---|---|
| `textControl(parent, { label, onClick })` for text-looking actions that must never look like system buttons | `createEl("button")` for bridges / inline text |
| `textButton(...)` only when a native button is required | Assume CSS alone kills Obsidian mobile button chrome |
| `button(..., { grade })` for real CTAs | Duplicate kicker text on the bridge line |
| Layout-only classes on top of ghost (`atoms-home-connected-bridge`) | Desktop-only QA — chrome leaks loudest on phone |

## When to apply

Any new interactive control that should **not** look like Obsidian’s default button. Prefer `textControl`. Use graded `button()` only for filled CTAs.

## See also

- `src/ui/factories.ts` — `textControl`, `textButton`, `button`
- `src/resurface/resurface.ts` — `connectedBridgeLabel`, `connectedKicker`
- `styles.css` — `.atoms-ui-ghost-btn`, `.atoms-ui-text-control`, `.atoms-home-connected-bridge`
- Design: `docs/design-handoff/atoms-view/land-then-remember.html` (`.bridge`)
