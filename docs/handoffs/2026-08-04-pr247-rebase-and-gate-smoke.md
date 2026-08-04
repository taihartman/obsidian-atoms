---
handoff_date: 2026-08-04
branch: claude/pr247-rebase-and-gate-smoke
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-qa-mirror-gate
base: master
tracking: https://github.com/taihartman/obsidian-atoms/pull/247
status: in-progress
---

# Handoff — rebase PR #247 onto the new gate, then smoke the stricter floor on a live vault

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to
resume** commands to land on the right branch and worktree, then **start executing Next steps
immediately** — step 1 is your current task. Do not ask the user what to work on and do not
summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Two follow-ups from the mirror-deletion-gate work that just merged (#248 / PR #249, `34a1d2c`,
master is now **0.6.64**).

1. **PR #247 needs to absorb the new gate.** It is a draft peel of Ask orchestration out of
   `main.ts` into `askCoordinator.ts`, and it is now 5 commits behind a master that changed the
   exact functions it is moving. It also has to wire one small thing: #249 added a
   `cancelConfirm` hook that is **declared, tested, and currently inert in production** because
   the host that must implement it lives in the block #247 is relocating.
2. **The stricter completeness gate has never been run against a real vault.** #249 changed when
   the gate refuses. That is backed by unit tests and mutation testing, but zero live evidence.
   You are going to produce that evidence.

## Current status

**Merged and live on master (do not redo any of this):**

- #248 / [PR #249](https://github.com/taihartman/obsidian-atoms/pull/249) merged as `34a1d2c`;
  STATUS cleared by PR #250 (`88add04`). Master is `0.6.64`, 900 tests green, build clean.
- The headline fix: the completeness floor used to compare `vaultPaths.size` (raw scan
  cardinality) against a floor derived from the hash-evidence map — two different sets. A newly
  created atom therefore paid for a missing one, and a partially-synced device with new atoms
  could hard-delete the rows it had not downloaded yet. It now compares
  `survivingEvidenceCount` (`evidenceCount - deletePaths.length`) against that floor, and the
  server tripwire keeps using `scannedCount` because a reconcile really does send `vaultPaths`
  as `keepPaths`.
- Eight smaller fixes rode along: confirm-modal withdrawal on timeout, confirmed-prune clears its
  refusal banner, `no-server-count` routed through `judge()`, `baseline-unreadable` copy arm,
  exhaustive outbox switch (`mirrorConfirmedReceipt` is a type predicate now), the honest
  joined-push toast, the inbox capture-key round-trip, and real `askMirrorStatus` tests.
- `test/` is typechecked now — `tsconfig.test.json`, wired into `npm test`, scoped to
  `askMirror.test.ts` / `askMirrorGate.adversarial.test.ts` / `catchUp.test.ts`. The wider tree
  still has pre-existing type errors; widening that include list is a separate change.

**PR #247 as you inherit it:**

- Branch `refactor/ask-coordinator-peel`, **its own worktree** at
  `/Users/a515138832/StudioProjects/obsidian_plugin-ask-coordinator-peel`, head `5c906fc`,
  **draft**, last updated 2026-08-04T15:56Z. It is 5 behind / 3 ahead of master.
- It implements U1 + U6 of `docs/plans/2026-08-04-001-refactor-orchestration-peel-and-classify-contract-plan.md`.
- Touches `STATUS.md`, `docs/handoffs/2026-08-04-ask-coordinator-peel.md`,
  `src/plugin/askCoordinator.ts`, `src/plugin/main.ts`, `test/askCoordinator.test.ts`.
- A comment on it already carries the two review findings it owns plus the `cancelConfirm`
  snippet: https://github.com/taihartman/obsidian-atoms/pull/247#issuecomment-5181504702

## Next steps

1. **Confirm nobody else is mid-flight on #247 before you touch it.** Run
   `gh pr view 247 --json updatedAt,isDraft` and check the worktree is clean
   (`git -C /Users/a515138832/StudioProjects/obsidian_plugin-ask-coordinator-peel status --short`).
   If it was updated in the last few minutes or has uncommitted work, **stop and tell the user** —
   another session may own it. Otherwise continue in **that** worktree, not this one.

2. **Merge master into `refactor/ask-coordinator-peel` and resolve.** Expect real conflicts:
   master changed `decideMirrorDeletion` (added a required `survivingEvidenceCount` parameter),
   made `mirrorConfirmedReceipt` a type predicate, and edited `syncAskMirror` /
   `runAskMirrorSyncOnce` in `main.ts` — the functions #247 is moving into `askCoordinator.ts`.
   Take master's *logic* and #247's *placement* in every case. Then `npm test` and `npm run build`.

3. **Wire `cancelConfirm` into whatever the confirm host becomes.** This is the load-bearing part
   of step 2, not an extra: without it, the confirm-dialog fix from #249 does nothing in the real
   app. The dialog is abandoned by `confirmWithTimeout` after 2 minutes but stays on screen still
   offering "Delete from cloud"; tapping it resolves an already-settled promise, so the user
   authorises an irreversible delete and nothing happens. The host must retain the modal instance:

   ```ts
   let pendingConfirmModal: AskMirrorDeleteConfirmModal | null = null;
   // ...
   confirm: (request) =>
     new Promise((resolve) => {
       try {
         pendingConfirmModal = new AskMirrorDeleteConfirmModal(this.app, request, resolve);
         pendingConfirmModal.open();
       } catch {
         resolve("dismissed");
       }
     }),
   cancelConfirm: () => {
     pendingConfirmModal?.close();
     pendingConfirmModal = null;
   },
   ```

   Coverage against a fake host already exists (`test/askMirrorGate.adversarial.test.ts`,
   "H: confirm dialog lifecycle"). Add a `test/askCoordinator.test.ts` case that the real host
   object exposes `cancelConfirm`, so the wiring cannot be dropped in a later peel.

4. **Also fold in the two findings #247 owns** (both in the PR comment linked above):
   move `syncNowNotice` + `MirrorSyncOutcome` + `describeMirrorRefusal` out of `plugin/catchUp.ts`
   into `shared/` so `settings/settings.ts:75` stops importing a value from `plugin/`; and replace
   the open-coded Wipe reset at `settings.ts:1299-1315` with
   `clearAskMirrorDeviceState((k, v) => this.app.saveLocalStorage(k, v));` — that helper exists
   precisely so the reset and the readers cannot drift, and it currently has no production caller.

5. **Then the live QA smoke of the stricter gate.** Full recipe in "The QA smoke" below. Write the
   report to `docs/qa/2026-08-04-mirror-gate-stricter-floor-smoke.md` and link it from whatever PR
   carries the work. This is the box PR #249 deliberately left unchecked.

6. **Take #247 out of draft** once 2-5 are green, with a test plan whose boxes match real evidence.

## The QA smoke

**What you are proving.** #249 made the gate refuse in a case it used to allow. The change is
invisible to a count-based check, so it needs the concrete scenario:

| Scenario, 400 atoms | Vault file count | Missing evidence paths | Old behavior | Required new behavior |
|---|---|---|---|---|
| 100 atoms not yet synced | 300 | 100 | refuse | refuse |
| 100 atoms deleted deliberately | 300 | 100 | refuse | refuse |
| **100 atoms retitled** | **400** | **100** | **allow, 100 deletes** | **refuse, 0 deletes** |
| 50 atoms retitled (under the 20% floor) | 400 | 50 | allow | **allow — must not wedge** |

The third row is the fix. The fourth is the control that proves you did not wedge ordinary use —
**do not skip it**, a guard that refuses everything is not a working guard.

`mirrorCompletenessFloor` is `min(baseline, max(5, ceil(baseline * 0.8)))` where
`baseline = max(highWaterCount, evidenceCount)`, so the trip point is losing more than ~20% of
evidence paths between syncs.

**Setup (this is the recipe the last pass used and it worked):**

- Local `plus-service` on `127.0.0.1:8790`: `cd plus-service && DOGFOOD_AUTO_GRANT=1 npm start`
  (sqlite store). Magic-link -> `/v1/auth/exchange` gives a `trialing`, entitled session.
- **Put a logging reverse proxy on `127.0.0.1:8792` forwarding to `:8790` and point the plugin at
  the proxy.** Then "zero deletes" is a grep over a request log, not an inference from a return
  value. The previous report's headline number was trustworthy only because of this.
- Install the build with `./scripts/install-to-vault.sh "<vault path>"`.

**Vault gotcha, verified just now — read this or you will test the wrong build.** Obsidian
currently has the **main repo's** vault open at
`/Users/a515138832/StudioProjects/obsidian_plugin/test_vault/test vault`, *not* any worktree's
copy. It holds **84 atoms**, `askEnabled: false`, and a stale **0.6.60** build left there by an
earlier session. `./scripts/install-to-vault.sh` defaults to the *worktree's* `test_vault`, which
Obsidian is not showing — that is finding F3 from the earlier QA. Always pass the vault path
explicitly, and re-check the version afterwards:

```bash
obsidian eval vault="test vault" 'code=(()=>{const p=app.plugins.plugins["atoms"];return JSON.stringify({vaultPath:app.vault.adapter.basePath,ver:p?.manifest?.version})})()'
```

**Renaming 100 atoms** is a filesystem rename inside `Atoms/` (atoms are `Atoms/<Title>.md`, flat —
never move them out of the folder, that is a hard non-negotiable). Rename, let Obsidian reindex,
then trigger a non-forced sync and check the request log for deletes.

**Then prove the release valve still works:** Settings -> Sync now -> the confirmation modal should
name the concrete counts -> confirm -> the orphaned old-title rows are reconciled away. A refusal
the user cannot clear is a wedge, not a guard.

Screenshots go under `docs/qa/screenshots/<branch>/` and are linked from the PR body with
**absolute** `https://raw.githubusercontent.com/...` URLs — repo-relative paths render broken in PR
descriptions.

## Key files

- `src/platform/askMirror.ts` — `decideMirrorDeletion` (the two-numerator split),
  `resolveMirrorDeletionGate`, `confirmWithTimeout` (calls `cancelConfirm`), `runAskMirrorSync`
  (where `survivingEvidenceCount` is computed), `mirrorCompletenessFloor`
- `src/plugin/main.ts` — the `confirm:` host block that needs `cancelConfirm` (step 3); being
  moved wholesale by #247
- `src/plugin/catchUp.ts` — `runMirrorSingleFlight`, `describeMirrorRefusal`, `syncNowNotice`,
  `runAskOutboxApply`; steps 4's move source
- `src/settings/settings.ts:75` — the layering violation; `:1299-1315` — the open-coded Wipe reset
- `test/askMirrorGate.adversarial.test.ts` — 47 scenarios incl. "G: new atoms cannot pay for
  missing ones" and "H: confirm dialog lifecycle"; the fake host has `setScannedPaths` for
  membership-vs-cardinality cases
- `docs/plans/2026-08-04-001-refactor-orchestration-peel-and-classify-contract-plan.md` — U1/U6,
  the authority for #247
- `docs/solutions/logic-errors/a-threshold-whose-numerator-and-denominator-count-different-sets.md`
  — why the gate is shaped this way; read before changing any threshold
- `docs/qa/2026-08-01-fix-mirror-delete-gate-and-outbox-ack-world-class-qa.md` — the prior QA
  report, incl. the proxy recipe and the F3 vault-split gotcha

## Decisions & constraints

- **Do not relitigate the two-numerator split.** `scannedCount` (vault cardinality) feeds the
  server tripwire because a reconcile sends `vaultPaths` as `keepPaths`;
  `survivingEvidenceCount` feeds the completeness floor because that floor's denominator is
  evidence. They are different questions and must stay different variables.
- **The high-water mark ratchets on evidence, not vault cardinality.** Changing it back pins the
  floor to exactly `evidenceCount` and wedges anyone who both adds and deletes an atom.
- **The joined-push toast stays honest.** The user chose "fix the message, keep the drop" over
  running a second automatic pass into the irreversible-delete path. Do not add that pass.
- **The layering answer is "move the code"**, not "amend the architecture doc". Decided.
- **Vault lanes are a hard rule.** Agents write only to `test_vault/` and
  `docs/media/demo-vault/`. **Never** run Process, Update, or a classify pass against
  `~/Documents/Remote Vault` or any personal vault.
- **No GitHub Release unless the user asks.** Master carries a live data-loss fix that users do not
  have yet, so it is worth *raising*, but cutting one is their call.
- **Cross-model peer is grok, not codex** — `.compound-engineering/config.local.yaml` in this repo
  already says so. The codex CLI on this machine is a broken install (`codex --version` fails).
- Commits and PRs carry **no AI attribution** trailers.

## Open questions / blockers

- **Is another session still driving #247?** It was updated 15:56Z today. Step 1 exists to check.
  If someone else owns it, do the QA smoke (step 5) first and leave the rebase to them — the smoke
  does not depend on #247.
- **The QA smoke needs Obsidian running on the throwaway vault, and a local plus-service.** If
  Obsidian is not open or the CLI is disabled (Settings -> General -> Advanced -> Command line
  interface), you cannot complete step 5 — say so plainly and hand back a checklist rather than
  labelling a code-read as QA.
- The wider `test/` tree still fails typechecking. Widening `tsconfig.test.json`'s include list is
  worth doing eventually but is deliberately not in scope here.

## Git state

- Branch `claude/pr247-rebase-and-gate-smoke` (base `master`), pushed to `origin`.
- Last real commit on master: `88add04` Merge pull request #250 from taihartman/chore/clear-status-248
- WIP snapshot commit: `e8ac1af` — `wip: handoff snapshot — pr247-rebase-and-gate-smoke`
- This branch adds only this handoff doc; no code changes.
- Diff since base: 1 file, +1 doc.

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-qa-mirror-gate
git fetch origin && git switch claude/pr247-rebase-and-gate-smoke && git pull --ff-only
npm install
npm test          # expect 900 green on master's content
```

Then continue from **Next steps** above. Note that step 1 moves you to a *different* worktree —
`/Users/a515138832/StudioProjects/obsidian_plugin-ask-coordinator-peel` — because that is where
`refactor/ask-coordinator-peel` is checked out. Do not create another worktree for it.
