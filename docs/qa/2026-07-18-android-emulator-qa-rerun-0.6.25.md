# World-Class QA: Android emulator re-run (0.6.25 build)

**Date:** 2026-07-18  
**Surface:** Android emulator only (`emulator-5554`)  
**Fixture:** `AtomsMobileQA` at `/sdcard/Documents/AtomsMobileQA` — **reused**, plugin files updated in place (no `pm clear`, no vault recreate)  
**Build:** Atoms **0.6.25** (`main.js` + `styles.css` spacing fix)

## Preflight

| Check | Result |
|---|---|
| Adapter files | ✅ |
| Product dogfood honesty | ✅ |
| AtomsMobileQA in testing-fixtures | ✅ |
| Emulator up | ✅ |
| Plugin push in place | ✅ 0.6.25 |
| Remote Vault | ✅ not touched |

## Charter

Re-verify entity-orbits UI on mobile after spacing fix: Together card, Capture shortcut adjacency, Also about, sibling list.

**Proof kind:** Fixture vault state already had hub + 3 atoms from prior Create (UI chrome / regression). Not a fresh capture→Process loop this pass.

**expected_stack (home):**
1. Together card  
2. Capture shortcut banner  
3. LIBRARY + filters  
4. Library list  

## Stories

| Story | Status | Evidence |
|---|---|---|
| Home opens Atoms leaf | Passed | UI title `Atoms - Obsidian` |
| Together shows Yosemite Packing · 3 notes | Passed | dump + `50-qa-home.png` |
| Capture shortcut still visible under Together | Passed | combo frame |
| **Together ↔ Capture shortcut gap** | **Passed (craft)** | Clear separation post-CSS fix; CTAs not collided |
| Open → Also about · 2 | Passed | `51-qa-atom-also-about.png` |
| Also about → sibling list | Passed | `52-qa-sibling-list.png` |
| Fresh Make invite (no hub) | Not tested this pass | Hub already exists from prior Create |

## Craft (§5b + stacked chrome)

**Frame:** `50-qa-home.png` (combo: Together + Capture shortcut + LIBRARY)

| Check | Result |
|---|---|
| Breathing room (Together card) | Pass |
| **Adjacency Together ↔ Capture shortcut** | **Pass** — visible gap; banner no longer flush under Open/Not now |
| Adjacency banner ↔ LIBRARY | Pass |
| Stack density (peek list) | Pass |
| Tap targets Open/Not now/Install | Pass (~row height) |
| Clip/overflow | Pass |

**Craft verdict: PASS** (adjacency checked: Together↔shortcut, shortcut↔LIBRARY)

## Evidence paths

- `docs/qa/screenshots/entity-orbits-mobile/50-qa-home.png`  
- `docs/qa/screenshots/entity-orbits-mobile/51-qa-atom-also-about.png`  
- `docs/qa/screenshots/entity-orbits-mobile/52-qa-sibling-list.png`  

## Findings

| Sev | Finding | Action |
|---|---|---|
| — | Prior flush gap fixed | Confirmed on device |
| P3 | “2 notes · linked over several nights” copy is generic | Accept |
| Residual | Invite path not re-hit (hub already present) | Optional: delete hub on fixture once to re-test Make? |

## Adversarial (light)

| Scenario | Result |
|---|---|
| Reload plugin in place without wipe | solid |
| Stacked chrome still readable after fix | solid |

## Verdict

**Ready for mobile UI of 0.6.25** on emulator fixture: Together + spacing + Also about + siblings.  

Not claimed: end-to-end Process on emulator (no key on device this pass).
