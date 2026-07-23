# World-Class QA: Entity orbits 0.6.26 (Together Open → list)

Date: 2026-07-18  
Branch: `feat/entity-orbits-t0-t1`  
Plugin: **0.6.26** · Vault: `test_vault/test vault` (agent dogfood)

## Verdict

**Ready for desktop agent bar on 0.6.26 Open contract** — Together **Open** delivers in-home title list of **all 3** members (R14 + “see them all”), not one sample atom. Also about path still works. Craft on combo home frame OK. Residual: Ready land-peak still visible above sibling-list open; phone not re-driven; PR body still says 0.6.25 until updated.

## Charter

- **Change:** Together Open wired to `entity-siblings` (full members); back → home when `backPath` null; version 0.6.26.
- **Workflows:** Together card → Open → full list → peer atom → Also about; Create invite path (partial this pass).
- **Risks:** regression to samplePath open; list count = others-only; craft collision with Capture shortcut / Ready peak.
- **Platform:** Desktop Obsidian 1.12.7 + CLI on test vault.
- **Product loop vs fixture:** Mixed — third packing capture + Process was **user-loop**; hub Create via invite; 2 prior packing atoms from earlier sessions (labeled).
- **Authority paths:** `docs/plans/2026-07-17-006-spec-entity-orbits-product-contract.md` (R13–R14); on-screen “N notes. Open to see them all.”

## Preflight

| Item | Status |
|---|---|
| Product dogfood honesty | ✅ |
| Authority paths | ✅ contract R14 + copy |
| Navigation map | ✅ |
| Dev/run | ✅ `./scripts/install-to-vault.sh` · CLI |
| Viewport | Desktop (mobile residual) |
| Auth / API key | ✅ test vault has key |
| Fixtures | Reuse test vault (no wipe) |
| Automation | Obsidian CLI ✅ · phone ❌ this pass |

## Authority & promises

Paths read:

- `docs/plans/2026-07-17-006-spec-entity-orbits-product-contract.md` R13–R14  
- Live copy on Together card: `3 notes. Open to see them all.`

| Surface / CTA | Promise (rule id or on-screen copy) | Acceptance (observable destination) | Story id | Result |
|---|---|---|---|---|
| Together **Open** | R14 + “Open to see them all” | in-home title list, **all** orbit members | US-open-set | **Passed** |
| Sibling row tap | opens that atom in-home | `kind: atom` + Also about when eligible | US-peer | **Passed** |
| Also about strip | R13 | title list of **others** (N−1) | US-also | **Passed** |
| Back from Together list | backPath null → home | `homeOpen` null, Together still available | US-back | **Passed** |
| Capture shortcut under Together | craft adjacency | visible gap, not flush under CTAs | US-craft | **Passed** |

Spec vs copy conflicts: _none_

## Product loop vs fixture

| Primary story | Proof kind | Notes |
|---|---|---|
| Third packing capture → Process → atom linked to hub | **user-loop** | `pack headlamp…` on 2026-07-15 |
| Hub Create from Make invite | **user-loop** (CLI invoke Create) | 2 members → hub; then 3rd via Process |
| Together Open → list | **ui-chrome** on live orbit after above | Not fixture-planted graph |

## User Stories

1. **As a user on Together · Yosemite Packing, I Open to see all notes.**  
   Acceptance: `entity-siblings`, label Yosemite Packing, **3** titles (not 1 atom).  
   Authority: R14 + “see them all”.  
   Evidence: CLI `n:3` + `01-together-open-sibling-list.png`  
   Status: **Passed**

2. **As a user who taps a list row, I open that atom in-home with Also about.**  
   Acceptance: Also about Yosemite Packing · 2.  
   Evidence: CLI + `02-atom-also-about.png`  
   Status: **Passed**

3. **As a user on Also about strip, I get the other members list.**  
   Acceptance: siblings length 2, backPath = current atom.  
   Evidence: CLI + `03-also-about-sibling-list.png`  
   Status: **Passed**

4. **Back from Together list returns home (not a missing atom).**  
   Acceptance: closeHomeOpen → homeOpen null.  
   Evidence: CLI  
   Status: **Passed**

5. **Craft: Together above Capture shortcut.**  
   Acceptance: combo frame gap; CTAs not collided.  
   Evidence: craft read `00-together-home-card.png`  
   Status: **Passed**

6. **Fresh desktop Make invite from zero atoms**  
   Status: **Not tested** this pass (hub already created mid-session)

## Risk Matrix

| Type | Scenario | Expected | Evidence | Result |
|---|---|---|---|---|
| Promise | Open → full set | 3 titles | 01 + CLI | Pass |
| Happy | Peer + Also about | strip · 2 | 02 | Pass |
| Edge | Back from list | home | CLI | Pass |
| Regression | Also about others-only | n=2 not 3 | 03 | Pass |
| Craft | Together ↔ shortcut | gap | 00 | Pass |
| Craft | Ready peak over list open | ideally hidden | 01 | **Residual** (see findings) |
| Negative | Soft-only shelf | silent | prior QA | Not re-run |

## Evidence

### Commands

```bash
./scripts/install-to-vault.sh   # 0.6.26
npm test                        # 317 passed
obsidian command id=atoms:open-home
# Create hub via invite; append packing bullet; process-unprocessed
# eval: Together Open → entity-siblings n=3
obsidian vault="test vault" dev:screenshot path=…/entity-orbits-0.6.26/…
```

### Screenshots

| Frame | Path |
|---|---|
| Together + Capture shortcut | `docs/qa/screenshots/entity-orbits-0.6.26/00-together-home-card.png` |
| Open → full title list | `docs/qa/screenshots/entity-orbits-0.6.26/01-together-open-sibling-list.png` |
| Atom + Also about | `docs/qa/screenshots/entity-orbits-0.6.26/02-atom-also-about.png` |
| Also about sibling list | `docs/qa/screenshots/entity-orbits-0.6.26/03-also-about-sibling-list.png` |

### Craft (§5b)

- **00:** Breathing room OK; Together CTAs clear; Capture shortcut separated; hierarchy intentional. **Adjacency checked:** Together ↔ Capture shortcut → Pass.  
- **01:** List readable; **Ready** land-peak still stacked above sibling open (session leftover after Process) — functional OK, craft/UX residual.  
- **02:** Also about strip full-width cyan, tappable feel.

### Devices

- Desktop Obsidian test vault ✅  
- Phone / emulator this pass ❌  

## Findings

### Blocking

- None for Open contract on desktop.

### Polish

1. **P2 — Ready peak remains visible while sibling list is open** (`01-…`). After Process, land peak + open detail stack. Prefer freeze/hide growth+peak when `homeOpen` is set. Not a promise mismatch.  
2. **P3 — PR body still titles 0.6.25** and Core stories omit Open→list; update before mark-ready.

## Adversarial

| Scenario | Result |
|---|---|
| Double-open sibling list | **solid** — still 3 members |
| Peer open → close → Together returns | **solid** |
| Not now clears card; reload restores | **solid** |
| Promise lie: Open opens one atom | **solid** (fixed — list) |
| Full set vs others-only on Together Open | **solid** (n=3) |
| Delete hub mid-session | **blocked** — not driven |
| Peer Back loses list (goes home not list) | **known** — same as Also about path; suspected UX debt |
| Double Create hub | **not tested** |

**Proven holes:** none new.  
**Suspected-unproven:** Back from peer does not restore sibling list (pre-existing pattern).

## Not Tested

- Phone Sync / physical device  
- Emulator 0.6.26  
- Fresh zero-state Make invite on desktop only  
- Soft Camping silence (prior pass)

## Merge Decision

**Approve desktop quality for 0.6.26 Open fix** with residuals above. Update PR body to 0.6.26 + link this report + check Open story. Phone optional residual. Mark-ready when PR text matches evidence.

### Skill note (meta)

This pass used **spec-sourced promise table** (R14 + copy) before exercise. Old bug (Open → sample atom) would have **Failed** gate 25 against the same table.
