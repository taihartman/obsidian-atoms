---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: Persistent Atoms Sidebar Header - Plan
type: fix
date: 2026-08-19
---

# Persistent Atoms Sidebar Header - Plan

## Goal Capsule

- **Objective:** Keep the Atoms home header and its More, Open today's note, and Settings controls visible while any in-home detail is open and after the sidebar is collapsed and reopened.
- **Authority:** This plan, `docs/architecture.md`, `docs/obsidian-api-conventions.md`, and the repository non-negotiables in `CLAUDE.md`.
- **Execution profile:** Debug-lane patch with characterization-first DOM coverage and live throwaway-vault UI verification.
- **Stop conditions:** Do not edit implementation files until the work has an assigned GitHub Issue, a non-overlapping `STATUS.md` row, a pushed feature branch, and a draft PR. The stale `STATUS.md` row for merged issue #569 currently overlaps `src/home/atomsHomeView.ts` and must be cleared or confirmed before implementation.
- **Tail ownership:** The implementation run owns simplify, code review, durable learning capture, world-class QA, adversarial QA, versioning, and PR evidence.

## Product Contract

### Summary

Atoms home keeps one stable header above both the main home and every in-home detail. The detail remains the active screen, retains its Back navigation, and owns the single scroll region beneath the header.

### Problem Frame

`AtomsHomeView.render()` empties the view root on every redraw. When `homeOpen` is set, it creates only the detail scroll container and returns before constructing the header. A sidebar reveal refreshes data without clearing `homeOpen`, so reopening a leaf that was on a detail immediately shows a headerless screen. CSS does not hide the header; the detail branch omits it from the DOM.

### Requirements

- R1. Every `homeOpen` variant keeps the existing Atoms title, current subtitle, More control, Open today's note control, and Settings control visible.
- R2. Main home and detail states each render exactly one header and one scroll region.
- R3. An active detail and its Back behavior survive ordinary rerenders and sidebar collapse/reopen.
- R4. The main-home layout, header behavior, content ordering, and actions remain unchanged.
- R5. Header and detail content remain usable in the desktop sidebar and phone-width layout.
- R6. The fix adds no new user-facing copy, dependency, vault write, filing behavior, or editor chrome.

### Acceptance Examples

- AE1. Given main home is open, when the view renders, then the existing header and main content appear once.
- AE2. Given an atom detail is open, when the view rerenders or the sidebar is reopened, then the same atom detail remains active beneath a visible header.
- AE3. Given an entity-siblings or mind-change-pair detail is open, when the view renders, then the detail Back control and all shared header controls are present.
- AE4. Given any detail is open, when Back is pressed, then main home returns with one header and no duplicated scroll container.

### Scope Boundaries

**In scope**

- Consolidate header construction so the main and detail branches share it.
- Add DOM regression coverage for all discriminated `homeOpen` variants and rerender transitions.
- Bump the plugin patch version and capture live throwaway-vault evidence.

**Out of scope**

- Redesigning the header, detail layouts, Back labels, iconography, or subtitle copy.
- Clearing `homeOpen` when the sidebar closes or refreshes.
- Changing filing, resurfacing selection, hub membership, Settings, or vault data.
- Editing `styles.css` unless live QA proves that retaining the header exposes a layout defect that existing flex ownership does not handle.

## Planning Contract

### Key Technical Decisions

- KTD1. **Render shared chrome before selecting main or detail content.** Header construction has one owner; the `homeOpen` branch selects only what renders into the content scroll region.
- KTD2. **Preserve detail state across refresh.** The fix must not reset `homeOpen`; reopening the sidebar should restore the same detail with complete chrome.
- KTD3. **Keep existing scroll ownership.** `.atoms-home-header` remains a non-shrinking flex child and `.atoms-home-scroll` remains the only vertical scroller. No CSS change is planned because the existing rules already express this layout.
- KTD4. **Characterize the whole render transition before changing it.** A happy-dom test starts from a real rendered view, enters each detail variant, rerenders, and observes the DOM. Separate hand-built expected trees are insufficient because they cannot catch a missing transition redraw.
- KTD5. **Ship as the next patch version.** Re-read current versions immediately before implementation, then update `package.json`, `manifest.json`, and `versions.json` together. From the planning baseline, the expected version is `0.8.11`.

### Sequencing

1. Resolve the stale overlapping claim and complete the repository hard claim.
2. Add a failing render-transition regression test.
3. Consolidate header rendering and make the focused test pass.
4. Bump the version, run repository verification, and complete live UI QA.

## Implementation Units

### U1. Characterize and retain shared header chrome

- **Goal:** Make every detail render through the same persistent header shell as main home.
- **Requirements:** R1, R2, R3, R4, R5, R6; KTD1, KTD2, KTD3, KTD4.
- **Dependencies:** Repository hard claim completed with no active hot-file overlap.
- **Files:**
  - Modify: `src/home/atomsHomeView.ts`
  - Create: `test/atomsHomeView.test.ts`
  - Modify if shared setup is warranted: `test/helpers/homeView.ts`
- **Approach:**
  1. Extend the existing prototype-based home-view harness with the minimum app and plugin doubles required to drive the real `render()` method.
  2. Render the shared header before branching on `homeOpen`.
  3. Create one content scroll region and route either `renderHomeOpen()` or the existing main-home content into it.
  4. Preserve all existing detail setters, Back callbacks, labels, action handlers, and refresh behavior.
- **Patterns to follow:** Obsidian DOM helpers in `test/mocks/domAugmentations.ts`; narrow view doubles in `test/helpers/homeView.ts`; CSS and API conventions in `docs/obsidian-api-conventions.md`.
- **Execution note:** Start with a failing DOM characterization that reproduces the missing header on the current implementation.
- **Test scenarios:**
  - Covers AE1. Render main home and assert one `.atoms-home-header`, one `.atoms-home-scroll`, the Atoms title, and all three labeled controls.
  - Covers AE2. Enter an atom detail, rerender, and assert the atom identity remains while the same header controls remain present.
  - Covers AE3. Parameterize entity-siblings and mind-change-pair details and assert each keeps its Back control, detail content, and one shared header.
  - Covers AE2 and AE3. Rerender each active detail twice and assert neither the header nor scroll region duplicates.
  - Covers AE4. Trigger Back from each detail and assert main home returns with one header and one scroll region.
  - Regression: Move the detail branch ahead of header construction in a mutation check and confirm the focused test fails on the absent title and controls.
- **Verification:** The focused test fails against the pre-fix branch for the reported symptom and passes after the render-shell change. No product copy or CSS changes appear in the diff.

### U2. Version and prove the user-visible fix

- **Goal:** Give the UI correction a distinct plugin version and produce reviewable runtime evidence.
- **Requirements:** R1, R3, R5; KTD5.
- **Dependencies:** U1.
- **Files:**
  - Modify: `package.json`
  - Modify: `manifest.json`
  - Modify: `versions.json`
  - Create: `docs/qa/2026-08-19-persistent-sidebar-header-world-class-qa.md`
  - Create: `docs/qa/screenshots/persistent-sidebar-header/01-atom-detail-header.png`
  - Create: `docs/qa/screenshots/persistent-sidebar-header/02-reopened-sidebar-header.png`
- **Approach:**
  1. Apply the next patch version across all three version sources.
  2. Install the built plugin into `test_vault/test vault` under the shared-vault lock.
  3. Open a real in-home detail, then collapse and reopen the left sidebar without clearing the detail.
  4. Verify the title, subtitle, More, Open today's note, Settings, Back, detail identity, and scrolling.
  5. Capture settled frames only after asserting the view has non-zero bounds; use the repository's repeated-capture guard against stale screenshots.
- **Patterns to follow:** Vault lanes and screenshot rules in `docs/qa/README.md`; stale-frame and zero-bounds guidance in `docs/qa/learnings.md`.
- **Test scenarios:**
  - Happy path: atom detail retains the complete header and all controls work.
  - Lifecycle: collapse and reopen the sidebar; the same detail remains active with complete header chrome.
  - Variant: exercise an entity-siblings or mind-change-pair detail and confirm the same shell behavior.
  - Responsive: verify a phone-width home leaf has no clipped controls and the detail scrolls beneath the fixed header.
  - Negative: Back returns to main home without duplicated chrome.
- **Verification:** The test-vault plugin reports the bumped version, live screenshots show the required states, and the QA report records world-class and adversarial outcomes without touching a personal vault.

## Verification Contract

| Gate | Applies to | Done signal |
|---|---|---|
| Focused home-view test | U1 | All main/detail/rerender scenarios pass and the pre-fix mutation fails |
| `npm test` | U1, U2 | Full Vitest suite passes |
| `npm run lint` | U1 | Obsidian community rules pass with no warnings |
| `npm run build` | U1, U2 | Typecheck and production bundle succeed |
| `./scripts/verify.sh` | U1, U2 | CLI verification passes while Obsidian is open on `test_vault/test vault` |
| Live desktop sidebar smoke | U2 | Detail open, collapse, reopen, Back, and controls match R1-R5 |
| Phone-width smoke | U2 | Header remains visible and detail scrolling remains usable |
| Shipping tail | U1, U2 | Simplify, code review, compound, world-class QA, and adversarial QA complete; P0/P1 findings are fixed |

If the shared QA skills are unavailable, stop the shipping-tail QA step and record a blocked handoff. Do not substitute code reading or unit tests for world-class QA.

## Definition of Done

- The assigned Issue, `STATUS.md` row, branch, and draft PR satisfy the hard-claim rules before implementation starts.
- No active `STATUS.md` row overlaps `src/home/atomsHomeView.ts` or the selected test files.
- R1-R6 and AE1-AE4 are covered by the final implementation and evidence.
- The focused regression fails on the old branch shape and passes on the fix.
- Main home and all three detail variants render exactly one header and one scroll region.
- Sidebar collapse/reopen preserves the active detail and complete header chrome.
- `package.json`, `manifest.json`, and `versions.json` identify the same patch version.
- All Verification Contract gates pass, including the required shipping tail.
- The PR body contains `Closes #<claimed-issue>`, distilled core user stories, checked test-plan items, the QA report, and absolute raw GitHub URLs for committed screenshots.
- Temporary probes and abandoned implementation attempts are absent from the final diff.
