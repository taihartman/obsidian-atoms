# World-Class QA: feat/land-then-remember (0.6.14)

## Verdict

**Not ready for “merge-ready world-class”** — **BLOCKED on live Obsidian vault smoke** on this agent host.

**Code + unit evidence:** solid enough to continue review.  
**Live product path:** not exercised here (no Obsidian CLI, no demo/test vault in workspace).

Do **not** treat this file as a ship green light until the human checklist below is checked and screenshots land under `docs/qa/screenshots/land-then-remember/`.

---

## Preflight

| Prereq | Status |
|---|---|
| Navigation map | ✅ `docs/qa/app-navigation-map.md` (updated this pass for land peak) |
| Dev/build | ✅ `npm run build` / `npx vitest run` |
| Target viewport | ✅ mobile-first home ~375 (Obsidian leaf) |
| Auth / API key | ❌ agent has no demo vault + key path on this Windows host |
| Demo / test vault | ❌ `docs/media/demo-vault` seed not present; `test_vault` absent |
| Obsidian CLI | ❌ `obsidian` not on PATH |
| Locked mock | ✅ `docs/design-handoff/atoms-view/land-then-remember.html` |
| Browser automation | N/A (Obsidian plugin, not web app) |

**Operating mode:** Checklist handoff + automated pure-core + adversarial code pass. Not full automation.

---

## Charter

**What changed:** Post-write **land peak** (Done + filed titles) freezes resurface; connected cue must name seed/via; soft `People`-only edges dropped.

**Must work:** Process / Update / auto-run (home open) land card; dismiss; calm resurface honesty.

**Regressions:** Wait card, Update strip, mind-change, preview, collision integrity.

**Platforms:** Desktop + phone Obsidian (plugin consumers).

---

## User intent

- **Goal:** Trust what just filed; don’t get a random “related” card mid-completion.
- **Questions UI answers:** What landed? Can I open it? Why is this older note here later?
- **Confidence:** Named titles on Done; named connected kicker later.
- **Distrust:** Opaque related; two heroes (Ready + Done); land peak vanishing without dismiss.

---

## User stories

| Story | Status | Evidence |
|---|---|---|
| As a user who Process’d, I want a Done card with new titles so I know what landed. | **Not tested live** | Unit: `landPeak.test.ts`; code: `fillLandPeakContent` |
| As a user on Done, I do not want a resurface card until I dismiss. | **Not tested live** | Code: resurface only when `runPhase === idle` |
| As a user with leftover queue, I still want Done as the only hero until dismiss. | **Fixed in code this pass** | Wait card + Update strip suppressed when `landPeak` set |
| As a user later calm, connected either names why or is silent. | **Unit only** | `resurface.test.ts` People-only / Alex chip |
| As a user on Update notes, I get Updated N land peak. | **Not tested live** | Wire in `main.ts` + `updatedItems` |
| As a user with auto-run and home open, I get land peak not only a Notice. | **Not tested live** | `hasOpenAtomsHome` + `finishHomeRun` |
| As a user who double-taps Process mid-run, UI stays coherent. | **Not tested live** | `beginRun` clears landPeak |
| Open missing landed path shows notice. | **Not tested live** | existing `openPathInVault` |

---

## Risk matrix

| Risk | Path | Status |
|---|---|---|
| Happy: Process → land → Done | primary | Unit + code; no vault |
| Negative: 0 atoms land copy | negative | Unit `formatLandBody` markers |
| Edge: 12 atoms moreCount | edge | Unit |
| Soft People connected | negative | Unit |
| Wait + Done two heroes | regression | **Holed → fixed** (suppress wait under landPeak) |
| Update strip under Done | regression | **Holed → fixed** |
| Preview leaving stale landPeak | weird sequence | Mitigated: `beginRun` clears landPeak |
| Bridge openLinkText ambiguity | edge | Suspected unproven |
| Auto-run home closed | happy | Code: Notice + refresh only |

---

## Evidence (automated)

```text
npx vitest run  → 249 passed (full suite earlier)
npx vitest run test/landPeak.test.ts test/resurface.test.ts → 35 passed
npx tsc -noEmit -skipLibCheck → clean
```

No screenshots (live Obsidian not driven).

---

## Adversarial ledger

| Scenario | Tag | Notes |
|---|---|---|
| Edit land titles (N/A — not editable) | solid | Read-only list |
| Dismiss then resurface | solid (code) | `dismissLandPeak` |
| Open landed title | solid (code) | Clears peak then vault open |
| Double Process | solid (code) | `beginRun` clears peak |
| Wait card under Done | **holed → fixed** | Suppressed when `landPeak` |
| Update strip under Done | **holed → fixed** | Same |
| People-only related | solid (unit) | Empty connected |
| Re-share / offline Process | blocked | No live vault |
| Bridge wrong note | suspected | `openLinkText` by title |
| Partial batch still has queue | solid after fix | Wait hidden until dismiss |

**Proven holes fixed this pass:** dual-hero wait/Update under land peak.

**Suspected unproven:** bridge title resolution; phone Sync lag after install.

---

## Human checklist (required for Ready)

Vault: **demo/test only** (not Remote personal data).

1. [ ] Build + install plugin to throwaway vault; confirm Settings version **0.6.14**
2. [ ] Seed past unprocessed; Process → screenshot land card + library (no resurface under Done)
3. [ ] If queue remains, confirm Ready wait card **hidden** until Done
4. [ ] Tap a landed title → note opens; peak gone
5. [ ] Process again → Done → tap Done → calm; connected kicker not “Related to something recent”
6. [ ] Update notes path if eligible → “Updated N” land card
7. [ ] Optional: auto-run with home open
8. [ ] Drop screenshots in `docs/qa/screenshots/land-then-remember/` and link in PR #72

---

## Findings

| Sev | Finding | Disposition |
|---|---|---|
| P1 | Wait card + Update strip could share screen with land peak (two heroes) | **Fixed** in this QA pass |
| P2 | No live vault evidence on agent host | Checklist handoff |
| P3 | Nav map still said “For you” | **Updated** |

---

## Not tested

- Live Obsidian UI / phone
- Auto-run land peak with home open
- Visual parity vs mock (side-by-side)
- Adversarial live double-tap / Sync race

---

## Merge decision

| Claim | Decision |
|---|---|
| Unit + typecheck | ✅ |
| Product dual-hero hole | ✅ fixed |
| World-class merge-ready | ❌ until human vault checklist + screenshots |

**Recommendation:** Keep PR #72 draft until checklist complete. After screenshots + green human pass → mark ready / merge.
