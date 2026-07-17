---
title: "Obsidian mobile paints system chrome on <button> — use textControl for text actions"
date: 2026-07-17
last_updated: 2026-07-17
category: ui-patterns
module: ui-kit
problem_type: ui_bug
component: tooling
symptoms:
  - "Connected For-you bridge rendered as a tall bordered empty box on phone"
  - "Bridge text sat at top of box with dead space below (looked like nested card)"
  - "Kicker and bridge both said Because of {seed} (duplicate copy)"
root_cause: wrong_api
resolution_type: code_fix
severity: medium
tags:
  - ui-kit
  - buttons
  - mobile
  - css
  - resurface
  - textControl
---

# Obsidian mobile paints system chrome on `<button>` — use textControl for text actions

## Problem

Connected For-you card bridge (“Same thread · via …” / “Because of …”) looked like a half-empty system button nested inside the memory card. Spacing under the snippet looked broken; title/date foot sat below a fake chip. On seed-only edges, bridge copy also duplicated the kicker.

## Symptoms

- Light bordered rounded rect around the bridge line, empty space under the text
- Phone only (desktop can hide the leak)
- After 0.6.15 ghost CSS still wrong on device — CSS reset was not enough
- Bridge label matched kicker: `Because of Andrew loves High School Musical` twice

## What Didn't Work

1. **Partial CSS on the feature class** (`border: none; background: transparent` on `.atoms-home-connected-bridge` only) — missed `appearance`, `box-shadow`, `border-radius`; easy to re-break per call site.
2. **Shared `.atoms-ui-ghost-btn` + real `<button>` via `textButton()` (0.6.15)** — shipped and installed to Remote Vault; phone still showed the empty bordered box. Mobile Obsidian continues to paint button chrome that plugin CSS cannot fully kill.
3. **Assuming desktop QA** — chrome leak is loudest on iOS Obsidian.

## Solution

### 1. Prefer not a `<button>` for pure text actions

`textControl()` in `src/ui/factories.ts` builds a `div` with `role="button"`, `tabindex="0"`, click + Enter/Space, `stopPropagation`, and classes `atoms-ui-ghost-btn atoms-ui-text-control`.

Connected bridge call site (`src/home/atomsHomeView.ts`):

```ts
textControl(el, {
  label: bridgeLabel,
  className: "atoms-home-connected-bridge",
  onClick: () => { /* open seed / via */ },
});
```

### 2. Ghost reset still required for remaining real buttons

`.atoms-ui-ghost-btn` strips chrome (`border` / `background` / `box-shadow` / `appearance` with `!important`). Use on landed rows, citator-as-button, filter tabs, `textButton()` when a native button is required. Graded CTAs stay on `button()` → `.atoms-ui-btn`.

### 3. Bridge copy must not repeat the kicker

`connectedBridgeLabel()` / `connectedKicker()` in `src/resurface/resurface.ts`:

| Edge | Kicker | Bridge |
|---|---|---|
| seed | `Because of {seed}` | `Open {seed}` |
| person via | `Also about {via}` | `Same thread · via {via}` |

Unit coverage: `test/resurface.test.ts` → `connected bridge / kicker copy`.

### 4. Version bump on user-visible UI

CLAUDE.md: bump `manifest.json` + `package.json` + `versions.json` so Settings → Atoms and phone install identify the build (this fix landed as **0.6.16** after a missed 0.6.15-only CSS attempt).

## Why This Works

Obsidian’s app stylesheet targets real `button` elements. Class-level resets fight specificity and mobile theme rules; a `div[role=button]` never enters that stylesheet. Separating kicker (why this card) from bridge (where the link opens) matches `docs/design-handoff/atoms-view/land-then-remember.html` and removes the “spacing” illusion caused by a tall empty button chrome box.

## Prevention

| Do | Don't |
|---|---|
| `textControl()` for text-looking actions that must never look like system buttons | `createEl("button")` for bridges / inline text |
| `textButton()` only when a native button is required | Assume CSS alone kills Obsidian mobile button chrome |
| `button({ grade })` for real filled CTAs | Duplicate kicker text on the bridge line |
| Phone QA after UI CSS/DOM changes + version bump | Ship user-visible UI without version bump |
| Unit-test kicker vs bridge copy pairs | Rely on visual QA alone for copy contracts |

## Related Issues

- PR #75 — first ghost kit (`textButton` + `.atoms-ui-ghost-btn`)
- PR #78 / 0.6.16 — `textControl` + `connectedBridgeLabel` (actual fix)
- Design: `docs/design-handoff/atoms-view/land-then-remember.html` (`.bridge`)
- Code: `src/ui/factories.ts` (`textControl`, `textButton`), `src/resurface/resurface.ts` (`connectedBridgeLabel`, `connectedKicker`), `styles.css` (`.atoms-ui-ghost-btn`, `.atoms-home-connected-bridge`)
