# World-Class QA: feat/update-notes-process-parity (PR #30)

## Verdict

**Ready after human phone smoke** — automated + pure-logic + CLI registration + install evidence green; live **Update with Anthropic** and full home-strip UI perception not driven end-to-end in this agent session.

## Charter

Prove **Update notes (0.6.7)** refreshes older linker atoms to Process parity without violating body sacred, protect-existing Process path, or auto-run. Surfaces: quality stamp on new writes, home strip + dismiss + confirm, batch refresh, rename/marker repair, keep-as-atom.

## Preflight

| Prereq | Status |
|---|---|
| Nav map | ✅ `docs/qa/app-navigation-map.md` (updated: update-notes) |
| Fixtures | ✅ unit + throwaway vault seed atoms |
| Dev/run | ✅ `npm test` / `npm run build` / `npm run phone` |
| Viewport | ✅ phone product (Remote Vault); desktop CLI for smoke |
| Auth / API | ⚠️ key present on device for live Update; agent did **not** fire live classify batch |
| Automation | ✅ vitest; CLI `atoms:update-notes` listed on Remote Vault |
| Mock | ✅ `docs/design-handoff/atoms-view/update-linking.html` v3.1 |

## User Stories Tested

### Primary

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| As a vault owner with older atoms, I want to see Update notes when quality is behind, so I can catch up | Eligible = linker + `atoms-quality` missing or &lt; CURRENT | `countEligibleForUpdate` / `isEligibleForRefresh` tests; test_vault count 14 unstamped | Passed (logic) |
| As a user, I want filing to stamp new atoms so they are not re-offered | New Process atoms get `atoms-quality` + `quality-updated` | `buildAtomMarkdown` / `render.test.ts` | Passed |
| As a user, I want Update to use the same AI path as Process | `classifyCapture` in refresh loop | `refreshAtoms.ts` + Process `write.ts` same choke point | Passed (code + unit structure) |
| As a user, I want original capture text preserved | Extract + reassemble; body identity tests | `refreshAtoms.test.ts` buildRefreshed / extract | Passed |
| As a user, I want a calm strip → confirm → run | Home strip + Modal confirm | `atomsHomeView.ts` renderUpdateNotesStrip / confirmUpdateNotes | Passed (code); **live UI Not tested** |

### Continuation

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| Batch leaves remaining | Done copy / remaining count | `formatUpdateSummary` test; `remaining = eligible - updated` | Passed (unit) |
| Dismiss hides strip for this quality gen | localStorage `atoms-update-notes-dismissed-q` ≥ CURRENT | `isUpdateNotesDismissed` tests | Passed (unit) |
| Second run only updates still-stale | Stamped not eligible | atomQuality tests | Passed |

### Negative

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| No API key | No classify; Notice to settings | `requireApiKey` before refresh | Passed (code path) |
| Multi-blank hand-edit body | Skip (untrusted), not corrupt | `extractCaptureBody` rejects multi blank | Passed |
| Model returns noise | Keep atom file; force atom | `keepAsAtomResult` tests | Passed |
| Target rename collides | Keep path + aliases | `planRefreshWrite` collision test | Passed |

### Edge

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| Marker repair unique match | Update `↳ [[old]]` only | `repairMarkerLine` tests | Passed |
| Marker ambiguous | Leave daily; no rewrite | ambiguous test | Passed |
| Title rename free path | renameTo set | planRefreshWrite rename test | Passed |

### Regression

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| Process still protect-existing | `skip_existing_atom` | `render.test.ts` collision | Passed |
| Auto-run never refreshes | only `runWritePath` | `maybeAutoRun` body read — no refreshEligible | Passed |
| Unit suite | green | `npm test` 213 | Passed |

### Perception

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| Strip copy “Filing got smarter…” | Mock + view match | mock HTML + view strings | Passed (source) |
| × dismiss present | Mock + view | both | Passed (source) |
| Live home strip visible on phone | Settings 0.6.7 + open home | Phone install 0.6.7; **human must open home** | **Not tested (live)** |
| Live Update progress | Progress card “Updating N of M” | code path; not driven live | **Not tested (live)** |

### Accessibility

| Story | Acceptance | Evidence | Status |
|---|---|---|---|
| Dismiss aria-label | `aria-label="Dismiss"` | atomsHomeView | Passed (source) |

## Risk Matrix (interactive + informational)

| Surface | Expected | Evidence |
|---|---|---|
| Update strip primary button | Opens confirm | source |
| Confirm Cancel / Update | Cancel closes; Update runs | source |
| Strip × | Dismisses for CURRENT quality | unit |
| Progress card phase `update` | “Updating N of M” | runProgress test |
| Done summary remaining | “X still older” | formatUpdateSummary test |
| Command `atoms:update-notes` | Registered | CLI list on Remote Vault |

## Evidence

```text
npm test          → 213 passed
npm run build     → ok
npm run phone     → Atoms v0.6.7 → Remote Vault
obsidian commands filter=atoms → includes atoms:update-notes
test_vault fixture: 14 eligible unstamped atoms (incl. QA legacy + multipara)
manifest Remote Vault: 0.6.7
```

## Findings

### Blocking for “Ready” without phone

None in code/unit. Live path not exercised.

### Polish / residual

1. **Live Update with API not run** — cost + needs key; human phone smoke required for full Ready.
2. **Nav map source paths** still say flat `src/atomsHomeView.ts` in places (hybrid layout) — updated command section only.
3. **QA multipara fixture** eligible by stamp rules but will **skip** on extract — correct; strip count may include skips until run.

## Adversarial QA

### Scenario ledger

| Scenario | Result | Proof |
|---|---|---|
| Edit model surfaces after refresh (re-run Update) | solid | Already CURRENT → not eligible (unit) |
| Delete atom mid-batch | blocked: live | No live multi-file drive |
| Double-tap Update | solid (code) | busy flag on home; second run while busy returns early |
| Offline / no key | solid | requireApiKey; classify missing_key |
| Multi-paragraph body | solid | extract untrusted → skip |
| Noise re-triage | solid | keepAsAtom unit |
| Rename collision overwrite | solid | keep path + aliases unit |
| Marker wrong capture | solid | ambiguous / mismatch no change |
| Auto-run after Update | solid | auto only runWritePath |
| Process same title after refresh | solid | still skip_existing |
| Dismiss then quality bump | solid | dismissed only if stored ≥ CURRENT |
| Hand-edited title overwritten | solid by design | confirm copy; not a bug — residual product risk |
| Batch partial (15 of many) | solid | remaining math unit |
| planWrite used for refresh | solid | separate path; never planWrite |

### Proven holes

None proven with failing test or live repro in this pass.

### Suspected unproven

- Obsidian Sync race mid-rename (file + marker) on phone.
- Home strip + Process wait both primary-weight on small phones (visual only).

### Fixes applied / deferred

- None applied this pass.
- **Deferred to human:** phone open home → strip → Update 1–2 notes → body check; dismiss ×; confirm Settings 0.6.7.

## Not Tested

- Live Anthropic refresh of real atoms
- Phone visual strip / confirm sheet / progress
- Marker repair against real daily after rename (unit only)
- First-day home (strip correctly hidden — code condition only)

## Merge Decision

| Decision | When |
|---|---|
| **Merge after human phone checklist** | Settings shows 0.6.7; strip appears for unstamped; Update one note body-identical + stamped; Process still works; auto-run does not mass-refresh |
| **Do not claim full Ready** until that checklist is ticked |

## Human phone checklist (copy)

1. Sync · quit/reopen Obsidian · Settings → Atoms → **0.6.7**
2. Open Atoms home · if older notes exist: **Update notes** strip + ×
3. × dismiss → strip gone · reopen later still gone (same quality gen)
4. Clear dismiss only if testing again (or wait for quality bump)
5. Update → confirm → run small batch · open one atom: body same, quality fields present
6. Process still files new captures; auto-run does not rewrite library
