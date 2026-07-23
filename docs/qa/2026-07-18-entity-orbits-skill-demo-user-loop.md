# World-Class QA: entity-orbits skill demo (user-loop only)

**Date:** 2026-07-18  
**Branch:** `feat/entity-orbits-t0-t1`  
**Skill:** `world-class-qa` with Product dogfood honesty ensure + hard gate **Fixture theater**

## Verdict

**Honest product outcome — not Ready as “Also about works on day one packing.”**  
Ready only as proof that: (1) skill dogfood gate runs, (2) real capture→Process path works, (3) packing without a hub often yields **noise** and **no Also about**. That is correct product silence, not a failed install.

## Charter

Re-run entity-orbits verification **from scratch** after wipe: no seeded hubs, no planted atoms, no pre-linked graphs. Proof kind for product stories: **`user-loop` only**.

## Preflight (skill)

| Check | Result |
|---|---|
| Adapter 5 files | ✅ all present |
| **Product dogfood honesty** | ✅ present in `docs/qa/README.md` (no append needed) |
| Product proof vs fixture | ✅ `testing-fixtures.md` |
| AGENTS.md pointer | ✅ |
| Dev/run | ✅ `npm run build` · `./scripts/install-to-vault.sh` · Obsidian CLI |
| Auth (classify) | ✅ test vault key present (len 108) |
| Emulator | ✅ `emulator-5554` wiped (`pm clear` + vault wipe) |
| Remote Vault | ✅ not touched |

## Product loop vs fixture

| Primary story | Proof kind | Result |
|---|---|---|
| Capture packing bullets → Process → observe | **user-loop** | Ran |
| Also about appears after packing captures alone | **user-loop** | **Did not appear** (honest) |
| Emulator clean vault + Atoms 0.6.24 install | **user-loop** (install path) | Ran |
| Plant Yosemite hub + 3 linked atoms for green shot | **fixture theater** | **Not used** (wiped + forbidden) |

## User-loop steps (desktop test vault)

1. **Wipe** prior agent packing atoms/hubs and packing lines on dailies.  
2. **Capture only** (no hubs/atoms created by hand):
   - `2026-07-16`: pack bug spray and a hat for the camping trip  
   - `2026-07-17`: need hiking pants and board games for the trip  
   - `2026-07-18`: also pack trail mix and a headlamp  
3. **Pre-check:** zero packing atoms, zero packing hubs.  
4. **Process** past → both Jul 16–17 → **`noise`**.  
5. **Force Process today** → Jul 18 → **`noise`**.  
6. **Observe:** no packing atoms; Also about N/A; markers `<!--linker:noise-->` on all three.

### Live classify transcript (redacted)

```json
// past Process
{"scanned":2,"created":0,"markers":1,"entries":[
  {"cap":"pack bug spray and a hat for the camping trip","verdict":"noise"},
  {"cap":"need hiking pants and board games for the trip","verdict":"noise"}
]}
// force today
{"scanned":1,"created":0,"markers":1,"entries":[
  {"cap":"also pack trail mix and a headlamp","verdict":"noise"}
]}
```

## Emulator (from scratch)

1. `pm clear md.obsidian` + delete `/sdcard/Documents/AtomsMobileQA`  
2. Push **clean** vault: plugin files + empty Daily stubs + Welcome only — **no hubs, no Atoms content**  
3. First-run: open folder → trust plugins → Atoms **0.6.24** installed  

Screenshots: `13-emu-fresh-launch.png` … `21-emu-reopen.png`  
**Not tested on emulator:** live Anthropic Process (no key on emulator this pass).

## Evidence

| Asset | Path |
|---|---|
| Library after user-loop (desktop) | `docs/qa/screenshots/entity-orbits/12-skill-demo-library-after-user-loop.png` |
| Emulator fresh launch | `docs/qa/screenshots/entity-orbits/13-emu-fresh-launch.png` |
| Emulator vault picker | `docs/qa/screenshots/entity-orbits/14-emu-picker.png` |
| Emulator trust | `docs/qa/screenshots/entity-orbits/15-emu-trust.png` |
| Emulator vault open / plugins | `docs/qa/screenshots/entity-orbits/16-emu-vault-open.png` |

## Findings

| Sev | Finding |
|---|---|
| Product | Three packing-style captures all **noise** under current classify — no atoms, no Also about. Day-one packing shelf does **not** appear without keepable atoms + existing hub. |
| Process | Skill dogfood gate prevented fixture theater this run. |
| Residual | Emulator Process needs device key; phone Sync not run. |

## Adversarial (light)

| Scenario | Result |
|---|---|
| Temptation to re-seed Yosemite hub for green Also about | **Rejected** (skill gate) |
| All-noise packing week | **solid** — product stays quiet |

## Merge decision (this demo pass)

Does **not** upgrade Also about to “works for packing day one.”  
Supports: skill enforcement + honest user-loop evidence. Feature PR #94 remains UI-correct when hubs exist (prior labeled plumbing) and silent when they don’t (this pass).
