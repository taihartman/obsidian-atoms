---
title: Emptying the scroller dumps the reader at the top
date: 2026-08-30
category: ui-bugs
module: atoms-home
problem_type: ui_bug
component: tooling
symptoms:
  - "Scrolling the Atoms home library while notes filed yanked the list back to the top, once per capture"
  - "The wait card said you can keep browsing while automatic filing ran, and then the rebuild made that false"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - atoms-home
  - scroll
  - auto-run
  - vault-events
---

# Emptying the scroller dumps the reader at the top

## Problem

Atoms home in the left sidebar rebuilt from the top on every capture that filed. A reader who had scrolled the library was thrown back to the hero, repeatedly, while Process or automatic filing ran.

## Symptoms

- `.atoms-home-scroll` started at `0` after each paint during a filing pass.
- Manual Process jumped once at `beginRun` (full `render()`).
- Automatic filing jumped once per capture: classify is slower than the 400ms vault debounce, so each atom write scheduled a full `refresh()`.

## What Didn't Work

- Gating vault refresh on `AtomsHomeView.busy` only. Manual Process sets `busy` via `beginHomeRun`. Auto-run is required not to call `beginHomeRun` (`docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md`), so `busy` stayed false and every `vault.create` / `vault.modify` rebuilt the library.
- Checking `busy` only when arming the 400ms timer. A write queued just before Process still fired `refresh()` after `busy` became true. Removing that re-check makes `drops a vault refresh that was armed before Process took the view` fail (expected 0, got 1).

## Solution

Remember `.atoms-home-scroll.scrollTop` per screen before `root.empty()`, restore after the new scroller exists. Keys are `main` and one id per in-home detail (`open:atom:…`, `open:entity:…`, `open:pair:…`) so a second detail does not inherit the first's place. A first visit starts at 0. Back to the library restores. Same rule Settings learned in #533.

A same-turn `scrollTop` assignment can clamp to 0 until Obsidian finishes laying the flex pane out. Re-apply on rAF and `setTimeout(0)`, closing over **this** paint's node — querying later lands on the next screen.

Skip vault-driven refresh while `busy` **or** auto-run is in flight, and re-check that in the timer. Process still patches the progress card in place. Auto-run stays silent. The finishing `refresh()` / `finishHomeRun` reloads counts once.

Helpers live in `src/home/homeScroll.ts`. Tests in `test/atomsHomeView.test.ts` drive the real `render()` through `renderedHomeView`.

## Why This Works

The jump is not a CSS overflow bug. `render()` destroys the scroller. Position has to be stored off the node that is about to die, keyed by the screen being left, then applied to the new node for the screen being shown.

`busy` is the attended-run flag. Auto-run has its own `inFlight` on the auto-run snapshot. Either one means a filing pass already owns the next paint.

## Prevention

- A view that `empty()`s its scroller must restore scroll on the same screen. Navigation to a new screen starts at the top.
- A debounce that skips on a flag must re-check the flag when it fires.
- Mutation-check the timer re-check: delete it and the "armed before Process" test must fail.

## Related Issues

- [#611](https://github.com/taihartman/obsidian-atoms/issues/611) / PR #612 (pending as of this writing)
- [#533](https://github.com/taihartman/obsidian-atoms/issues/533) — Settings `openRoute` used the same one-rule-for-both-directions mistake
- [Home-native progress](../architecture-patterns/home-native-progress-long-api-runs.md) — in-place ticks for Process; auto-run stays off the progress strip
