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

1. **Shared reset** — `.atoms-ui-ghost-btn` in `styles.css` (full chrome strip).
2. **Factory** — `textButton()` in `src/ui/factories.ts` always applies that class + `stopPropagation`.
3. **Call sites** — connected bridge via `textButton`; landed rows, citator (when button), back, filter tabs carry `atoms-ui-ghost-btn`.
4. **Graded actions** still use `button()` → `.atoms-ui-btn` (also hardened with `appearance` / `box-shadow: none`).

## Prevention

| Do | Don't |
|---|---|
| `textButton(parent, { label, onClick, className })` for ghost/text actions | `createEl("button", …)` without `atoms-ui-ghost-btn` or `atoms-ui-btn` |
| `button(..., { grade: "primary" \| "secondary" \| "quiet" })` for real CTAs | One-off border/background resets on each feature class |
| Layout-only classes on top of ghost (`atoms-home-connected-bridge`) | Assume desktop-only QA — chrome leaks loudest on phone |

## When to apply

Any new interactive control that should **not** look like Obsidian’s default button. If it looks like text or a row, use ghost. If it is a filled CTA, use graded `button()`.

## See also

- `src/ui/factories.ts` — `textButton`, `button`, `backLink`, `citatorLine`
- `styles.css` — `.atoms-ui-ghost-btn`, `.atoms-home-connected-bridge`
- Design: `docs/design-handoff/atoms-view/land-then-remember.html` (`.bridge`)
