---
title: "feat: Library Skipped filter + long-press unlabel"
date: 2026-08-05
type: feat
artifact_contract: "ce-unified-plan/v1"
artifact_readiness: "implementation-ready"
product_contract_source: "ce-plan-bootstrap"
execution: "code"
issue: 287
lane: light
origin: "GitHub #287; deferred SD6 from docs/plans/2026-08-05-001-fix-library-vault-longpress-continue-plan.md; handoff library-noise-task-filter"
doc_review: "2026-08-05 ce-doc-review round 1 — safe_auto + best-judgment gated fixes applied"
---

# Library Skipped filter + long-press unlabel — Plan

## Goal Capsule

Ship a calm Library **browser** for captures Process already marked noise or task, plus reversible **strip-only unlabel** so they re-enter the Process queue.

This closes the **inventory + undo-skip** job — not “promote a wrong skip to atom.” Promote stays **Reconsider** (flag-gated, classify → Apply). Long-press alone must not read as permanent rescue; Process may re-skip an unchanged body.

**Authority:** Issue #287 · this plan · CLAUDE.md · CONCEPTS.md · sibling #288 (gesture infra only).

**Stop when:** third filter + pure list/unlabel helpers tested, home wired, `test_vault/` smoke, version bump, screenshots under `docs/qa/screenshots/library-skipped/`.

**Product Contract preservation:** bootstrap from issue + session; doc-review amended chips, Notice truth, Undo pattern, #100 supersession.

## Product Contract

### Summary

Third Library segment **Skipped** beside All · Linked. Lists **daily captures** with `<!--linker:noise-->` or `<!--linker:task-->` (newest first). Tap opens the daily. Touch **long-press** strips the marker only (body sacred) with **Undo**. Desktop **right-click** opens a small Menu (Open daily · Unlabel) — not silent mutate. Not a task app; no AI on this gesture.

### Requirements

- R1. Filter tabs **All · Linked · Skipped** (Skipped last).
- R2. All / Linked unchanged: atom-folder rows; atom long-press still **Continue**.
- R3. Skipped lists processed daily captures `markerKind ∈ {noise, task}` only — not atoms, unprocessed bullets, or inbox `<!--atoms:filed-->`. Include **today**. Soft product default: show newest first; memoize until vault modify (no guilt counts, no “N skipped” badges).
- R4. Each row: single-line (max ~2) **snippet** of capture body, optional quiet kind meta that **must not mean atom**, source day, relative time. Full text in `title`/aria-label. **No `Note` chip** (Reconsider: Note = atom). Prefer **no kind chip** or a single muted “Set aside” treatment; if noise vs task must differ, use copy that never says Note and avoids checklist gravity (do not label rows **Task** as a chip noun — secondary meta only if needed).
- R5. Tap → open daily in vault (path MVP; line-focus if cheap).
- R6. **Touch long-press** (~400ms, 12px slop) → unlabel (strip post-extent markers only). **Desktop:** `contextMenuAsLongPress: false` on Skipped rows; `Menu` with **Open daily** + **Unlabel** (only Unlabel writes). Never rewrite bullet body.
- R7. After unlabel: reversible feedback with **Undo** that restores prior marker kind. Notice copy is **date-truthful**:
  - past daily → `Unlabeled — will show on next Process` (+ Undo)
  - today → `Unlabeled — Process today to reclassify` (+ Undo)  
  Never claim default Process picks up today. List + pending/process surfaces refresh when they already re-scan.
- R8. Empty Skipped is calm, branched:
  1. Dailies scanned, none skipped → `Nothing set aside.` + one-line why: set-aside daily lines land here after Process (not filed notes).
  2. No dailies / first empty → softer first-empty.
  3. Daily notes disabled → existing daily-disabled signal, not a blank bug.  
  Never reuse Linked’s `Nothing linked in this filter.`
- R9. Not a task app: no checkboxes, due dates, priority, complete-task. Task markers stay listable as legacy processed skips without Task-app chrome.
- R10. Body sacred; strip/restore via existing render helpers; dogfood `test_vault/` / demo only.
- R11. Patch bump; shipping tail; PR `Closes #287`.
- R12. Dual-path matrix (explicit): **read** Skipped always on; **write unlabel** = strip + Undo, no `enableReconsiderCapture`; **promote** = Reconsider command when flagged. Home inventory intentionally supersedes #100 v1 “no home noise browser.”

### Actors

- A1. Vault owner on desktop / iOS / Android home Library.

### Key flows

- F1. Library → Skipped → noise/task captures from dailies (including today).
- F2. Tap → daily opens.
- F3. Long-press (touch) or Menu → Unlabel → marker gone → eligible for Process (past: default queue; today: Process today only) → row leaves Skipped. Unchanged body may re-skip on next classify.
- F4. Undo within TTL → marker restored → row returns. Undo fails calmly if already re-processed or capture gone.
- F5. All/Linked + atom Continue unchanged (regression).

### Acceptance examples

- AE1. Fixture daily with noise + task under Skipped; neither under All; chips/meta never say Note for noise.
- AE2. Unlabel **past** noise: body identical; marker gone; unprocessed; appears in normal Process queue.
- AE2b. Unlabel **today**: Notice does not claim default Process; force Process today can see it.
- AE3. Undo restores prior marker kind when still unprocessed.
- AE3b. Undo after Process already re-stamped → calm “could not restore”; no double marker.
- AE4. Scroll/slop: no unlabel; short tap never unlabels.
- AE5. Atom long-press still Continues.
- AE6. Desktop right-click shows Menu; does not strip without choosing Unlabel.
- AE7. Re-Process unchanged body may re-skip (documented; not a bug).

### Scope boundaries

**In:** enumerate skipped; filter + rows + empty; touch unlabel + desktop Menu; Undo; tests; smoke screenshots.

**Out:** Reconsider sheet / API promote on this gesture; batch unlabel; atom→noise; task-app features; Process default changes; land-peak long-press; pagination UI (memoize only until pain).

### Settled decisions (session + doc-review)

| ID | Decision | Over | Provenance |
|---|---|---|---|
| SD1 | Tab **Skipped** | Noise / Soft / Held / Other | session Apple-default |
| SD2 | List = daily noise\|task markers | atom tags; unprocessed-only | session + #287 |
| SD3 | Touch long-press = **strip-only** unlabel | Reconsider modal; promote-on-press | session; treadmill risk named in Goal |
| SD4 | Feedback = **Undo** primary (Fragment Notice or home-ephemeral bar) | confirm-before-strip; silent strip | session; confirm only if Undo control fails mobile QA — then amend SD4 in PR, not silent |
| SD5 | Tap = open daily | expand inline | session |
| SD6 | **No Note chip**; avoid Task chip noun | Note/Task chips “aligned with Reconsider” | doc-review: Reconsider Note=atom, noise\|task=Skipped |
| SD7 | Reuse `attachLongPress` + `filterTabs` | new gesture system | session + #288 |
| SD8 | Atom rows keep Continue | share unlabel on atoms | session |
| SD9 | Desktop Menu Open + Unlabel; no silent contextmenu unlabel | contextMenuAsLongPress → immediate unlabel | doc-review design |
| SD10 | #287 home Skipped inventory **supersedes** #100 v1 no-home-noise-row | keep command-only entry | doc-review product |
| SD11 | Outcome = browser + reversible unlabel, **not** promote | implying long-press rescues keepable notes | doc-review JTBD honesty |

### Open questions

| Q | Status | Default |
|---|---|---|
| Line-precise editor open | deferred | path open MVP |
| Soft cap / window if thousands | deferred | newest-first full scan + memoize; add window only if dogfood pain |
| After strip, one-shot promote from row | deferred follow-up | Reconsider command only for v1 |

## Planning Contract

### Key technical decisions

- KTD1. **Separate row model, shared chrome.** `FilterMode = "all" | "linked" | "skipped"`. `SkippedLibraryEntry` (path, date, line identity, snippet, markerKind, sort key). Branch render on filter. Subtle list subtitle on Skipped: set-aside daily lines, not filed notes.
- KTD2. **Pure + vault pair.** `collectSkippedCaptures(notes)` + `listSkippedLibraryEntries(app)` via `getAllDailyNotes` + `cachedRead` (include today). **Never** `getPastDailyNotesWithUnmarkedCaptures` (drops fully-skipped notes).
- KTD3. **Unlabel = strip only.** `applyUnlabelWrite` / restore via `stripMarkersAfterCapture` + insert prior kind. No classify, no `applyReconsiderWrite`. Gate with shared noise\|task predicate (not flag-gated Reconsider apply path).
- KTD4. **`vault.process` apply skeleton.** Callback **sync pure**: re-parse → gate → strip/insert → return string. No `await` inside `process`. Same for Undo restore.
- KTD5. **Gesture split.** All/Linked: tap atom, long-press Continue (`contextMenuAsLongPress` default ok if already Continue). Skipped: tap daily; touch long-press unlabel; desktop `contextMenuAsLongPress: false` + Menu. Always clear `libraryPressDetach` at **start** of library render.
- KTD6. **Undo TTL plugin-scoped ~10–15s** (survive filter switch + open daily); single-flight last payload; clear on next unlabel or TTL. On Undo: re-gate; refuse if marker present / body gone. Prefer `Notice` + `DocumentFragment` with Undo control (`duration` 0 or ≥10s); if mobile QA fails, home-inline ephemeral Undo bar — **not** confirm-before-strip unless SD4 amended in PR.
- KTD7. Read always on; unlabel write not behind `enableReconsiderCapture`.
- KTD8. **Load timing.** Load skipped inside `loadData`/refresh (prefer one daily-read pass). Tab switch must not leave permanent empty from sync-only `render`.
- KTD9. **U0 Undo spike** before U3: prove Fragment Notice Undo on desktop + one mobile target; record pattern in PR.

### Technical design (directional)

```
FilterMode = all | linked | skipped

skipped:
  listSkippedLibraryEntries(app)
  rows SkippedLibraryEntry
  touch: attachLongPress(onTap open daily, onLongPress unlabel, contextMenuAsLongPress: false)
  desktop contextmenu → Menu Open | Unlabel

all | linked:
  listAtomLibraryEntries
  attachLongPress → Continue / open atom
```

Unlabel pipeline:

1. `vault.process`: parse, gate noise|task, strip, return next.
2. Store undo payload (path, kind, identity) plugin-scoped TTL.
3. Date-truthful Notice + Undo control.
4. Refresh skipped + process-count surfaces.
5. Undo: process restore only if still unprocessed match; else calm fail.

### Assumptions

- Baseline ≥ 0.6.74 long-press infra.
- Daily notes plugin loaded; disabled → empty + existing signal.
- Obsidian `Notice` accepts `DocumentFragment` (typings); first in-repo action-Notice pattern OK.

### Risks

| Risk | Mitigation |
|---|---|
| Re-skip treadmill after strip | Goal honesty; AE7; copy doesn’t promise rescue; Reconsider for promote |
| Inventory guilt vs #100 | SD10; empty copy; no counts |
| Undo fails platform | KTD9 spike; amend SD4 only if needed |
| Accidental unlabel | desktop Menu; touch Undo TTL; AE4/AE6 |
| Large vault scan | memoize; deferred soft cap |
| Atom Continue regression | KTD5 branch; AE5 |
| Process races Undo | AE3b re-gate |

### Dependencies / sequencing

1. Claim #287 (STATUS + `feat/library-skipped-filter` + draft PR).
2. **U0** Undo spike → U1 list → U2 unlabel/restore → U3 home → U4 ship.
3. Depends on #288/#291 long-press; not on Reconsider flag.

### Patterns to follow

- `src/ui/longPress.ts`, `atomsHomeView` detach list, `filterTabs`
- `parseCaptures`, `stripMarkersAfterCapture`, `replaceMarkerAfterCapture` / marker insert
- `gateReconsiderTarget` predicate shape only
- Tests: `atomsHomeData`, `parse`, `render`, `reconsider`, `longPress`
- Sibling plan SD6; RMW learning doc

### Execution direction

Test-first pure helpers. U0 spike before U3 UI. Home = vault smoke + screenshots.

## Implementation Units

### U0. Undo affordance spike

**Goal:** Prove reversible control on desktop + one mobile path.

**Files:** scratch in branch or minimal home helper; note result in PR.

**Approach:** `DocumentFragment` Notice with Undo button; duration ≥10s or 0. Fallback home-ephemeral bar. Confirm-before-strip only if both fail — then update SD4 in plan/PR.

**Verify:** manual smoke; no ship without working Undo or explicit SD4 amend.

### U1. Enumerate skipped captures

**Goal:** Canonical noise|task list.

**Files:** `src/home/skippedLibrary.ts` (or `atomsHomeData.ts`), vault wrap, `test/skippedLibrary.test.ts`

**Approach:** pure `collectSkippedCaptures`; vault `listSkippedLibraryEntries` over all dailies; never unmarked collector.

**Test scenarios:** noise+task in; atom out; unprocessed out; empty; sort; stacked markers via parse rules.

### U2. Unlabel + restore writes

**Goal:** Strip/restore one capture safely.

**Files:** `src/pipeline/unlabel.ts` (or reconsider-adjacent), `test/unlabel.test.ts` / `render.test.ts`

**Approach:** gate; `vault.process` sync strip/restore; export for home.

**Test scenarios:** strip noise/task; refuse atom/unprocessed; restore round-trip; idempotent gone; (apply path unit-test pure strings).

### U3. Home filter + rows + gestures

**Goal:** Wire Skipped UI.

**Files:** `src/home/atomsHomeView.ts`, styles if needed

**Approach:** FilterMode + tab; loadData skipped; R8 empty branches; KTD5 gestures + Menu; R7 Notice; KTD6 undo; detach always; subtitle ontology cue; row clamp.

**Verify:** typecheck; AE1–AE7 on `test_vault/`; screenshots.

### U4. Ship tail

**Files:** version manifests, PR, STATUS

**Approach:** patch bump; `Closes #287`; verification checklist.

## Verification Contract

| Gate | Action |
|---|---|
| Units | `npm test` |
| Smoke | `test_vault/`: past + today fixtures; list; tap; touch unlabel; desktop Menu; Undo; Process past; Process today |
| Regression | All/Linked + Continue |
| QA | world-class-qa + adversarial-qa if skills installed |
| Evidence | `docs/qa/screenshots/library-skipped/` |
| Release | human BRAT after GitHub Release |

## Definition of Done

- [ ] U0–U3 complete on claimed branch; `npm test` green
- [ ] R1–R12; AE1–AE7 on test_vault
- [ ] No atom Continue / All/Linked membership regressions
- [ ] PR `Closes #287`, real test checks, screenshots
- [ ] STATUS cleared after merge; version bumped

## Appendix

### Origin pointers

- https://github.com/taihartman/obsidian-atoms/issues/287
- https://github.com/taihartman/obsidian-atoms/issues/288
- `docs/plans/2026-08-05-001-fix-library-vault-longpress-continue-plan.md` SD6
- `docs/plans/2026-07-22-001-feat-reconsider-capture-plan.md` (#100; home browser + strip deferred then; **#287 supersedes home entry**)

### Doc-review coverage (round 1)

Personas: coherence, feasibility, product-lens, design-lens, adversarial. Cross-model peer not run (time). safe_auto: F1 today wording, helper name pair, detach-on-render. Best-judgment applied: chips, Notice truth, Undo spike/TTL, empty branch, vault.process, desktop Menu, JTBD honesty, #100 supersession, dual-path matrix.

### Residual risks (accepted)

- Re-skip treadmill until promote UX ships
- First action-Notice pattern in repo
- Full-history Skipped may need soft window later
- Keyboard unlabel only via desktop Menu focus (no new command in v1)
