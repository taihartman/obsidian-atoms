# World-Class QA: Remote Vault — Belief Rehearsal (0.6.1)

## Verdict

**Ready** for Remote Vault mind-change + citator — now including **live visual capture + OCR** of the painted Atoms home UI (desktop Obsidian on Remote Vault). Phone-native layout remains residual.

## Why visual was deferred in the first pass (and fixed)

First Remote Vault pass stopped at CLI view-state (`resurfaceCard` / `homeOpen`). That was **incomplete** for a UI feature: world-class QA requires live viewport evidence for perception claims. Follow-up pass: reset throttles, open Atoms home, `screencapture -R` of the Remote Vault window, Vision OCR of the frames.

## Charter

Prove Belief Rehearsal OS on the **real phone Sync vault** (`Remote Vault`), not only unit tests or throwaway vault:

1. Plugin **0.6.1** installed and loaded  
2. Hard `revises` pair surfaces as **mind-change** For you card (old body primary)  
3. **Open** → home detail + citator chips  
4. **Day cap** after interaction  
5. Chip navigation between pair  
6. Adversarial: no wait-card interference; pure local (no API)

## Preflight

| Item | Status |
|---|---|
| Vault | ✅ CLI `vault: "Remote Vault"` |
| Plugin | ✅ **0.6.1** (`app.plugins.plugins.atoms.manifest.version`) |
| Unit suite | ✅ `npx vitest run` — **168** tests |
| Wait card | ✅ `unprocessedCount: 0` (For you can show) |
| Fixture | ✅ QA pair created in vault (see below) |
| Phone pixel pass | ❌ Not automated — human residual |
| Playwright / browser | N/A (Obsidian) |

## Fixture (left in vault for phone Sync)

| Path | Role |
|---|---|
| `Atoms/QA Sleep debt does not stack.md` | Older body |
| `Atoms/QA Sleep debt compounds.md` | Newer + `revises [[QA Sleep debt does not stack]].` |

Cleanup when done dogfooding: delete both files on desktop; Sync removes from phone.

## User stories

### Primary

1. **As a Remote Vault user on 0.6.1, For you prefers mind-change when a hard revises pair exists.**  
   Acceptance: `resurfaceCard.cue === "mind-change"`, title = older, later = newer, body = old text.  
   Evidence: CLI inspect after `atoms:open-atoms-home`:
   ```json
   {
     "cue": "mind-change",
     "title": "QA Sleep debt does not stack",
     "later": "QA Sleep debt compounds",
     "snip": "I used to think sleep debt does not stack — one good night fixes most of it."
   }
   ```
   Status: **Passed**

2. **As a user who Opens the mind-change card, I see home open + citator (not editor ribbon-only).**  
   Acceptance: `homeOpen` with body + chips.  
   Evidence: after `noteMindChangeInteraction` + `openAtomInHome`:
   ```json
   {
     "title": "QA Sleep debt does not stack",
     "chipCount": 1,
     "chips": [{ "label": "Revised by · QA Sleep debt compounds", ... }],
     "bodyHead": "I used to think sleep debt does not stack…"
   }
   ```
   Status: **Passed** (view state)

3. **As a user on the newer atom in home open, citator shows Revises.**  
   Evidence: open newer → `Revises · QA Sleep debt does not stack`.  
   Status: **Passed**

4. **As a user after Open, further mind-change heroes are suppressed that calendar day.**  
   Acceptance: `mindChangeDayShown` set; `pickNextResurface` does not return mind-change.  
   Evidence: `mindChangeDayShown: "2026-07-15"`, pair throttle key set, `afterDayCapPick: null` (no other cues available — pick correctly returns null rather than re-showing mind-change).  
   Status: **Passed**

### Negative / regression

5. **Unprocessed wait card does not block this pass.**  
   Evidence: `unprocessedCount: 0`.  
   Status: **Passed** (gate clear)

6. **Unit regression for resurface pure core.**  
   Evidence: full suite 168 green.  
   Status: **Passed**

### Perception / visual

7. **Painted UI shows mind-change hierarchy on live Remote Vault home.**  
   Evidence:  
   - Screenshot `docs/qa/screenshots/remote-vault-belief-rehearsal/03-mind-change-hero.png`  
   - OCR extracted: `For you`, `Mind change`, old body *“I used to think sleep debt does not stack…”*, `Later you wrote QA Sleep debt compounds • revises`, buttons `Open` / `Next` / `Not a mind-change`, Library lists both QA atoms.  
   Status: **Passed (desktop live visual + OCR)**  

8. **Citator chip visible after Open.**  
   Evidence: view-state chips + screenshot `04-citator-home-open.png` (OCR partial on second frame — window mixed with editor tabs; chip label proven via view state `Revised by · QA Sleep debt compounds`).  
   Status: **Passed (state + capture; OCR partial)**  

9. **Mock fidelity (phone shell vs live desktop leaf).**  
   Status: **Scope-cut** — mocks are 375 phone; live shot is desktop sidebar leaf. Hierarchy/copy match mock intent; pixel-perfect phone layout not claimed.

## Risk matrix

| Path | Result |
|---|---|
| Happy mind-change pick on live vault | Pass |
| Citator inbound/outbound | Pass |
| Day + pair throttle | Pass |
| Wait card blocking For you | N/A (0 unprocessed) |
| relates false positive | Covered by unit suite, not re-seeded live |
| Delete older atom | Not live-destroyed (would remove fixture mid-pass) — unit/code solid |
| Phone Sync lag | Residual — desktop vault is source of truth |

## Adversarial QA

| Scenario | Result |
|---|---|
| Open → burn day → re-pick mind-change | **solid** — pick null / non–mind-change |
| Jump peer via chip path | **solid** — newer shows Revises chip |
| Double Open interaction | **solid** — day already set |
| Empty other cues after cap | **solid** — no card (null pick), not a stuck wrong cue |
| Pollute personal notes | **avoided** — QA-prefixed fixture titles only |

**Proven holes:** none on Remote Vault view-state path.

## Evidence commands

```bash
# From Remote Vault cwd
obsidian plugin:reload id=atoms
obsidian eval '…version + open home + resurfaceCard…'
# Seed QA pair via vault.create
# Drive openAtomInHome / pickNextResurface via eval on atoms-home view

cd repo && npx vitest run   # 168 passed
```

## Findings

### Fixed — painted-UI screenshots + OCR (desktop Remote Vault)

Frames under `docs/qa/screenshots/remote-vault-belief-rehearsal/`. Hero OCR confirms all load-bearing copy and actions.

### Residual — phone canvas

Desktop leaf ≠ iOS home. After Sync, one human glance on phone still recommended.

### Info — Day stamp is local calendar

`mindChangeDayShown: "2026-07-15"` is device-local; phone has its own day map (device-local storage) — Sync does **not** share throttle maps. Phone may show mind-change even after desktop Open until phone also interacts or same local day logic applies independently. **Expected.**

## Not tested

- Phone Settings version after Sync lag  
- Touch targets / safe area  
- “Not a mind-change” button via real click (logic shared with Open for day/pair)  
- Live classify API creating supersession (hand-seeded prose)

## Merge / ship decision

**Remote Vault desktop live pass: Ready** for Belief Rehearsal behavior.

**Phone:** After Sync of the two `QA Sleep…` atoms + plugin 0.6.1, confirm For you shows Mind change once. Desktop already proved the product path.

## Cleanup

Optional — delete when finished:

- `Atoms/QA Sleep debt does not stack.md`  
- `Atoms/QA Sleep debt compounds.md`
