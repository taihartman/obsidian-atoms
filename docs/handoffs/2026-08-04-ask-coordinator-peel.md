---
handoff_date: 2026-08-04
branch: refactor/ask-coordinator-peel
worktree: /Users/a515138832/StudioProjects/obsidian_plugin-ask-coordinator-peel
base: master
tracking: none (create Issue + STATUS + draft PR before code — hard claim)
status: in-progress
---

# Handoff — Ask coordinator peel (epic U1 + preferred U6)

You are picking up this work in a fresh session. Read this file top to bottom, run the **How to resume** commands to land on the right branch and worktree, then **start executing Next steps immediately** — step 1 is your current task. Do not ask the user what to work on and do not summarize this doc back to them; just begin, and report what you did. Everything you need is below.

## Goal

Execute **U1** (and prefer **U6 as the same PR tail**) of the orchestration peel epic: move Ask mirror + outbox orchestration out of fat `src/plugin/main.ts` into a dedicated coordinator module, without changing hybrid C Ask semantics. Optionally remove synced `askMirrorHashes` in the same PR (U6). This is **move-only packaging** (except U6 field removal + migrate-off).

U5 (classify dual-surface parity) already shipped: **0.6.63**, PR #244 / Issue #243 merged.

## Current status

- **Master** includes classify parity freeze + plan + architect review (`314725f` / merge `314725f` via #244; STATUS clear via #245).
- **Epic plan (authority):** `docs/plans/2026-08-04-001-refactor-orchestration-peel-and-classify-contract-plan.md`
- **Architect origin:** `docs/reviews/2026-08-04-systems-architect-read.md`
- **Settled POV (do not relitigate):** 1B home ≤1800 after actions; **2A U5 first (done)** then peels; **3A parity-only** (no generate-one-source).
- **Sequencing after U5:** U1 (+ U6 preferred) → U2 filing runs → U3a/b → U4 home actions → U7 docs.
- **Branch + worktree created** for U1; **no U1 code yet** — you must hard-claim before implementing.
- **Open collision risk:** PR **#226** (`fix/mirror-delete-gate-and-outbox-ack`) is still **OPEN** and touches Ask mirror/outbox. Do not fight it on the same lines without coordinating. Prefer wait/rebase or claim non-overlapping coordinator extract if #226 lands first.
- **Stash in main repo (not this worktree):** `stash@{0}: wip graphify+process docs` — CLAUDE.md graphify rules, AGENTS.md stub, `.gitignore` graphify-out, collab/workflow-lanes pointers. **Separate chore** if still wanted; not part of U1.

## Next steps

1. **Hard claim (mandatory before any code):**
   - `gh issue create` for U1 Ask coordinator peel (body: plan path + U1/U6 scope; link epic plan).
   - Assign human owner (`taihartman` or current user).
   - Update `STATUS.md` row: owner, branch `refactor/ask-coordinator-peel`, plan U1 (+U6), hot files `src/plugin/main.ts`, new `src/plugin/askCoordinator.ts` (or agreed name), `src/settings/settings.ts` if U6, tests.
   - Push branch + open **draft** PR with `Closes #<issue>`.
2. **Read before edit:**
   - Plan U1 + U6 sections in the epic plan (Preserve checklist is load-bearing).
   - `docs/solutions/architecture-patterns/ask-mirror-parity.md`
   - `docs/architecture.md` § Ask mirror sync
   - Live `src/plugin/main.ts` Ask blocks (events, debounce, single-flight, `syncAskMirror`, `runAskMirrorSyncOnce`, `applyAskOutbox`, onload hooks).
   - Pure planners already tested: `src/platform/askMirror.ts`, `askOutbox.ts` + `test/askMirror.test.ts`, `test/askOutbox.test.ts`.
3. **Implement U1 (behavior-neutral):**
   - Add `src/plugin/askCoordinator.ts` with `import type AtomsPlugin from "./main"`.
   - Move **state + methods as one owner:** inFlight, debounce timer, dirty/follow-up flags, vault event registration, layout/interval hooks that only serve Ask, sync/outbox apply.
   - Thin wrappers on `AtomsPlugin`: `scheduleAskMirrorSync`, `syncAskMirror`, `applyAskOutbox` (stable call sites).
   - **Preserve checklist** (from plan — copy into PR test plan): privacy/write acks; `sess_` only for mutate; device-local hashes; empty-dirty still deletes/reconcile on force; force `keepPaths` = flat Atoms **∪** hubs; `confirmEmpty`; hash write after chunks; mirror-before-ack; failures never fail Process.
4. **Tests (mandatory glue, not optional dogfood-only):**
   - Keep pure planner tests green.
   - Add characterization: single-flight reentry; empty-dirty+force keepPaths includes hubs; mirror failure does not fail Process caller; migrate-off → LS + clear settings path.
   - Prefer U6 in same PR: drop `askMirrorHashes` from `LinkerSettings` + wipe path in `settings.ts`; test saveData has no key.
5. **Verify:** `npm test` + `npm run build`. **Required** demo/test vault Ask dogfood in PR Test plan (edit atom + Sync now; server count). Never personal Remote Vault.
6. **Version:** no bump if pure peel; bump only if U6/user-visible strings change (unlikely).
7. **Do not start U2** until U1 PR is up (or user says stack).

## Key files

- `docs/plans/2026-08-04-001-refactor-orchestration-peel-and-classify-contract-plan.md` — epic plan; U1/U6/U7 units, KTDs, POV settled
- `docs/reviews/2026-08-04-systems-architect-read.md` — why peel exists
- `src/plugin/main.ts` — extract target (~2171 lines baseline at survey; re-`wc -l` after pull)
- `src/platform/askMirror.ts` / `askOutbox.ts` — pure planners stay; orchestration moves
- `src/settings/settings.ts` — U6 wipe path still assigns `askMirrorHashes` (must fix if U6)
- `src/shared/types.ts` — `LinkerSettings.askMirrorHashes` remove in U6
- `test/askMirror.test.ts` / `test/askOutbox.test.ts` — extend; add coordinator glue tests
- `docs/solutions/architecture-patterns/ask-mirror-parity.md` — hybrid C invariants
- `CLAUDE.md` — vault lanes, shipping tail; graphify section may be missing until stash applied

## Decisions & constraints

- **Do not relitigate POV 1B/2A/3A** or epic scope.
- **U1 is move-only** — no Ask semantic “improvements,” no Process path rewrites.
- **Hard claim before code** (Issue + STATUS + draft PR). Chat is not a ticket.
- **PR #226** open on mirror/outbox — coordinate hot files; rebase after merge if needed.
- **Dependency rule:** coordinator must not import `home/`; `pipeline/**` stays pure of UI/plugin.
- **Secrets stay on plugin** — coordinator gets session/token via existing helpers, no key logging.
- **Agent vault lane:** demo/test vault only for Ask dogfood.
- **No AI commit attribution** (global rule).
- Master is **PR-protected** — STATUS clears need a PR after merge (pattern #245).

## Open questions / blockers

- **#226 open** — if it still conflicts on Ask glue, either wait for merge or extract only non-overlapping coordinator shell and rebase.
- Whether to land **U6 in same PR as U1** (plan prefers yes) — default **yes** unless diff gets huge.
- Graphify process stash — out of scope for this branch unless user asks.

## Git state

- Branch `refactor/ask-coordinator-peel` (base `master`), pushed to `origin`.
- Last real commit before handoff: `1835b57` Merge pull request #245 (STATUS clear after #244).
- WIP snapshot commit: `8770811` — `wip: handoff snapshot — ask-coordinator-peel` (branch tip)
- Diff since base: 1 file, +105 (handoff doc only until claim/code).

## How to resume

Check out the work exactly here — this is your branch and worktree:

```bash
cd /Users/a515138832/StudioProjects/obsidian_plugin-ask-coordinator-peel
git fetch origin && git switch refactor/ask-coordinator-peel && git pull --ff-only
npm install   # if node_modules missing in worktree
npm test      # baseline green before edits
```

Then continue from **Next steps** above — start at step 1 (hard claim), then implement U1.
