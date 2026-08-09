# World-class QA — #372 sign-out teardown

- **Branch:** `fix/372-sign-out-teardown`
- **PR:** [#389](https://github.com/taihartman/obsidian-atoms/pull/389)
- **Worktree:** `/Users/a515138832/StudioProjects/obsidian_plugin-372-sign-out-teardown`
- **Version under test:** `0.6.90` (live Settings → Atoms)
- **Date:** 2026-08-09
- **Vault lane:** throwaway only — main checkout `test_vault/test vault`. No personal / Remote Vault.
- **App:** Obsidian 1.13.4, installer 1.12.7, CLI `/opt/homebrew/bin/obsidian`, phone width 390×844 (`is-phone` asserted).

## Verdict

**Ready after fixes** — one live hole found and fixed in this pass (disarm-before-network). Core stories pass with egress sentinel + positive control. Server-side account switch remains **Blocked** (plus-service not deployed). Follow-ups #393–#397 named, not in this claim.

## Charter

Sign out must disarm the Ask mirror and clear device-local baseline **before** the next Plus identity can inherit either. Adjacent risk: an in-flight sync restoring the baseline after teardown; a slow `signOutPlus` RTT leaving the gate open.

**Proof kind:** `fixture-plumbing` for Plus session + consent seed (device-local session against local stubs — same shape as #371/#374 QA). **Not** a real Stripe/Plus account switch. Product promise under test is the **Sign out** gesture and its local effects + egress silence.

**Authority:** `docs/plans/2026-08-09-001-fix-372-sign-out-teardown-plan.md` Verification contract · on-screen Sign out description.

## Preflight

| Check | Status |
|---|---|
| Product dogfood honesty | ✅ present in `docs/qa/README.md` |
| Authority paths | ✅ plan + row copy |
| Navigation map | ✅ Settings → Atoms → account destination |
| Dev/run | ✅ `npx tsc --noEmit`, `npx vitest run`, `./scripts/install-to-vault.sh` (manual copy into main test vault) |
| Viewport | ✅ 390×844, `is-phone` |
| Auth path | ✅ seeded device-local Plus session (not live magic-link) |
| Egress containment | ✅ refuse sentinel `:8787`, permissive stub `:8799`, slow stub `:8800` |
| plus-service deploy | ❌ not deployed → server-side switch **Blocked** |

## Authority & promises

| Surface / CTA | Promise | Acceptance | Story |
|---|---|---|---|
| Sign out row | "Remove the Plus session from this device, and turn the Ask mirror off on every device this vault syncs to." | Session cleared; `askEnabled=false` persisted; acks survive | S1 |
| Gate after sign-out | Plan: next account inherits neither arming nor baseline | `mirrorPermitted()===false`; hashes `{}`; email cleared | S2 |
| Egress silence | Plan: sentinel empty across switch **with** positive control | 0 lines while off; ≥1 attempt when re-armed | S3 |
| In-flight sync | Plan: pass cannot un-do teardown | hashes stay `{}` after settle; no *next* chunk after disarm | S4 |

## Core stories

### S0 — Version 0.6.90 — **PASS**

Live Settings prose: `Version 0.6.90 · Capture with your shortcut; Process turns past bullets into linked atoms.`

### S1 — Sign out disarms + clears device state, keeps acks — **PASS**

Pressed `settingTab.signOutOfPlus()` after seeding active session + armed mirror + baseline.

| Field | Before | After |
|---|---|---|
| `askEnabled` | true | **false** |
| hashes | `{"Atoms/x.md":"abc123"}` | **`{}`** |
| email / count / lastSuccess | set | **null/cleared** |
| session | A token | **null** |
| privacy ack at/version | set | **unchanged** (way back out) |
| Notice | — | `Atoms Plus signed out on this device` |

Sign out row description (live DOM):  
> Remove the Plus session from this device, and turn the Ask mirror off on every device this vault syncs to.

Screenshot: `docs/qa/screenshots/372-sign-out-teardown/01-sign-out-row.png`

### S2 — Next seeded identity cannot push while off — **PASS**

After S1, seeded `b@tryatoms.test` session with `askEnabled` still false.  
`sync({force:true})` → `{kind:"failed", message:"Ask mirror is off"}`.  
`mirrorPermitted() === false`.

### S3 — Egress silence + positive control — **PASS**

| Window | Sentinel log (`:8787`) |
|---|---|
| Silence (S2, Ask off) | **0 lines** |
| Positive control (re-arm + force sync) | `OPTIONS /v1/ask/mirror/upsert` (attempt observed) |

Empty silence alone is not evidence; the same session produced a logged attempt when the gate opened.

### S4 — In-flight sync cannot restore baseline — **PASS** (after fix)

**Hole found live (P0):** first run had `await signOutPlus` *before* `disarmAskMirror`. Slow stub held the revoke ~8s; during that RTT the mirror stayed permitted and a **second** upsert chunk left (`POST … bytes=23411` after the first 8s hold). Baseline stayed empty (guarded `save`), but bodies still left after Sign out.

**Fix:** disarm + clear session **first**, then best-effort `signOutPlus`. Regression: `disarms before the sign-out network call returns`.

**Re-drive after fix (slow stub `:8800`, 400-atom force sync):**

```
POST /v1/ask/mirror/upsert   ← only the chunk already in the air
POST /v1/auth/sign-out
(no second upsert)
```

Final: `askEnabled=false`, hashes `{}`, email null. Sync result: `Ask mirror is off`.

### S5 — After sign-out Settings chrome — **PASS**

Main Atoms tab returns to signed-out Plus setup row. Acks still on disk (`ackAt` preserved).  
Screenshot: `docs/qa/screenshots/372-sign-out-teardown/02-after-sign-out.png`

### Craft (§5b) — **PASS**

Decisive frame `01-sign-out-row.png`: Sign out row + description readable; spacing not collapsed; destructive control clear; no bleed into sibling rows at phone width.

## Automation

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **1449** passed (pre-fix suite); consent file **21** after new test |
| New unit | `disarms before the sign-out network call returns` |
| Prior unit | `cannot be un-torn-down by a sync pass that was already in flight` |

## Adversarial ledger

| Scenario | Tag | Notes |
|---|---|---|
| Sign out while upsert held (slow RTT) | **holed → fixed** | disarm-before-network; live + unit |
| Sign out when `signOutPlus` fails | solid | unit + still tears down |
| Double Sign out | solid | second press: no session, disarm is idempotent |
| Wipe path still disarms | solid | unit #371 block unchanged |
| Magic-link / handoff without Sign out | **deferred #393** | out of claim |
| Remote `data.json` re-arms | **deferred #394** | out of claim |
| expand-backfill after sign-out | **deferred #395** | out of claim |
| Same-account re-upload cost | **deferred #396** | accepted KTD1 |
| Hub hash thrash | **deferred #397** | unrelated find |
| True server account switch | **blocked** | plus-service not deployed |
| Abort in-flight HTTP mid-body | residual | first chunk already on the wire can complete; no further chunks; baseline not restored |

## Findings

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| F1 | **P0** | `signOutOfPlus` awaited network revoke before disarm → second upsert chunk after Sign out on slow transport | **Fixed** this pass: disarm first; unit pins order |
| F2 | P3 | Notice says "on this device" while row copy says mirror off on every synced device | Accepted tension: session is device-local; `askEnabled` is vault-synced (called out in plan) |

## Not tested / residual

- Real multi-device Obsidian Sync of `askEnabled=false` after sign-out (needs two hardware devices).
- Live magic-link identity switch (#393).
- Phone BRAT install of 0.6.90.

## Merge decision

**Ready** for #389 mark-ready after this commit lands on the PR:

1. Disarm-before-network fix + unit  
2. This QA report + screenshots  
3. PR body: `Closes #372`, checked test plan, absolute screenshot URLs, F1 called out, #393–#397 listed  

Ship as **0.6.90**.
