# World-class QA — Person hub invite (0.6.29)

**Date:** 2026-07-23  
**PR:** #110  
**Plan:** `docs/plans/2026-07-23-001-feat-person-hub-invite-plan.md`  
**Verdict:** **Ready with residual** — live CLI dogfood on test vault proves Add {Name}? + create + upgrade + rank-to-next; unit/build green. Residual: phone/Sync not driven; packing Make co-presence not re-shot this pass; adversarial chaos (double-tap Add, offline create) not exhausted.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ `docs/qa/README.md` |
| Authority | ✅ plan Product Contract R1–R22 + mock |
| Dev | ✅ `./scripts/install-to-vault.sh` → test vault |
| Auth | N/A |
| Fixtures | Real loop: hand-authored generated atoms (Mom/Dom) → home invite — **not** planted hubs for green Also about |

## Product vs fixture

**Real product loop:** seeded two *generated* atoms (capture bodies about Mom / Dom, soft People links, no Mom/Dom hubs) → reload plugin → open Atoms home → observed invite → **Add Mom** via view API → verified file + link-prose.

Not fixture theater: no pre-created Mom hub; invite and create were the product.

## Core stories

| Story | Result | Evidence |
|---|---|---|
| High-confidence Mom miss → Add Mom? | **Pass** | CLI eval `person:{"name":"Mom","n":1}` after reload |
| Add Mom → note under Social/People family | **Pass** | `momPath:"Personal notes/Social/Mom.md"` |
| Upgrade atom soft People → hard Mom | **Pass** | `atomHasMom:true, atomHasPeople:false` |
| After accept, next miss Dom surfaces | **Pass** | `inviteAfter.displayName:"Dom"` then home `person:"Dom"` |
| Version identifiable | **Pass** | `version:"0.6.29"` |
| Units | **Pass** | 344 tests green; build green |

## Negative / edge (partial)

| Case | Result |
|---|---|
| CRG as person invite from title alone | Unit tests deny CRG name |
| Media recommender Christian | Unit null name |
| Soft People not orbit shelf | Orbit unit: peer atom titles excluded |

## Screenshots

| Shot | Path |
|---|---|
| Home with Dom invite after Mom accept | `docs/qa/screenshots/person-hub-invite/01-add-dom.png` |

## Adversarial (light)

| Attack | Result |
|---|---|
| Double-tap Add / busy flag | Code has `personInviteBusy`; not live double-tapped this pass |
| Agent vault lane | Test vault only — no Remote Vault writes |
| Silent create on Process alone | Not exercised live; create only on Add path |

## Residuals

1. iOS/Android Sync dogfood human  
2. Full packing Make vs person stack screenshot when both qualify  
3. Pre-hub peer prose on Process still optional (upgrade-on-Add covers graph)

## Commands

```text
./scripts/install-to-vault.sh
obsidian vault="test vault" plugin:reload id=atoms
obsidian vault="test vault" eval … personInvite / onAddPersonNote
npm test  # 344
npm run build
```
