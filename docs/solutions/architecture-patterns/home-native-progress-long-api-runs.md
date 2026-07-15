---
title: "Home-native progress for long Preview/Process API runs"
date: 2026-07-15
category: architecture-patterns
module: atoms-home
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - "Preview or Process will call Anthropic once per capture (often multi-second each)"
  - "Primary entry point is Atoms home on phone or desktop"
  - "Auto-run must stay silent and not spam UI"
tags:
  - progress
  - atoms-home
  - onProgress
  - dry-run
  - write-path
  - mobile
---

# Home-native progress for long Preview/Process API runs

## Context

Preview and Process classify captures sequentially over the network. Feedback used to be a single start Notice, buttons stuck on `…`, dry-run ticks only in `console.log`, and a final Notice with counts. On phone that felt stuck; users double-tapped Process and worsened marker issues. The dry-run **result** modal is for *what* was classified, not *how far* the run is.

## Guidance

1. **Progress lives on Atoms home**, not a second spinner modal for the whole run. Preview results stay in the dry-run card modal after classification finishes.
2. **Enrich the existing `onProgress` hook** on `runDryRun` / `runWritePath` with optional meta (`captureText`) so the UI can show a one-line snippet without re-parsing reports mid-flight. Fire progress at the **start** of each item (`i + 1` of `slice.length`).
3. **Broadcast to open home leaves** from `main` (`getLeavesOfType` + `beginRun` / `updateRunProgress` / `finishRun` / `failRun`). Palette and modal Process use the same broadcast when a home leaf is open; if none is open, end Notice only is enough.
4. **In-place DOM updates** for ticks — do not full-rebuild the atom library on every item. Full `refresh()` once on finish (or fail) to reload counts.
5. **Completion summary on home** using atom/task/noise/failed vocabulary (`formatRunSummary`), plus a short end Notice. Keep snippet text off Notices (PII surface).
6. **Auto-run never drives the progress card** — no `beginRun` / per-item toasts on the silent path.
7. **Empty work set** finishes immediately with “Nothing to process/preview”; never leave a spinner.

Directional shape:

```text
beginHomeRun(preview|process)
runDryRun/runWritePath({ onProgress → updateHomeProgress })
finishHomeRun(formatRunSummary(...)) | failHomeRun(...)
// auto-run: runWritePath without home progress hooks
```

Pure helpers live in `src/runProgress.ts`; view API on `AtomsHomeView`; wiring in `src/main.ts`.

## Why This Matters

Long sequential API work without progress invites retries and double Process—which is how line-drift and stacked markers get worse. Home is the durable surface the user already has open; Notices disappear. Separating **progress** (home) from **results** (preview cards) matches the product: home is the control surface, modal is the inspect surface.

## When to Apply

- Any home-initiated Preview/Process (past or includeToday)
- Modal **Process these** after dry-run (same write path + home broadcast)
- New long-running vault jobs that users start from home

Do **not** apply to silent auto-run, connectivity probe, or pure fixture smoke unless debugging.

## Examples

**Before:** Process 12 captures → one Notice → dead UI → user taps Process again.

**After:** Home shows `Processing 3 of 12`, truncated snippet, fill bar; buttons disabled; then `Done · 2 atoms · 1 task · 2 noise`; library refresh once.

**Auto-run:** Overnight drain with home closed or open → no progress strip requirement; no toast spam.

## Related

- Plan: `docs/plans/2026-07-15-005-feat-process-progress-feedback-plan.md`
- Marker reliability: `docs/solutions/logic-errors/marker-line-drift-batch-process.md`
- Design: `docs/design-handoff/atoms-view/`
