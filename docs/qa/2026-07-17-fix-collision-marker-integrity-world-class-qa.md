# World-Class QA: fix/collision-marker-integrity (0.6.13)

## Verdict

**Ready** — collision body-gate and failure reporting proven live on throwaway test vault + full unit suite.

## Charter

**Changed:** Process write path no longer appends `↳ [[existing title]]` when that atom’s body ≠ this capture; classify/integrity failures surface in report + Notice.

**Must work:** Foreign collision leaves capture unprocessed; matching collision still marks without overwrite; foreign atom body sacred.

**Adjacent risk:** Backfill apply, fixture process, re-process idempotency, whitespace-only body variance.

**Surface:** Obsidian desktop CLI on `test_vault/test vault` (not Remote Vault). Plugin **0.6.13** installed via `./scripts/install-to-vault.sh`.

## Preflight

| Prereq | Status |
|---|---|
| Navigation map | ✅ `docs/qa/app-navigation-map.md` |
| Fixtures | ✅ `docs/qa/testing-fixtures.md` + seed script in this pass |
| Dev/run | ✅ `npm run build` + `./scripts/install-to-vault.sh` |
| Live driver | ✅ `obsidian vault="test vault" …` |
| Auth | ✅ test vault has key; fixture path used for deterministic collision |
| Viewport | N/A — plugin logic + Notice text, not web UI redesign |
| Deploy | N/A — local plugin bundle |

**Mode:** Full automation on throwaway vault + unit tests.

## User Stories Tested

### Primary

1. **As a user, when Process reuses an existing title for a different capture, I want the capture left unprocessed, so that my daily doesn’t point at the wrong atom.**  
   Acceptance: no `<!--linker-->` under probe capture; `failures[0].reason === collision_mismatch`; foreign atom body unchanged.  
   Evidence: live fixture Process on `Daily/2026-07-05.md` (report below).  
   Status: **Passed**

2. **As a user, when I re-process the same claim (title + body match), I want a marker without overwriting the atom.**  
   Acceptance: `markersAppended: 1`, `collisions: 1`, body unchanged, marker present.  
   Evidence: live fixture Process with matching body.  
   Status: **Passed**

3. **As a user, when Process fails an item, I want to know which capture and why.**  
   Acceptance: `WritePathReport.failures[]` with `captureText`, `reason`, `message`.  
   Evidence: live `collision_mismatch` failure object; Notice path wired in `main.ts`.  
   Status: **Passed** (collision reason live; API rate-limit path same reporting plumbing, not re-hit with live 429)

### Continuation / regression

4. **Double Process after success does not stack markers or rewrite bodies.**  
   Evidence: second fixture run `scanned: 0`. Status: **Passed**

5. **Whitespace-only body differences still count as match.**  
   Evidence: double-spaced atom body vs single-spaced capture → marker appended. Status: **Passed**

### Negative / perception

6. **Foreign atom body is never overwritten on collision.**  
   Evidence: `foreignAtomStill: true` after mismatch run. Status: **Passed**

7. **Already-poisoned markers (legacy) remain until manual repair.**  
   Evidence: unit test + product design (out of scope). Status: **Not fixed by design** (documented residual)

## Risk Matrix

| Risk | Result |
|---|---|
| Happy: match collision marks | Pass live |
| Negative: mismatch no mark | Pass live |
| Edge: whitespace normalize | Pass live |
| Edge: double process | Pass live |
| Regression: unit suite 241 | Pass |
| Build | Pass `npm run build` |
| Perception: Notice failure detail | Code + live failures array; human may confirm Notice string on Process |

## Evidence

### Commands

```bash
npm run build
./scripts/install-to-vault.sh
npm test   # 241 passed
obsidian vault="test vault" eval '…runProcessFixtureSample…'
```

### Live mismatch run (decisive)

```json
{
  "atomsCreated": 0,
  "markersAppended": 0,
  "collisions": 0,
  "failed": 1,
  "failures": [{
    "dailyPath": "Daily/2026-07-05.md",
    "reason": "collision_mismatch",
    "message": "Title \"Multi-line ideas deserve atomic notes\" already exists with a different body — left unprocessed",
    "captureText": "QA collision probe: widgets and sprockets need atomic notes"
  }],
  "dailyAfter": "- QA collision probe: widgets and sprockets need atomic notes\n",
  "foreignAtomStill": true
}
```

### Live match run

```json
{
  "atomsCreated": 0,
  "markersAppended": 1,
  "collisions": 1,
  "failed": 0,
  "dailyAfter": "…\t↳ [[Multi-line ideas deserve atomic notes]] <!--linker-->\n",
  "bodyUnchanged": true
}
```

### Screenshots

N/A — no UI chrome change; product claim is write integrity + Notice text (CLI report is evidence).

## Adversarial QA

| Scenario | Result |
|---|---|
| Edit: re-process after mark | solid — scanned 0 |
| Destroy: foreign body overwrite attempt via collision | solid — body preserved |
| Redo: Process twice | solid |
| Weird: fixture order / multi-daily isolation | solid (isolated probe daily) |
| Boundary: whitespace-only body | solid — matches |
| Boundary: empty bullet | solid (parser skip, pre-existing) |
| Offline classify fail | solid plumbing (same `failures[]`); not re-driven with live network kill |
| Legacy wrong markers | deferred — repair command follow-up |

**Proven holes this pass:** none on 0.6.13 gate.  
**Suspected-unproven:** Notice toast visual copy on real Process UI (same string construction as failures[0]).  
**Deferred with product:** heal already-wrong Remote Vault markers.

## Not Tested

- Personal **Remote Vault** Process (lane: human only)
- Phone Sync install of 0.6.13 (post-merge `npm run phone`)
- Live Anthropic 429/offline classify (reporting path shared with collision_mismatch)
- Backfill batch apply live (same `applyWrite` gate; unit coverage via shared code)
- Home progress card copy for failures (uses `failed` count + Notice)

## Merge Decision

**Ship PR #67.** Integrity gate proven live; residual is pre-existing poisoned dailies + optional repair UX, not a regression of this fix.
