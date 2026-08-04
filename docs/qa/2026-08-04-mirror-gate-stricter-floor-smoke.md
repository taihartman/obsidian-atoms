# World-class QA — the stricter mirror completeness floor, on a live vault

**Date:** 2026-08-04
**Branch:** `refactor/ask-coordinator-peel` (PR #247) · plugin **0.6.64**
**Vault:** `test_vault/test vault` (throwaway lane) — 400 atoms + 7 linked hubs = **407 mirror paths**
**Backend:** local `plus-service` on `127.0.0.1:8790` (sqlite, `DOGFOOD_AUTO_GRANT=1`), reached through a
logging reverse proxy on `127.0.0.1:8792` so every request is on the record.
**Counterfactual build:** `76461d5` (pre-#249 master, **0.6.63**), built and installed into the same vault.

This is the box [PR #249](https://github.com/taihartman/obsidian-atoms/pull/249) deliberately left
unchecked: #249 changed *when* the deletion gate refuses, backed by unit tests and mutation testing,
with no live evidence. Every count below is read off the wire, not inferred from a return value.

## Verdict

**Ship.** The fix does what it claims on a real vault: the retitle case that used to hard-delete 100
cloud rows now deletes nothing, and the guard does not wedge ordinary use. One copy defect found
(F1, non-blocking) and one design consequence worth knowing about (F2).

## How to read the numbers

`mirrorCompletenessFloor = min(baseline, max(5, ceil(baseline × 0.8)))` where
`baseline = max(highWaterCount, evidenceCount)`. With a 407-path baseline the floor is **326** — the
gate refuses once more than ~20% of evidence paths go missing between syncs.

The pre-fix build compared **`vaultPaths.size`** (raw scan cardinality) against that floor. The fixed
build compares **`survivingEvidenceCount`** (`evidenceCount − deletePaths.length`). A retitle is the
case that separates them: the vault file count never drops, but every renamed atom's *evidence* path
goes missing.

## Core user stories

| # | Scenario (baseline 407 paths) | Vault files | Missing evidence | Observed on 0.6.64 | Delete requests on the wire |
|---|---|---|---|---|---|
| S1 | 16 atoms removed (under the floor) | 391 | 16 | allowed, converged | `POST /mirror/delete` × 16 paths |
| S2 | 100 atoms removed from the vault | 291 | 100 | **refused**, refusal recorded | **none** |
| S3 | **100 atoms retitled** | **400 (unchanged)** | **100** | **refused**, refusal recorded | **none** |
| S4 | 50 atoms retitled (control, under the floor) | 400 | 50 | **allowed**, converged | `POST /mirror/delete` × 50 paths |
| S5 | Same as S3, on **0.6.63** (counterfactual) | 400 | 100 | **allowed**, no refusal | **`POST /mirror/delete` × 100 paths** |

S3 vs S5 is the fix, same vault and same backend minutes apart:

```
0.6.63  POST /v1/ask/mirror/upsert  atoms=100
0.6.63  POST /v1/ask/mirror/delete  deletes=100   ← "Atoms/QA Gate Atom 100.md", 099, 098, …
0.6.64  POST /v1/ask/mirror/upsert  atoms=100
0.6.64  GET  /v1/ask/mirror/status                ← and nothing else. No delete.
```

S4 is the control that proves the guard is a guard and not a wall: 50 retitles (12% of evidence)
uploaded the new titles and pruned the 50 orphaned old-title rows, with `refusal` still `{count:0}`.

## The release valve

A refusal the user cannot clear would be a wedge, not a guard. Both exits were driven live:

1. **Press Sync now again.** After the S3 refusal, one forced sync converged: uploaded the new
   titles, deleted the 100 orphaned old paths, `reconcile keepPaths=407 confirmEmpty=false`, and the
   Settings banner returned to `{count:0}`.
2. **Confirm the dialog.** In the S2 state, a forced sync posed the confirmation modal with concrete
   counts — *"Atoms this device has synced before: 391 / Atoms found in this vault right now: 291 /
   Cloud count right now: 391"* — and clicking **Delete from cloud** deleted the 100 paths,
   reconciled to `keepPaths=291`, cleared the banner, and lowered the high-water mark to 291.

## Edge cases & regressions covered

**The confirm dialog withdraws itself on timeout (the `cancelConfirm` wiring, this PR).** With the
modal open, the run was left untouched for 125 seconds. `confirmWithTimeout` gave up at 120s and the
dialog **closed itself**; the pass returned `{kind:"refused", reason:"scan-incomplete"}` and issued
zero delete or reconcile requests. Before this PR the hook was declared and unit-tested but had no
production implementation — the dialog would have stayed on screen offering "Delete from cloud"
against an already-settled promise, so the user would authorise an irreversible delete and nothing
would happen. This is the first live proof of that fix.

**The reconcile tripwire fires independently.** With the cloud at 557 rows after several scenarios
and the vault at 407 paths, a forced sync refused with `server-count-tripwire` and pruned nothing —
the arm that protects a partially-synced device from a full reconcile.

**Wipe clears every device-local key (the `clearAskMirrorDeviceState` change, this PR).** Driven
through the real Settings button and its confirmation modal: `POST /v1/ask/mirror/wipe`, then hash
map `{}`, and server-count / refusal / high-water all cleared (not zeroed — "0" would be a claim,
absence is the truth).

**Nothing was lost locally in any scenario.** Every refusal left all 400 vault files in place; the
vault ends converged at 407 evidence paths / 407 cloud rows on 0.6.64.

## Findings

### F1 — the Settings refusal banner says "vault scan incomplete" for every reason (non-blocking)

`formatAskMirrorRefusalLine` (`src/platform/askMirror.ts:438`) hard-codes the string. Observed live:
the recorded reason was `server-count-tripwire`, and the banner read
*"Ask mirror: 557 · sync refused — vault scan incomplete · Sync now to retry"*. This is the exact
untruth #249 removed from the modal (`mirrorRefusalTitle`) and from `describeMirrorRefusal`, still
present in the persistent surface. The stored refusal record (`MirrorRefusalState`) carries no
`reason`, so fixing it means persisting the reason alongside the count. Fail-closed and cosmetic,
but the banner is the surface a user stares at longest.

### F2 — the high-water mark keeps a transient peak for up to 30 days (by design, worth knowing)

A retitle round-trip temporarily inflates evidence (old + new titles both present), and the mark
ratchets to that peak: after retitling 100 of 407 and restoring, the mark sat at **507** while
steady-state evidence was 407 — putting the floor at 406, one deleted atom away from refusing, until
a confirmed reconcile lowers it or `MIRROR_HIGHWATER_DECAY_DAYS` (30) expires. This is the
documented ratchet doing its job (it fails closed, and Sync now clears it), not a bug, but it means a
user who renames a chunk of their library can meet an unexpected refusal on their next ordinary
deletion. Worth a plan note, not a change here.

### F3 — the vault-split gotcha, again (process)

Obsidian was open on the **main repo's** `test_vault/test vault`, not any worktree's copy, holding a
stale 0.6.60 build. `./scripts/install-to-vault.sh` defaults to the *worktree's* vault, which
Obsidian was not showing. Always pass the vault path explicitly and re-check
`p.manifest.version` afterwards. Carried forward unchanged from the 2026-08-01 report.

## Evidence

| What | Where |
|---|---|
| Confirm modal with concrete counts | `docs/qa/screenshots/refactor-ask-coordinator-peel/01-confirm-modal.png` |
| Settings refusal banner (F1 visible) | `docs/qa/screenshots/refactor-ask-coordinator-peel/02-settings-refusal-banner.png` |
| Wipe confirmation | `docs/qa/screenshots/refactor-ask-coordinator-peel/03-wipe-confirm.png` |
| Settings converged on 0.6.64 | `docs/qa/screenshots/refactor-ask-coordinator-peel/04-settings-converged.png` |
| Request log (195 lines, every scenario marked) | `docs/qa/logs/2026-08-04-mirror-gate-proxy.jsonl` |

## Not covered

- **Multi-device.** Every scenario ran on one vault against one device's evidence map. The
  partially-synced-phone case is still only covered by unit tests.
- **A real Obsidian Sync download in progress.** "Not yet synced" was simulated by holding files
  outside the vault, which produces the same evidence state but not the same timing.
- **Fly / production plus-service.** Local sqlite service only.
