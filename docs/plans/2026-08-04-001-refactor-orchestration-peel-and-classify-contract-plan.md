---
title: "refactor: orchestration peel + classify contract freeze + architecture honesty"
date: 2026-08-04
type: refactor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin: docs/reviews/2026-08-04-systems-architect-read.md
continues: docs/plans/2026-07-16-017-refactor-hybrid-src-layout-plan.md
doc_review: "2026-08-04 multi-persona; safe_auto applied; POV 2026-08-04 settled 1B·2A·3A"
---

# refactor: orchestration peel + classify contract freeze + architecture honesty

## Goal Capsule

Finish the hybrid-layout job left incomplete in 2026-07-16-017: **thin the two gravity wells** (`plugin/main.ts` ~2171 lines, `home/atomsHomeView.ts` ~2331 lines), **freeze the dual-surface classify contract** (plugin + plus-service), and **make `docs/architecture.md` match runtime reality**.

**Authority:** `CLAUDE.md` non-negotiables · `docs/architecture.md` · `docs/reviews/2026-08-04-systems-architect-read.md` · this plan · prior hybrid plan U3 intent.

**Move-only units (U1–U4):** product behavior unchanged — no prompt/string/schema product edits.  
**Semantic units (U5–U6):** allowed honesty fixes only as listed in those units (people hard-rules parity; remove synced `askMirrorHashes`). U5 is **not** a mechanical peel — version bump + dual-deploy checklist when prompt text changes.

**Stop when:**

1. `src/plugin/main.ts` **≤ ~1000 lines** as a router (not an orchestration dump). Extracted modules are single-concern; thin wrappers alone are not success if a callee still mixes I/O + policy without tests.
2. **Home mass:** invite/hub/created-order vault writes leave `atomsHomeView` (U4). **Hard gate after U4:** ≤ ~1800 lines (realistic after actions-only peel). **≤ ~1000** requires U4b render/load split (see U4) — do not claim AE5 home ≤1000 from invite-actions alone. Stretch ≤800 is non-blocking nice-to-have, never merge-blocking.
3. Ask sync, filing runs, and home invite/hub actions live in dedicated modules with pure-edge tests moved or added; **U1 includes mandatory Ask glue characterization** (see U1).
4. Classify schema/prompt **parity** is CI-gated (dual sources until generate-one-source); enrich order is named list(s) with tests; language is “parity freeze” not false SSOT unless single-source lands.
5. `architecture.md` runtime diagram + module map are honest (inbox drain, `runWritePath`/`runDryRun`, `graph/`, full `platform/*`, dual deployables).
6. `askMirrorHashes` **removed** from `LinkerSettings` type/defaults; wipe/migrate only touch device-local LS (U6).
7. `npm test` + `npm run build` green; plus-service tests green for contract units; U1 Ask demo-vault dogfood **required** in PR test plan (not optional).

**Out of this epic (P3):** new product surfaces (consolidation maps, richer cues, new home cards). Those wait until peel lands.

---

## Product Contract

Product Contract preservation: **unchanged product identity** — this is systems packaging. No new user-facing feature claims.

### Actors

| ID | Actor |
|---|---|
| A1 | Implementer / coding agent |
| A2 | Future multiplayer agents placing new code |
| A3 | Human dogfooding Preview/Process/Ask/invites (regression only) |

### Requirements

| ID | Requirement |
|---|---|
| R1 | **Behavior-neutral peels (U1–U4)** — same command ids, same Process/Preview/Update/auto-run/Ask/invite semantics, same markers and body sacred rules. **Exceptions only:** U5 people hard-rules prompt parity (version + Fly if product-facing); U6 remove synced `askMirrorHashes` (multi-device safety, not product feature). |
| R2 | **Finish hybrid-plan orchestration peel** (prior plan 017’s incomplete U3) — maps to **this plan’s U1+U2+U3**, not unit U3 alone. Extract orchestration from fat `AtomsPlugin` into `plugin/*` modules; class keeps thin public wrappers for home/commands. |
| R3 | **Home is a projection** — vault-mutating invite/hub/created-order actions leave `AtomsHomeView`; view renders models and calls services. |
| R4 | **Dependency rule preserved** — `pipeline/**` never imports `home/`, `resurface/`, `settings/`, `ui/`, or `plugin/`. Filing run modules live under `plugin/` (or `platform/` only if no home types). |
| R5 | **Ask invariants preserved** — hybrid C (`docs/architecture.md` § Ask mirror sync + `docs/solutions/architecture-patterns/ask-mirror-parity.md`): vault SSOT, device-local hashes, no early-return skipping deletes, Sync now full reconcile, mirror failures never fail Process. |
| R6 | **Progress contract preserved** — home-native progress for interactive runs; auto-run stays silent (`docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md`). |
| R7 | **Classify contract freeze** — `ClassificationResult` fields incl. `people`, `hub_section`; plugin + plus-service schema/prompt **parity CI-gated** (dual-import tests minimum; prefer generate-one-source when cheap). Named enrich stage order(s) tested; intentional dual-chain diffs documented if any. |
| R8 | **Architecture honesty** — runtime map = inbox drain → past dailies → dry/write; module map includes real modules; **remove** synced `askMirrorHashes` from settings type (migrate-off once). |
| R9 | **No version bump** for pure peels/docs. Bump only if user-visible strings/prompt behavior change (document in that unit). |
| R10 | **Multiplayer** — hard claim (Issue + STATUS + draft PR) before code; prefer **one PR per unit** (or small stacks) so hot-file overlap is short. |
| R11 | **Verify** — `npm test` + `npm run build` every unit; plus-service tests on contract units; optional `./scripts/verify.sh` when Obsidian open. |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | After peel, `grep -n "runAskMirrorSyncOnce\|runProcessUnprocessed\|applyAskOutbox" src/plugin/main.ts` shows only thin wrappers (or gone if fully delegated). |
| AE2 | Person invite Accept still creates hub, upgrades peers, schedules mirror — logic not inline in `atomsHomeView.ts` render tree. |
| AE3 | `npm test` includes dual-surface schema/prompt parity; changing only plus template fails a plugin test (or shared gate). |
| AE4 | Agent reading `architecture.md` sees `drainInbox` + `runWritePath`/`runDryRun`, not `processInbox`. |
| AE5 | Line counts: `main.ts` ≤ 1000; `atomsHomeView.ts` ≤ 1800 after U4 and ≤ 1000 only if U4b render split lands (measure with `wc -l`). |
| AE6 | Auto-run still does not call `beginHomeRun` / progress UI. |

### Key flows (regression only)

| ID | Flow | Must still work |
|---|---|---|
| F1 | Preview → Process | Dry-run fidelity; write path; home progress |
| F2 | Auto-run | Silent; stamp semantics; never today |
| F3 | Ask mirror delta + Sync now | Hashes device-local; orphan cleanup only on force |
| F4 | Ask outbox apply | Mirror-before-ack; no lost vault writes |
| F5 | Person / entity invite accept | Hub create + peer upgrade + optional hub projection |
| F6 | Update notes | Quality stamp; land peak; mirror after |
| F7 | Plus vs BYOK classify | Same schema; auth paths unchanged |

### Scope Boundaries

**In**

- Extract Ask coordinator, filing runs, auto-run, backfill glue, dev spikes from `main`
- Extract home invite/hub/created-order actions from `atomsHomeView`
- Classify dual-surface freeze + enrich order test
- `architecture.md` (+ CLAUDE seams if paths change) + optional solutions path fixes
- Quarantine/remove `askMirrorHashes` on synced settings

**Out**

- New product features / home cards / consolidation
- Full Clean Architecture / ports-adapters rewrite
- Renaming public command ids or plugin id
- Reformatting unrelated code
- Replacing tree-sitter graphify or other dev tooling
- Rewriting plus-service store backends

**Deferred (non-blocking)**

- Settings tab peel (Plus/Ask models out of `settings.ts`) — **non-blocking contingency** if mass still blocks DoD after U1–U4; not epic P0
- Shared npm package for schema across deploys — prefer generate-one-source or parity tests; package only if needed
- Full SYSTEM_PROMPT character equality if intentional surface differences remain — document locked subset in an allowlist file
- Optional golden ClassificationResult JSON fixtures — **out of U5 DoD** (follow-up); if added later, synthetic only (no vault PII)

---

## Planning Contract

### Origin

- Primary: `docs/reviews/2026-08-04-systems-architect-read.md` (P0 → P1 → P2)
- Continues incomplete U3 from `docs/plans/2026-07-16-017-refactor-hybrid-src-layout-plan.md`
- Patterns: `commands.ts`, `askMirror.ts`, `askOutbox.ts`, `runProgress.ts`, `landPeak.ts`, `autorun.ts`, `test/classifierPeople.test.ts`

### Settled decisions (session / ce-pov 2026-08-04)

| ID | Decision | Class | Rejected | Reason |
|---|---|---|---|---|
| POV-1 | **Home mass gate = ≤ ~1800 after U4 actions peel; ≤1000 only via optional U4b later** | user-approved | Force ≤1000 in U4 | Invite writes are a small slice; `render` dominates |
| POV-2 | **U5 classify parity first (or parallel after U0); peel U1+ after** | user-approved | Peel-first only | Dual-import exists; people prompt drift real; avoid Ask/mirror PR clash on `main` |
| POV-3 | **Parity tests + people hard-rules fix; no generate-one-source in this epic** | user-approved | Monorepo package / codegen now | House pattern is dual-import assert; name it parity freeze not SSOT |

### Key Technical Decisions

| ID | Decision | Rejected | Why |
|---|---|---|---|
| KTD1 | **Execution order (POV-2): U0 → U5 → U1 → U2 → U3a/b → U4 → U6 (or U1 tail) → U7** | Peel-first default | Contract safety before main churn; U5 low overlap with peels |
| KTD2 | **Extract as `fn(plugin: AtomsPlugin, …)` modules under `plugin/`** using `import type AtomsPlugin from "./main"` (or `platform/` for Ask if no home types). **Phase-1 wrappers** on plugin; post-epic backlog may migrate call sites off the hub. | New classes / DI container | Matches house style; thin class wrappers preserve home/command call sites |
| KTD3 | **Keep public method names** on `AtomsPlugin` that home/commands call (`runProcessFromHome`, `scheduleAskMirrorSync`, …) | Rename all call sites first | Behavior-neutral; rename later if desired |
| KTD4 | **Home actions → `home/actions.ts` or `home/inviteActions.ts`** taking vault/app deps, not `pipeline` importing home | Put invite writes in `pipeline/` calling UI | Dependency rule; invite planners already in pipeline |
| KTD5 | **Contract freeze = dual-import parity tests first** (honest name: parity, not SSOT until one source). Prefer generate plus template from TS when drift hurts; locked prompt/schema subset in allowlist. | Immediate monorepo package only | `classifierPeople` already imports plus template |
| KTD6 | **Enrich order = exported named list(s) + tests** after auditing `classifyCapture` vs `applyClassificationQuality` (they currently differ). Canonical = live classify path unless intentional dual lists. | Single list without audit | Avoid freezing the wrong chain or silent backfill/refresh drift |
| KTD7 | **Line-count is a smoke metric, not the only DoD** — main ≤1000 + single-concern modules + glue tests where I/O moved. Home ≤1800 after U4; ≤1000 needs U4b. Stretch ≤800 never blocks merge. | Chase 400/800 vanity | Hybrid U3 over-promised 400 |
| KTD8 | **No version bump** unless prompt/user strings change | Bump on every peel | CLAUDE.md versioning rule |
| KTD9 | **Characterization = green suite before/after + pure tests move with code** | Full AtomsPlugin integration harness | Not house style; pure edges already strong |
| KTD10 | **`askMirrorHashes` remove/migrate-off complete** — drop from `LinkerSettings` type/defaults after confirming migrate path | Leave dead field | Multi-device footgun |

### Assumptions

- STATUS is empty at plan time; implementer claims before code.
- Hybrid C Ask behavior is correct today; peel must not “improve” sync semantics.
- Prompt drift on `people` hard-rules line is a **bugfix** allowed inside U5 (document + dual parity), not a silent product change.
- plus-service stays on Fly; contract tests run in CI/local without deploy unless prompt changes require Fly ship (then same PR notes dual deploy).

### Sequencing

```
U0 claim
  → U5 Classify parity freeze          ← first code (POV-2)
  → U1 Ask coordinator (+ U6 preferred as tail)
  → U2 Filing runs + progress bridge
  → U3a Auto-run → U3b backfill + dev spikes
  → U4 Home actions (≤1800; U4b optional later)
  → U7 architecture.md honesty (runtime diagram may ride earlier PRs)
```

U7 module map only after peel module names exist. Runtime pipeline rename may land with U5.

### Risks

| Risk | Mitigation |
|---|---|
| Ask peel breaks multi-device delete/reconcile | Keep pure `askMirror`/`askOutbox` tests; dogfood Sync now; re-read parity solution |
| Double Process / lost progress | Move progress bridge with filing runs; AE6 auto-run silent check |
| Invite lost update on atom modify | Preserve read-modify-write patterns; see solutions lost-update learning |
| Contract freeze fails on existing prompt drift | Fix people line parity in U5; document intentional diffs |
| Hot-file multiplayer collision | One unit per PR; STATUS hot files explicit |
| Line count gaming (move without separating concerns) | Review checklist: each extracted module has a single concern name |

---

## Implementation Units

### U0. Claim and baseline

**Goal:** Multiplayer lock + green baseline before moves.

**Work:**

- Open GitHub Issue (epic or first unit); assign human owner.
- Branch `refactor/orchestration-peel` (or per-unit branches).
- STATUS row: hot files `src/plugin/main.ts`, `src/home/atomsHomeView.ts`, later units add their files.
- Draft PR.
- Record baseline: `wc -l src/plugin/main.ts src/home/atomsHomeView.ts`; `npm test`; `npm run build`.

**Files:** `STATUS.md` only (plus Issue/PR).

**Tests:** none beyond baseline green.

**Gate:** claim complete before U1 code.

---

### U1. Ask coordinator peel

**Goal:** Move Ask mirror + outbox orchestration out of `main` without changing hybrid C.

**Work:**

- Add `src/plugin/askCoordinator.ts` (or `src/platform/askSyncOrchestration.ts` if preferred — **no home imports**). Use `import type AtomsPlugin from "./main"`.
- Move **state + methods as one owner:** `askMirrorInFlight`, debounce timer, dirty/follow-up flags, vault event registration, onload layout/interval hooks that only serve Ask, `syncAskMirror`, `runAskMirrorSyncOnce`, `applyAskOutbox` (and helpers only used by these). Document **single owner** of inFlight — do not split across plugin + module.
- `AtomsPlugin` keeps thin wrappers: `scheduleAskMirrorSync`, `syncAskMirror`, `applyAskOutbox` so home/settings call sites stay stable.
- **Preserve checklist (hybrid C — copy into PR test plan):**
  1. Mirror gated by ask enabled + privacy ack  
  2. Outbox gated by write ack  
  3. Mirror mutate + outbox pull/ack use `readPlusSession` / `sess_` only — **never** `mcp_` bearer  
  4. Device-local hash LS keys only; migrate-off legacy settings hashes once  
  5. Empty-dirty still runs deletes/reconcile on force; no early-return that skips deletes  
  6. Force `keepPaths` = flat `Atoms/*.md` **∪** hub paths (`isHubMirrorPath`) — not atoms-only  
  7. `confirmEmpty` when force keepPaths empty  
  8. Write hash evidence after each successful upsert/delete/reconcile chunk  
  9. Mirror-before-outbox-ack  
  10. Mirror failures never fail Process/Update callers  

**Files:**

- Create: `src/plugin/askCoordinator.ts` (name flexible)
- Edit: `src/plugin/main.ts`
- Tests: extend pure planners; **add** glue characterization (see scenarios)

**Test scenarios:**

1. Existing askMirror planner tests still pass.
2. Existing askOutbox planner tests still pass.
3. Force reconcile `keepPaths` includes flat atoms **and** hub paths (pure plan characterization).
4. Glue characterization (mandatory — extract pure helpers or injectable deps): single-flight reentry safe; empty-dirty + force still plans deletes/reconcile; mirror failure does not fail Process caller; migrate-off writes LS and clears settings field path.
5. `npm test` + `npm run build` green.

**Verify (required in U1 PR Test plan):** demo/test vault only — enable Ask, edit an atom, Sync now; status line uses **server** count. Record steps checked.

**Depends on:** U0.

---

### U2. Filing run service + home progress bridge

**Goal:** Process / Preview / Update / fixture orchestration + `beginHomeRun`…`landPeakFromWrite` leave `main`.

**Work:**

- Add `src/plugin/filingRuns.ts` (`import type AtomsPlugin`).
- Move: `runProcessUnprocessed`, `runDryRunPreview`, `runUpdateNotes`, fixture process, shared proposed-tags merge, end-of-run mirror/outbox hooks, home progress broadcast helpers used only by these runs.
- Keep public `run*FromHome` names on plugin as one-liners.
- **Secrets stay on plugin:** modules receive apiKey / filing auth as args; no raw key or `sess_` logging.
- Auto-run must **not** gain progress UI (R6 / AE6) — interactive path begins/ends progress; auto-run write path must not call progress APIs even if it goes through filingRuns.
- Follow `docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md`.
- Escape hatch: if PR unreviewable, split progress-bridge follow-up — do not invent DI.

**Files:**

- Create: `src/plugin/filingRuns.ts`
- Edit: `src/plugin/main.ts`, possibly `src/home/runProgress.ts` / `landPeak.ts` (imports only)
- Tests: existing write/preview/refresh/landPeak/runProgress tests + progress branching characterization

**Test scenarios:**

1. `npm test` green (write, preview, refreshAtoms, landPeak, runProgress).
2. Public command ids in `commands.ts` unchanged.
3. Interactive path: begin/end progress exactly once per successful run (characterization or injectable).
4. Auto-run path: invokes write **without** `beginHomeRun` / progress API (module graph test, not only `rg` on future files).
5. Grep until U3 lands: include `src/plugin/main.ts` auto-run call sites for `beginHomeRun`.
6. `npm run build` green.

**Depends on:** U0; preferably after U1 if end-of-run mirror calls coordinator (can mock/wrap either order if wrappers stable).

---

### U3. Auto-run, backfill, dev spikes peel

**Goal:** Finish main mass reduction; leave lifecycle + settings + thin wrappers.

**Prefer split PRs:** **U3a** autoRun (depends U2) · **U3b** backfill + devSpikes (parallel, lower risk). Line-count gate after both land.

**Work:**

- `src/plugin/autoRun.ts` — `scheduleAutoRunLifecycle`, `maybeAutoRun`, `countPastUnprocessed`, enable-from-home glue (gates stay in `platform/autorun.ts`); document `autoRunInFlight` ownership.
- `src/plugin/backfillRuns.ts` — estimate + confirm + **`executeBackfillBatch`** + `runBackfillFlow`; document `backfillInFlight`.
- `src/plugin/devSpikes.ts` — classify-first, spikes, secret probe, log context prefix, list unprocessed helpers used only by dev commands.
- Secret probe / spikes remain behind `ATOMS_DEV_COMMANDS === true` (missing define = off); `commands.ts` gate unchanged.
- Secrets stay on plugin (args only into modules).
- Target: `main.ts` ≤ 1000 lines after U1–U3. **Contingency:** if still >1000 with concerns separated, peel onload/settings/secrets helpers into `plugin/lifecycle.ts` before DoD — or waive with STATUS note citing KTD7 (concerns separated, residual is lifecycle).

**Files:**

- Create: modules above
- Edit: `src/plugin/main.ts`, `src/plugin/commands.ts` only if needed for imports
- Tests: `test/autorun.test.ts` + any backfill tests; preserve stamp-on-success semantics (`docs/solutions/logic-errors/autorun-stamp-on-attempt-blocks-same-day-retry.md`)

**Test scenarios:**

1. Autorun gate tests pass; stamp semantics unchanged; **never today** still holds (F2).
2. Backfill tests pass if present; batch execute in-flight guard preserved.
3. Dev commands fail-closed without `ATOMS_DEV_COMMANDS`.
4. `wc -l src/plugin/main.ts` ≤ 1000 (or documented contingency).
5. `npm test` + `npm run build`.

**Depends on:** U2 for U3a (auto-run calls filing write path).

---

### U4. Home actions peel (+ optional U4b render split)

**Goal:** `AtomsHomeView` is a projection for **mutations**; optional follow-on thins render mass.

**U4 work (actions):**

- Add `src/home/inviteActions.ts` (and/or `home/libraryActions.ts` for created-order backfill).
- Move vault writes: person invite accept, entity hub create, peer upgrades, optional hub projection trigger, `scheduleAskMirrorSync` after mutations, `backfillCreatedOrder` FM-only modify.
- **Action API boundary:** no `HTMLElement` / leaf types in action modules; view may only call actions (no inline `vault.modify` for these flows). Preserve RMW patterns (`docs/solutions/logic-errors/read-modify-write-lost-update-synced-file.md`).
- View keeps card UI + calls actions with `app`/`vault`/plugin callbacks.
- Do not move pure models already in `atomsHomeData.ts`.
- **Hard gate:** `atomsHomeView.ts` ≤ **~1800** lines after U4 (invite peel alone cannot hit 1000 — render/load dominate).

**U4b (optional same epic or follow-on):** extract `render*` / load helpers into `home/render*.ts` / load modules until ≤ **~1000**. Required only if epic DoD insists on home ≤1000; otherwise track as follow-on Issue.

**Files:**

- Create: `src/home/inviteActions.ts` (± libraryActions; U4b render modules)
- Edit: `src/home/atomsHomeView.ts`
- Tests: `test/personInvite*.ts`, entity invite tests, atomsHomeData tests; action RMW unit coverage where pure planning extracted

**Test scenarios:**

1. Person invite vault-smoke / unit tests pass.
2. Entity invite tests pass.
3. No `pipeline` import of `home/`.
4. `wc -l src/home/atomsHomeView.ts` ≤ 1800 (U4); ≤ 1000 only if U4b done.
5. `npm test` + `npm run build`.

**Depends on:** U0; can parallel U1–U3 if STATUS hot files split (`atomsHomeView` vs `main`).

---

### U5. ClassificationResult contract freeze (**semantic unit**)

**Goal:** Dual-surface drift becomes a failing test; enrich order is explicit. **Not move-only.**

**Priority note:** May merge **before or parallel** to peels after U0 (low file overlap). Prefer early if multiplayer wants classify safety before main churn.

**Work:**

1. Document canonical fields (`src/shared/types.ts` + schema in `classify.ts` or `src/shared/classificationSchema.ts`).
2. Expand dual-import tests (`test/classificationContract.test.ts`):
   - Import plus `classifyTemplate.mjs`
   - Assert full schema `required` / `properties` key set + people role enum parity
   - Assert locked hard-rules phrases (incl. “You output ONLY …” **people** line) — fix plugin omission
   - Commit an explicit **locked-subset allowlist** (file or const) so “parity” is not vague
3. Audit `classifyCapture` vs `applyClassificationQuality` enrich order; export named list(s) + tests (one canonical or two intentional).
4. **Out of U5 DoD:** golden JSON fixtures (follow-up; synthetic only if ever added).
5. Prefer generate-one-source when cheap; until then language = **parity freeze**, not SSOT.
6. Model contract snippet in `architecture.md` (`people`, `hub_section`) — or leave to U7.

**Files:**

- Edit: `src/pipeline/classify.ts`, maybe `src/shared/*`, `plus-service/src/classifyTemplate.mjs`
- Create/edit: `test/classificationContract.test.ts`
- Edit: plus-service tests if needed
- Docs: model contract lines optional here

**Test scenarios:**

1. Dual schema parity fails if either surface drifts.
2. Prompt hard-rules locked phrases parity (people included).
3. Enrich stage order test(s) fail on silent reorder.
4. Root `npm test`; `plus-service` `npm test` green.
5. **If prompt text changes:** version bump + dual deploy (Fly) checklist in PR; **no** mechanical QA skip for classify behavior.

**Depends on:** U0; can parallel peels.

**Version:** bump when prompt/schema product behavior changes.

---

### U6. Remove `askMirrorHashes` from synced settings

**Goal:** Kill multi-device footgun — field gone from `LinkerSettings`; wipe/migrate device-local only.

**Prefer:** land as **U1 tail** (same PR as Ask coordinator) or with U7 — not a lonely seventh code PR.

**Work:**

- Confirm migrate-off still clears legacy once (coordinator).
- Remove from type + defaults in `src/shared/types.ts`.
- **Edit wipe path in `src/settings/settings.ts`** — stop assigning `settings.askMirrorHashes`; clear device LS hashes/status only.
- Grep all writes; keep one-shot migrate read via legacy cast if needed then drop.
- CI/grep gate: no new `askMirrorHashes` writes to settings/saveData.

**Files:**

- Edit: `src/shared/types.ts`, `src/settings/settings.ts`, `src/plugin/main.ts` or askCoordinator, settings-shape tests

**Test scenarios:**

1. Legacy settings hashes → LS; settings field emptied; **saveData payload has no `askMirrorHashes` key**.
2. Fresh defaults have no key; wipe does not re-embed the map.
3. `npm test` + build.

**Depends on:** U1 (Ask ownership clear).

---

### U7. Architecture honesty pass

**Goal:** Agents and humans stop learning a false runtime map.

**Work:**

- **Early (any PR):** runtime pipeline rename only (stable names):

```
Shortcut → Atoms System/Inbox.md → drainInbox
  → past dailies → parseCaptures
  → runDryRun | runWritePath
       → context → classifyCapture → planWrite → applyWrite
```

- **Final U7 only:** full module map (`graph/`, `platform/*`, inbox, personInvite, refreshAtoms, entity orbits, dual deployables, `plugin/` run modules). Avoid half-updated module maps mid-epic.
- Dependency rule restated; model contract includes `people`, `hub_section`.
- Optional: stale solutions paths; review doc “addressed by plan” link; CLAUDE seams if paths renamed.

**Files:**

- Edit: `docs/architecture.md`
- Optional: `CLAUDE.md`, solutions path fixes, review link

**Test scenarios:** none code — AE4 read-through.

**Depends on:** module map after U1–U4 names exist; runtime diagram can land early.

---

## Verification Contract

| Gate | Command / check |
|---|---|
| Unit tests | `npm test` |
| Typecheck + bundle | `npm run build` |
| Plus (U5+) | `cd plus-service && npm test` (or repo’s documented script) |
| Line counts | `wc -l src/plugin/main.ts src/home/atomsHomeView.ts` → both ≤ 1000 |
| Dependency rule | `rg "from ['\\\"].*/(home|resurface|settings|ui|plugin)/" src/pipeline` → no matches |
| Command ids stable | Diff `src/plugin/commands.ts` command ids empty |
| Auto-run silent | No progress API on auto-run path (test preferred); `rg beginHomeRun` includes `main.ts` until U3a lands, then autoRun/filingRuns |
| Optional CLI | `./scripts/verify.sh` when Obsidian + test vault open |
| Ask dogfood (U1) | **Required** on demo/test vault — Sync now + edit atom; server count status |
| Shipping tail | U1–U4 pure peels: mechanical QA skip OK (`N/A — no UI`) if behavior-neutral. **U5 prompt change:** full shipping discipline + version + Fly. |

**Execution direction:** characterization-first — green baseline, move code, green again. No TDD of new product behavior. Test-first only for new pure helpers (enrich order list, contract asserts).

---

## Definition of Done

### Global

- [ ] All units U0–U7 merged (or explicitly deferred with STATUS note)
- [ ] `main.ts` ≤ 1000 lines (or documented contingency)
- [ ] `atomsHomeView.ts` ≤ 1800 after U4; ≤ 1000 only if U4b
- [ ] R1–R11 satisfied
- [ ] architecture.md runtime + module map honest
- [ ] Classify dual-surface parity tests green; enrich order audited
- [ ] `askMirrorHashes` removed from synced settings; wipe/LS tests green
- [ ] U1 Ask glue characterization + demo-vault dogfood checked in PR
- [ ] No pipeline → UI imports
- [ ] Extracted modules single-concern (review checklist)
- [ ] STATUS cleared after merge
- [ ] Compound: short learning in `docs/solutions/architecture-patterns/` (orchestration peel pattern)

### Per unit

- [ ] Claimed before code
- [ ] Tests + build green
- [ ] No drive-by product features
- [ ] PR body: `Closes #…` when Issue-scoped; Test plan checked with real runs

---

## Appendix

### Mass baseline (2026-08-04 survey)

| File | ~Lines |
|---|---|
| `src/home/atomsHomeView.ts` | 2331 |
| `src/plugin/main.ts` | 2171 |
| `src/settings/settings.ts` | 1294 (stretch peel — out unless needed) |
| `src/pipeline/classify.ts` | 971 |

### main.ts concern map (extract targets)

| Concern | Dest module |
|---|---|
| Ask events + sync + outbox | U1 askCoordinator |
| Process / Preview / Update / progress / land peak | U2 filingRuns |
| Auto-run | U3 autoRun |
| Backfill | U3 backfillRuns |
| Dev spikes / fixtures / probes | U3 devSpikes |
| onload, settings, secrets, thin wrappers | stay on AtomsPlugin |

### home concern map

| Concern | Dest |
|---|---|
| Pure models | already `atomsHomeData` |
| Progress/land peak UI API | stay on view (called by plugin) |
| Invite/hub/created-order vault writes | U4 inviteActions |
| Render tree | stay on view |

### Prior art

- Hybrid layout plan U3 incomplete: `docs/plans/2026-07-16-017-refactor-hybrid-src-layout-plan.md`
- Ask parity: `docs/plans/2026-07-27-005-feat-ask-mirror-parity-plan.md`, `docs/solutions/architecture-patterns/ask-mirror-parity.md`
- Dual import seed: `test/classifierPeople.test.ts`
- Architect agenda: `docs/reviews/2026-08-04-systems-architect-read.md`

### Suggested PR slices

| PR | Units | Hot files |
|---|---|---|
| 1 | U0+U1 (+ U6 preferred) | main, askCoordinator, types, settings wipe path |
| 2 | U2 | main, filingRuns |
| 3a | U3a autoRun | main, autoRun |
| 3b | U3b backfill+devSpikes | main, backfillRuns, devSpikes |
| 4 | U4 (± U4b) | atomsHomeView, inviteActions |
| 5 | U5 (parallel anytime after U0) | classify, classifyTemplate, contract tests |
| 6 | U7 (+ U6 if not in PR1) | architecture.md; types/settings if U6 late |

Smaller stacks OK; do not combine Ask peel + home invite + classify prompt in one PR.

### Doc-review residual (settled)

Applied 2026-08-04: safe_auto + **POV 1B·2A·3A** (see Settled decisions). U4b out of epic DoD; U5 first; parity-only freeze.
