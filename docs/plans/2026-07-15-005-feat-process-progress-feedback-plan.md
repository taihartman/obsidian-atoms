---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/design-handoff/atoms-view/README.md
title: "feat: Process/Preview progress feedback on Atoms home"
date: 2026-07-15
type: feat
lane: amend
---

# feat: Process/Preview progress feedback on Atoms home

## Goal Capsule

When the user hits **Preview** or **Process** (including “today”), Atoms home shows **live progress** (`3 of 12`, current capture snippet, simple bar) and a **clear completion summary** (atom/task/noise/failed counts). Stop relying on a single disappearing Notice + `…` on buttons.

**Extends:** Atoms home (`src/atomsHomeView.ts`), dry-run card modal, write/dry-run `onProgress` hooks.  
**Lane:** amend — no new product surfaces, no model changes. Auto-run stays silent (no spam).

---

## Problem Frame

Today:

| Moment | Feedback |
|---|---|
| Start Process | Notice once: “processing…” |
| During | Buttons disabled + `…` only |
| Dry-run progress | `console.log` only |
| End | Notice with write counts; home refresh |

Users (especially on phone) can’t tell if work is stuck, how far along it is, or whether to wait vs tap again. Double-taps and “did it work?” follow from that gap.

**Already built:** `onProgress?.(done, total)` in `runWritePath` and `runDryRun` — not wired to UI.

---

## Product Contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | During **Preview** and **Process** started from home (past or today), show **in-home progress**: `Processing N of M` or `Previewing N of M` |
| R2 | Progress includes a **short snippet** of the capture currently in flight (one line, truncated) |
| R3 | Progress includes a **simple proportional bar** (or equivalent visual fill) — not only text |
| R4 | Buttons that start work stay **disabled** while busy; labels reflect state (e.g. “Working…” / keep `…`) |
| R5 | On **completion**, show a **summary** in home (and/or one Notice): `2 atoms · 1 task · 2 noise` (+ failed if any) — same vocabulary as preview pills |
| R6 | On **failure** of the whole run (exception), clear progress UI and show a short error Notice; home re-enables |
| R7 | **Auto-run** does **not** surface per-item progress UI or toast spam (keep silent / end summary only if already present) |
| R8 | Progress UI works when work is started from home **or** “Process these” after dry-run modal (refresh home still required) |
| R9 | Empty work set (`0` captures): no infinite spinner; immediate “Nothing to process” Notice and idle UI |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | Process 5 today bullets → home shows `Processing 1 of 5` … `5 of 5`, then summary with verdict mix |
| AE2 | Preview today → same progress labels with “Previewing…”, then card modal; progress clears |
| AE3 | Mid-run, Preview/Process buttons disabled |
| AE4 | Auto-run overnight → no progress strip flash on home if leaf closed; if leaf open optional: no requirement to show auto progress |

### Scope Boundaries

**In**

- Progress state on `AtomsHomeView` (phase, done, total, snippet, last summary)
- Wire `onProgress` from `main` → home when runs are home-initiated
- Enrich progress payload with capture snippet (optional signature extension)
- CSS for progress card/bar matching home design tokens
- Completion summary from write report / dry-run report
- One unit test for pure summary formatter (verdict counts)

**Out**

- Redesign of dry-run **result** cards (already shipped)
- Cancel mid-run / abort API
- Per-item success list mid-flight (too noisy for v1)
- Progress in Settings or status bar plugin
- Changing classify/write semantics or includeToday rules

---

## Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD-P1 | Progress UI lives on **Atoms home leaf**, not a second modal for the whole run | Phone: one place; preview modal is for *results*, not spinner |
| KTD-P2 | Extend `onProgress` to `(done, total, meta?: { captureText?: string })` | Snippet without parsing reports mid-flight; backward compatible |
| KTD-P3 | Fire `onProgress` **before** each classify call with the capture about to run (current behavior timing is fine once meta added) | User sees “current” item |
| KTD-P4 | `AtomsHomeView.setRunProgress` / `clearRunProgress` / `setRunSummary` public methods; `main` finds leaves via `getLeavesOfType(ATOMS_HOME_VIEW_TYPE)` | Same pattern as `refreshAtomsHomeLeaves` |
| KTD-P5 | Re-render progress region **without full library reload** each tick (dedicated DOM node updated in place) | Full `refresh()` every item is slow and flicker-y |
| KTD-P6 | End Notice stays one line; richer summary is **on home** progress card for  a few seconds or until next action | Avoid Notice spam; home is durable |
| KTD-P7 | Command-palette Process/Preview (not from home): update home leaves if open; else Notice-only progress optional every N items (default: end Notice only for palette) | Amend scope; home is primary |
| KTD-P8 | Version **0.4.2** patch | UX amend |

---

## High-Level Technical Design

```text
User taps Process / Preview today
  → home.setBusy(true) + show progress card (0 of M unknown until first tick)
  → main.runDryRun / runWritePath({
        onProgress: (done, total, { captureText }) =>
          home.updateProgress(done, total, captureText)
     })
  → each capture: progress 1/M … M/M
  → on success: home.setSummary(formatRunSummary(report)); clear bar or show “Done”
  → on finally: setBusy(false); refresh library counts (once)

Progress card (in scroll, above library):
  ┌─────────────────────────────────────┐
  │ Processing 3 of 12                  │
  │ “Alex likes periwinkle…”         │
  │ ████████░░░░░░░░  25%               │
  └─────────────────────────────────────┘

Done card (replaces progress briefly):
  ┌─────────────────────────────────────┐
  │ Done · 2 atoms · 1 task · 2 noise   │
  └─────────────────────────────────────┘
```

**Note:** `onProgress` today is called with `i + 1` at **start** of item — keep that; total is `slice.length`.

---

## Implementation Units

### U1. Progress callback meta + summary helpers (pure)

**Goal:** Typed progress meta + format completion summary from reports.

**Requirements:** R2, R5  

**Files:**
- Modify: `src/write.ts` — `onProgress?: (done, total, meta?) => void`; pass `{ captureText: capture.text }`
- Modify: `src/preview.ts` — same for `runDryRun`
- Create: `src/runProgress.ts` (or add to `atomsHomeData.ts`) — `formatRunSummary`, `ProgressPhase` types
- Create: `test/runProgress.test.ts` — **one** focused file  

**Approach:**
```ts
// directional
export type RunProgressMeta = { captureText?: string };
export type RunSummary = {
  atoms: number; tasks: number; noise: number; failed: number;
  mode: "preview" | "process";
};
formatRunSummary(s): "2 atoms · 1 task · 2 noise" 
// from DryRunReport entries / WritePathReport entries
```

**Verification:** unit tests for formatter edge cases (all noise, all failed, empty).

---

### U2. Atoms home progress UI + in-place updates

**Goal:** Progress/done card on home; no full refresh each tick.

**Requirements:** R1–R4, R6, R9, KTD-P1, KTD-P5  

**Files:**
- Modify: `src/atomsHomeView.ts`
- Modify: `styles.css`  

**Approach:**
- State: `runPhase: 'idle' | 'preview' | 'process' | 'done'`, `done`, `total`, `snippet`, `summaryText`
- `beginRun(phase, totalEstimate?)`, `updateRunProgress(done, total, snippet)`, `finishRun(summary)`, `failRun()`
- Render progress card when `runPhase !== 'idle'`
- `beginRun`: set busy, disable buttons, render once
- `updateRunProgress`: patch text + bar width only if `progressEl` exists; else light re-render of progress region
- Full `refresh()` only on finish (reload library + clear today counts)
- AE9: if total becomes 0 immediately, finish with “Nothing to process”

**Patterns:** match wait-card / try-today card styling; bar = div with % width.

**Verification:** manual AE1–AE3 on phone/desktop.

---

### U3. Wire main + modal Process to home progress

**Goal:** Home-initiated and post-preview Process drive progress.

**Requirements:** R1, R7, R8, KTD-P4, KTD-P7  

**Files:**
- Modify: `src/main.ts` — `runDryRunFromHome` / `runProcessFromHome` / dry-run modal `onProcess`  
- Optionally: private `broadcastProgress(...)` helper  

**Approach:**
```ts
// directional
for (const leaf of getLeavesOfType(ATOMS_HOME_VIEW_TYPE)) {
  (leaf.view as AtomsHomeView).updateRunProgress(...)
}
onProgress: (done, total, meta) => broadcast...
// beginRun before await runWritePath
// finishRun after report; failRun in catch
```

- Auto-run path: **do not** call beginRun/updateRunProgress  
- Palette commands: if any home leaf open, same broadcast; else end Notice only  

**Verification:** Process from home + Process these from modal both move the bar; auto-run silent.

---

### U4. Version 0.4.2 + short doc note

**Goal:** Ship patch; document progress in architecture one-liner.

**Requirements:** KTD-P8  

**Files:**
- `package.json`, `manifest.json`, `versions.json`
- `docs/architecture.md` (Product UI bullet: live progress on home)

**Verification:** install to Remote Vault; manual process 3+ bullets.

---

## Verification Contract

| Gate | Pass |
|---|---|
| Unit | Summary formatter tests |
| Full suite | Existing tests green |
| Manual process | Progress 1..N visible on home; buttons disabled |
| Manual preview | “Previewing N of M”; then result modal; progress clears/done |
| Manual empty | No hang; idle + Notice |
| Auto-run | No progress card spam |
| Regression | Marker bottom-up / no double markers still hold |

---

## Definition of Done

- [ ] U1–U4 complete  
- [ ] AE1–AE3 pass on phone or desktop with ≥3 captures  
- [ ] No full library rebuild per progress tick  
- [ ] 0.4.2 in Remote Vault plugins folder  

---

## Risks

| Risk | Mitigation |
|---|---|
| Full `render()` every tick thrash | KTD-P5 in-place DOM |
| Progress total wrong if slice empty | Handle 0; show nothing to process |
| Snippet PII in Notices | Snippet only on home UI, not in Notices |
| Modal process races home busy flag | beginRun from main before process; view respects external beginRun |

---

## Alternatives Considered

| Approach | Why not |
|---|---|
| Only update Notices every item | Flaky on mobile; toast stack ugly |
| Blocking modal for whole process | Worse than home-native progress; blocks reading results context |
| Per-item result list mid-run | Noisy; preview modal already covers “what” |
| Indeterminate spinner only | Doesn’t answer “where am I?” for 12 API calls |

---

## Open Questions (implement-time)

1. Keep “Done” summary visible until next user action vs auto-clear after ~4s — default: **until next action**  
2. Whether palette-only runs should show ephemeral Notices every 5 items — default: **no**  

---

## Sources

- User report: Process feedback insufficient; double Process confusion  
- `src/write.ts` / `src/preview.ts` existing `onProgress`  
- `src/atomsHomeView.ts` busy flag + wait/today cards  
- Card preview UI vocabulary (atom/task/noise pills)  
