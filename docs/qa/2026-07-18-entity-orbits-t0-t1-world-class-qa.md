# World-Class QA: entity-orbits-t0-t1

**Branch:** `feat/entity-orbits-t0-t1` · **PR:** #94 · **Issue:** #93 · **Version:** 0.6.24  
**Date:** 2026-07-18  
**Mode:** Full automation (unit + Obsidian CLI live drive on throwaway vault)

## Verdict

**Ready with honest residual** — UI proven when hub exists; real-user no-seed pass shows Also about stays silent (expected). Prior seeded frames are UI-only evidence, not day-one product proof.; craft acceptable; adversarial minMembers + soft silence solid. Residual: phone/Sync not driven; human dogfood optional. No P0/P1 product holes.

## Charter

Entity orbits T0+T1: piggyback hard entity links on classify; soft-key denylist for orbits + connected; library opens atoms in-home; **Also about {entity} · N** sibling title list when ≥3 atoms hard-link an existing hub. Adjacent risk: connected resurface soft hubs, library open behavior change (vault → in-home).

## Preflight

| Item | Status |
|---|---|
| Run command | ✅ `npm test` · `npm run build` · `./scripts/install-to-vault.sh` · `obsidian vault="test vault" …` |
| Fixture | ✅ Seeded Orbit* atoms + `Yosemite packing.md` + `Camping.md` in `test_vault/test vault/` (gitignored vault) |
| Navigation map | ✅ `docs/qa/app-navigation-map.md` (updated this pass) |
| Viewport/device | ✅ Desktop Obsidian CLI screenshots (phone residual) |
| Auth path | ✅ N/A for orbit UI (no classify spend required for open path) |
| Automation | ✅ vitest · Obsidian CLI eval + `dev:screenshot` |

## User intent

- **Goal:** See multi-night related atoms as one set without merging bodies.
- **Questions UI answers:** “What else is about Yosemite packing?” / “Is this just Camping noise?”
- **Confidence:** Cyan Also about strip + title list with body-separate note.
- **Distrust:** Fake packing shelf from soft Camping; strip when only 2 members.

## User Stories Tested

### Primary

1. **As a user with 3 atoms hard-linked to Yosemite packing, I open one from library so I see Also about.**  
   Acceptance: strip `Also about Yosemite packing · 2`; in-home open.  
   Evidence: CLI eval `also:"Also about Yosemite packing · 2"` · `01-also-about-atom-open.png`  
   Status: **Passed**

2. **As a user, I open the sibling list and tap a peer.**  
   Acceptance: list shows 2 titles; peer opens in-home with Also about still available.  
   Evidence: `02-sibling-list.png` · eval peer open → strip still present  
   Status: **Passed**

### Negative / edge

3. **Soft Camping-only atoms never show Also about.**  
   Acceptance: open soft-only atom → `alsoAbout: null`.  
   Evidence: eval + `03-soft-only-no-strip.png`  
   Status: **Passed**

4. **Dropping below minMembers=3 hides strip.**  
   Acceptance: delete one of three → open remaining → also null; restore → strip returns.  
   Evidence: CLI eval after delete `also:null`; after restore strip back  
   Status: **Passed**

5. **Capture-body wikilink is not membership** (unit).  
   Evidence: `test/entityOrbitIndex.test.ts`  
   Status: **Passed**

6. **Person-only orbit suppresses Also about** (unit).  
   Evidence: `test/entityOrbitIndex.test.ts` personHubTitles  
   Status: **Passed**

### Regression

7. **Connected does not form Camping-only kinship** (unit).  
   Evidence: `test/resurface.test.ts` Camping-only share  
   Status: **Passed**

8. **Library still lists orbit atoms.**  
   Evidence: `04-home-library.png`  
   Status: **Passed**

### Perception / craft

9. **Also about strip is readable and tappable-looking.**  
   Evidence: craft read of `01-also-about-atom-open.png` — cyan label, 16px card, ≥44px height feel, spacing under title OK.  
   Status: **Passed**

10. **Sibling list hierarchy clear.**  
    Evidence: `02-sibling-list.png` — title, meta line, two rows, no clip.  
    Status: **Passed**

### Accessibility

11. Strip has `role=button` + Enter/Space (code). Full a11y audit not run.  
    Status: **Partial** (code path present; not VoiceOver-tested)

## Risk Matrix

| Class | Check | Result |
|---|---|---|
| Happy | 3-member hard hub → Also about + list + peer | Pass live |
| Negative | Soft Camping only | Pass live |
| Edge | minMembers after delete | Pass live |
| Edge | Missing hub / daily basename / junk reason | Pass unit |
| Regression | Connected soft expand | Pass unit |
| Perception | Strip copy / sibling meta | Pass craft |
| Craft §5b | Decisive frames read | Pass |

### §4a New targets

| Surface | Expected | Evidence |
|---|---|---|
| Also about strip | Open sibling list | Live + 01 |
| Sibling list rows | Open peer atom in-home | Live + 02 |
| Library row | openAtomInHome (not vault only) | Live |
| Soft silence | No strip | Live + 03 |
| enrichEntityLinks | Exact title only | Unit |

## Evidence

### Commands

```text
npm test                          # 310 passed
npm run build
./scripts/install-to-vault.sh     # Atoms v0.6.24 → test vault
obsidian vault="test vault" plugin:reload id=atoms
obsidian vault="test vault" command id=atoms:open-home
obsidian vault="test vault" eval … openAtomInHome …
obsidian vault="test vault" dev:screenshot path=…/entity-orbits/….png
```

### Screenshots

| Frame | Path |
|---|---|
| Atom open + Also about | `docs/qa/screenshots/entity-orbits/01-also-about-atom-open.png` |
| Sibling list | `docs/qa/screenshots/entity-orbits/02-sibling-list.png` |
| Soft-only (no strip) | `docs/qa/screenshots/entity-orbits/03-soft-only-no-strip.png` |
| Home library | `docs/qa/screenshots/entity-orbits/04-home-library.png` |

### Live CLI transcript (redacted)

```json
{"ok":true,"homeOpen":true,"kind":"atom","also":"Also about Yosemite packing · 2"}
{"ok":true,"n":2,"label":"Yosemite packing"}
{"ok":true,"also":null}   // soft-only
{"also":null,"kind":"atom"} // after delete one of three
{"restored":true,"strip":"Also about Yosemite packing · 2","n":2}
{"peer":"Orbit hiking pants board games","also":"Also about Yosemite packing · 2"}
```

### Fixtures

Throwaway vault only: `Yosemite packing.md`, `Camping.md`, `Atoms/Orbit *.md` (not committed; vault gitignored).

## Findings

| Sev | Finding | Action |
|---|---|---|
| P3 | Sibling meta “linked over several nights” is generic (seeded same week) | Accept — product voice, not accuracy bug |
| P3 | Library no longer opens vault editor first (in-home only; Open in vault on detail) | By design (KTD7); note for power users |
| — | No P0/P1 craft or behavior defects | — |

## Adversarial QA

| Scenario | Result |
|---|---|
| Delete member → below min 3 → strip gone | **solid** (live) |
| Restore member → strip returns | **solid** (live) |
| Soft Camping ×3 → no strip | **solid** (live) |
| Soft Camping connected kinship | **solid** (unit) |
| Open peer from list → still Also about | **solid** (live) |
| Body-only `[[Camping]]` membership | **solid** (unit) |
| Missing hub / daily key | **solid** (unit) |
| Japan contains-match invent | **solid** (unit) |
| Person-only suppress | **solid** (unit) |
| Offline / Sync phone | **blocked:** phone not in this pass |
| Hub rename mid-session | **suspected-unproven:** living graph; no live rename drive |
| Double-tap strip | **solid** enough (idempotent list open) |

**Proven holes:** none requiring code fix.  
**Fixes applied:** none.  
**Deferred:** phone Sync dogfood (human).

## Not Tested

- iOS Obsidian / Remote Vault Sync  
- Live classify API path for enrichEntityLinks (unit + fixture only; no Anthropic spend)  
- Hub-note open (non-atom) sibling list — out of claim (KTD12)  
- Home Together push card (T2 out of scope)  
- VoiceOver / full a11y  

## Mobile viewport (desktop Obsidian resized)

Window forced to **390×844** (iPhone-ish). Live Also about still `Also about Yosemite packing · 6` after real API Process.

| Frame | Path | Craft |
|---|---|---|
| Also about | `docs/qa/screenshots/entity-orbits/06-mobile-also-about.png` | Pass — strip full-width, ≥44px feel, no clip |
| Sibling list | `docs/qa/screenshots/entity-orbits/07-mobile-sibling-list.png` | Pass — 6 rows readable, hierarchy OK |
| Library | `docs/qa/screenshots/entity-orbits/08-mobile-library.png` | Pass — rows stack cleanly |
| Live API atom | `docs/qa/screenshots/entity-orbits/05-live-api-also-about.png` | Pass — real classify → hub link → Also about |

**Not a real iOS device** — desktop window resize only. Phone Sync residual remains.


## Real-user pass (no seeding) — 2026-07-18 redo

**Method change:** deleted all agent-seeded hubs/orbit atoms. Captured only raw daily bullets over three days, then **Process** + **force Process today**. No `Yosemite packing` note created.

### Captures (user-shaped)

| Day | Bullet | Result |
|---|---|---|
| 2026-07-16 | pack bug spray and a hat for the camping trip | **noise** (`<!--linker:noise-->`) |
| 2026-07-17 | need hiking pants and board games for the trip | **atom** `Need hiking pants and board games for trip` · no external hub link |
| 2026-07-18 (force today) | also pack trail mix and a headlamp | **atom** `Also pack trail mix and a headlamp for trip` · links **to prior packing atom** as same trip list |

### Also about

Both real packing atoms: **`alsoAbout: null`**.

Why (by design): need ≥3 generated atoms hard-linking one **existing vault hub title**. Here: only 2 atoms, no user-created packing hub, first capture retired as noise.

### Evidence

- `docs/qa/screenshots/entity-orbits/10-real-user-atom-open.png`
- `docs/qa/screenshots/entity-orbits/11-real-user-library.png`
- Live atom body: trail mix → `[[Need hiking pants and board games for trip]]`

### Verdict impact

Prior seeded QA proved the **Also about UI** when a hub already exists.  
This pass proves **day-one product truth**: packing alone does not invent a hub or light Also about. That is correct constitution (no invent stubs) and a **product gap** if users expect a packing shelf without ever creating a hub note.

**Agent rule going forward:** dogfood = capture → Process only. Never seed hubs/atoms to force a green Also about screenshot.

## Merge Decision

**Approve merge** of #94 for desktop/agent quality bar with residual phone dogfood optional.

PR body must link absolute screenshot URLs and check Test plan boxes after push.

## Craft §5b

Decisive frames `01` and `02` read on main thread: spacing and hierarchy acceptable; no clip; strip cyan intentional; no purple fills. **Craft: Passed.**
