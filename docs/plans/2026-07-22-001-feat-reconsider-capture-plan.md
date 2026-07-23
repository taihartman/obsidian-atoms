---
title: "feat: Reconsider capture (soft unfreeze)"
date: 2026-07-22
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
issue: 100
branch: feat/reconsider-capture-100
---

# Reconsider capture (soft unfreeze)

## Goal Capsule

Ship a **feature-flagged** command that lets a user reclassify one **already-skipped** capture (noise/task marker) with classify-once → dry-run sheet → Apply, without rewriting capture body or building vault clinic.

## Product Contract

### Problem

Once Process writes `<!--linker:noise-->` / `<!--linker:task-->`, the capture is frozen. Wrong first pass jails keepable thoughts. Manual fix = delete marker (tribal). Issue #100.

### Requirements

| ID | Requirement |
|---|---|
| R1 | Settings flag `enableReconsiderCapture` (default **false**). Command absent/no-ops when off. |
| R2 | Command `reconsider-capture` / name **Reconsider capture** only when flag on. |
| R3 | Target = active markdown daily + **cursor line** on capture body or its marker line. No vault picker. |
| R4 | Miss: Notice *Place the cursor on a skipped capture, then try again.* |
| R5 | Atom marker: refuse *This one already became a note…* — no demote. |
| R6 | Unprocessed / not noise|task: calm refuse (not Reconsider’s job). |
| R7 | Classify **once** with normal context + quality enrich; show modal with capture + **Now → Proposed**. |
| R8 | Apply only when proposed is **atom** and differs from skip; else disabled (*Still not worth keeping* / *No change*). |
| R9 | Apply: create atom (if needed) + **replace** marker region; body verbatim; collision body-gate — on mismatch leave old marker, Notice *Couldn’t file…*. |
| R10 | Success Notice *Filed as “{title}”* (no raw bodies beyond title). Refresh home if open. |
| R11 | Never rewrite capture bullet. Never batch. Never auto-sheet after Process. |
| R12 | Unit tests for marker replace/strip, cursor resolve, apply matrix. Version bump. |

### Actors / Flows

- **A1** User with flag on, cursor on skipped packing bullet → Reconsider → sheet → Apply → atom + atom marker.
- **A2** Model still says noise → Apply disabled.
- **A3** Cursor elsewhere → miss Notice.
- **A4** Flag off → command not registered (or hidden).

### Acceptance examples

- AE1: noise → atom: one atom file, body = capture text, single correct marker, second Process skips.
- AE2: noise → noise: no vault write on Apply (button disabled).
- AE3: stacked markers under capture: replace leaves exactly one new marker.
- AE4: flag false: no command in palette.

### Out of scope

- Home noise browser, batch reconsider, strip-without-classify, atom→noise, post-Process nags, teaching HTML comments in UI.

### Product Contract preservation

Product Contract unchanged from session settlements + #100 (mock PR design).

## Key technical decisions (session-settled)

| KTD | Decision | Provenance | Rejected | Why |
|---|---|---|---|---|
| KTD1 | Feature flag in `LinkerSettings.enableReconsiderCapture` default false | user-directed | Always-on ship | Dogfood gate |
| KTD2 | Cursor-only entry; no last-N picker | user-approved | Vault picker | Direct manipulation |
| KTD3 | Classify once → Apply commits that plan | user-approved | Preview “Process these” re-roll | Trust promise |
| KTD4 | `replaceMarkerAfterCapture` / strip then insert | user-approved | insert alone | insert no-ops when marker exists |
| KTD5 | v1 matrix: noise/task → atom only; same-skip no-op; atom refuse | user-approved | Full verdict matrix | Orphan risk |
| KTD6 | Dedicated ReconsiderModal (Preview family CSS) | user-approved | Reuse DryRun Process callback | Wrong write path |
| KTD7 | Human copy: skipped / note — not noise/task jargon | user-approved | Show linker comments | Apple language |
| KTD8 | Design mock + screenshots already under design-handoff / qa | user-directed | Implement without mock | Visual authority |

## Architecture

```
Command (flag on)
  → resolve active MarkdownView + cursor line
  → parseCaptures → findCaptureAtLine
  → gate markerKind ∈ {noise,task}
  → classifyCapture once
  → ReconsiderModal (Now/Proposed, Apply)
  → on Apply: planWrite → create atom → replaceMarkerAfterCapture → vault.modify
```

### Files

| Path | Role |
|---|---|
| `src/shared/types.ts` | `enableReconsiderCapture` setting |
| `src/settings/settings.ts` | Toggle under Experimental / Process |
| `src/pipeline/render.ts` | `stripMarkersAfterCapture`, `replaceMarkerAfterCapture` |
| `src/pipeline/reconsider.ts` | Pure: findCaptureAtLine, canApply, applyReconsider (or split) |
| `src/pipeline/reconsiderModal.ts` | Modal UI |
| `src/plugin/commands.ts` | Register when flag on |
| `src/plugin/main.ts` | `runReconsiderCapture`, refresh home |
| `styles.css` | `.atoms-reconsider-*` |
| `test/render.test.ts` | replace/strip markers |
| `test/reconsider.test.ts` | resolve + apply matrix |
| `manifest.json` / `package.json` / `versions.json` | 0.6.27 |
| `STATUS.md` | Claim #100 |
| `docs/design-handoff/...` | Mock (already staged) |
| `docs/qa/screenshots/soft-unfreeze-reconsider/` | Screenshots |

### Patterns to follow

- `DryRunPreviewModal` + `atoms-preview-*` CSS
- `planWrite` / `applyWrite` atom create + collision body-gate (reconsider uses replace instead of insert for daily)
- `marker-line-drift-batch-process.md`: re-locate end line; body sacred
- Commands: `plugin.addCommand` id without `atoms:` prefix

### Implementation units

#### U1 — Marker replace primitives + tests
- **Files:** `src/pipeline/render.ts`, `test/render.test.ts`
- **Tests:** strip stacked markers; replace noise→atom marker; body unchanged; identical marker → changed false optional
- **Done:** pure functions green

#### U2 — Resolve target + apply matrix (pure)
- **Files:** `src/pipeline/reconsider.ts`, `test/reconsider.test.ts`
- **API sketch:**
  - `findCaptureAtLine(content, line0): Capture | null` — body range or immediate marker line
  - `reconsiderTargetKind(cap): 'ok' | 'atom' | 'unprocessed' | 'none'`
  - `canApplyReconsider(nowKind, proposedVerdict): boolean` — true only if proposed === 'atom'
  - `applyReconsiderDaily(content, capture, markerLine): { content, changed }` → replaceMarker
- **Tests:** cursor on body, on marker, between bullets miss; canApply matrix
- **Done:** unit green

#### U3 — Vault apply path (atom create + replace)
- **Files:** `src/pipeline/reconsider.ts` (async apply using App)
- **Behavior:** planWrite → if collisionBodyMismatch abort without strip → create atom like applyWrite → replaceMarker → modify daily
- **Reuse:** listAtomPaths, buildAtom path from planWrite, extractCaptureBody / captureTextsMatch
- **Done:** logic complete; fixture-testable where pure

#### U4 — Modal + styles
- **Files:** `src/pipeline/reconsiderModal.ts`, `styles.css`
- **UI:** header Reconsider; sub Nothing written yet; snippet; Now/Proposed columns; Cancel + Apply; loading state optional if classify before open
- **Labels:** Skipped / Note; chips from links if any
- **Done:** opens without throw

#### U5 — Wire flag, command, main
- **Files:** types, settings, commands, main
- **Flag off:** do not register command
- **runReconsiderCapture:** requireApiKey; get editor; gates; classify; open modal with onApply
- **Done:** typecheck + tests

#### U6 — Version + STATUS + design assets
- Bump 0.6.27; STATUS In progress #100; include mock/screenshots from design handoff

## Risks

| Risk | Mitigation |
|---|---|
| insert no-op blocks promote | replace only path |
| collision half-write | abort before strip on mismatch |
| duplicate bullets | prefer capture containing cursor line index first |
| flag on without dogfood | default false |

## Test scenarios (summary)

1. replaceMarker: stacked noise markers → one atom marker; bullet bytes identical
2. findCaptureAtLine: line on marker binds parent capture
3. canApply: noise+atom true; noise+noise false; task+atom true
4. apply path collision mismatch: content unchanged (unit with mocked bodies if pure)

## Execution direction

Test-first on U1–U2 pure cores; then U3–U5; run `npm test` + `npm run typecheck`.

## Assumptions

- Daily notes plugin loaded when resolving date via `getDateFromFile`; if not a daily file, still allow reconsider on any markdown with captures (prefer daily) — if cursor file has captures, proceed; date from getDateFromFile or filename fallback `YYYY-MM-DD` or today local for created field.
- Command registration at onload: if user toggles flag, re-display settings note “Reload plugin or restart Obsidian to refresh commands” OR register always and no-op with Notice when flag off. **Prefer:** register always when settings loaded, check flag at callback start (simpler toggle without reload). KTD1 amended: command always registered; flag gates execution with Notice *Turn on Reconsider capture in Settings → Atoms.*

**KTD1b (pipeline):** Always register command; feature flag gates run. Avoids command-palette cache / reload friction.

## Open (non-blocking)

- Home refresh: call existing home invalidate if present after Apply.
- Land peak: optional skip for single reconsider (Notice enough v1).
