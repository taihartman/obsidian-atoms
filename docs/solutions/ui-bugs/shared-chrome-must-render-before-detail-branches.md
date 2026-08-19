---
title: Shared chrome must render before detail branches
date: 2026-08-19
category: ui-bugs
module: atoms-home
problem_type: ui_bug
component: tooling
symptoms:
  - "Opening an in-home detail removed the Atoms title and header controls."
  - "Collapsing and reopening the sidebar preserved the headerless detail."
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - atoms-home
  - sidebar
  - rendering
  - shared-chrome
  - test-fidelity
---

# Shared chrome must render before detail branches

## Problem

Atoms home has shared chrome above state-specific content. The detail branch in `src/home/atomsHomeView.ts` emptied the root, rendered only `.atoms-home-scroll`, and returned before the shared header was constructed. Every atom, sibling-list, and mind-change detail therefore removed the title, subtitle, and top controls from the DOM.

The view keeps `homeOpen` across `refresh()`. Reopening a sidebar leaf that was already on a detail redrew the same headerless state, so the defect looked like a sidebar lifecycle or CSS problem even though the header did not exist to style.

## Symptoms

- Main home showed Atoms, its subtitle, More, Open today's note, and Settings.
- Entering an in-home detail removed all of those controls.
- Back restored them because it cleared `homeOpen` and selected the main render branch.
- Sidebar collapse and reopen did not restore them while the detail remained active.

## What Didn't Work

- Treating the symptom as clipping or overflow could not address it. `.atoms-home-header` was absent from the detail DOM.
- Clearing `homeOpen` on refresh would have made the header return by discarding the reader's navigation state.
- Counting one header and one scroller in a regression test was not enough. The same counts pass if the header is nested inside the scrolling region and scrolls away.

## Solution

Build the shared shell before selecting state-specific content:

1. Empty the root.
2. Construct `.atoms-home-header` once.
3. Construct one `.atoms-home-scroll` as the header's sibling.
4. Render `homeOpen` into that scroller and return, or continue with main-home content.

This keeps detail state and Back behavior unchanged. The branch chooses content; it no longer owns shared chrome.

The focused regression in `test/atomsHomeView.test.ts` drives the real render and refresh methods for main home and all three detail kinds. Its shared-shell assertion verifies:

- exactly one header and one scroller;
- title, subtitle, and all three controls;
- header and scroller are ordered direct children of the root;
- the scroller does not contain the header;
- repeated refreshes do not duplicate chrome;
- nested sibling Back still returns to its originating atom.

## Why This Works

Persistent chrome and variable content have different lifetimes. Rendering the header before the detail/main branch makes that ownership explicit: all states receive the shell, while only the content changes.

The direct-child assertions test the layout invariant rather than only element presence. A future refactor that moves the header into `.atoms-home-scroll` now fails even though every element still exists.

## Prevention

- Put chrome shared by every view state above early-return branches.
- Let state branches select content, not rebuild or omit the shell around it.
- For fixed-header layouts, assert DOM ownership and sibling order in addition to text and element counts.
- Exercise rerender or refresh transitions from an already-active state; separately constructed snapshots can miss the broken transition.
- Keep live Obsidian verification for sidebar lifecycle and narrow-pane layout. A DOM harness proves render ownership, not actual WebView geometry or sidebar behavior.

## Related Issues

- Issue #579
- Plan: `docs/plans/2026-08-19-001-fix-persistent-sidebar-header-plan.md`
- `docs/solutions/logic-errors/a-property-test-is-only-as-strong-as-its-observers.md`
- `docs/solutions/documentation-gaps/screenshot-capture-races-and-viewer-lies.md`
