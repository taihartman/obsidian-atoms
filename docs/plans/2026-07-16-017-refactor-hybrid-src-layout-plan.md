---
title: "refactor: hybrid src layout (pipeline + features + thin plugin shell)"
date: 2026-07-16
type: refactor
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
origin_issue: 21
doc_review: "2026-07-16 LFG headless (coherence + feasibility)"
---

# refactor: hybrid src layout (pipeline + features + thin plugin shell)

## Goal Capsule

Restructure `src/` so **new features have an obvious home**, **`main.ts` is a thin plugin shell**, and the **filing pipeline stays a protected core**. Behavior, public commands, vault writes, and user-visible UI **unchanged**. Tests and production build stay green.

**Authority:** `CLAUDE.md` non-negotiables · `docs/architecture.md` · this plan · Issue #21.

**Stop when:** target tree exists, imports resolve, `main` is a router (&lt;~400 lines or clearly non-orchestrating), architecture module map updated, `npm test` + `npm run build` pass.

---

## Product Contract

### Actors

| ID | Actor |
|---|---|
| A1 | Implementer / coding agent |
| A2 | Future multiplayer agents placing new code |

### Requirements

| ID | Requirement |
|---|---|
| R1 | **Hybrid layout** (not Clean Architecture, not pure package-by-feature): `pipeline/` + feature folders + thin `plugin/` shell + `shared/` + `platform/`. |
| R2 | **Behavior unchanged** — no product feature work in this PR. Same commands, same classify/write/home/resurface semantics. |
| R3 | **`plugin/main.ts` is a router** — onload/onunload, register view/settings/commands, wire deps. No classify loops, no marker writes, no home DOM. |
| R4 | **Dependency rule:** `pipeline` never imports `home`, `resurface`, `settings`, or `plugin`. Features may import `pipeline` + `shared` + `platform`. |
| R5 | **Mechanical moves preferred** — `git mv` + import fix; extract only enough from `main` to satisfy R3. |
| R6 | **Docs:** `docs/architecture.md` module map + “where code goes” rules; `CLAUDE.md` seams list updated to new paths. |
| R7 | **Verify:** `npm test` + `npm run build` green; optional `./scripts/verify.sh` if Obsidian CLI available (non-blocking if vault closed). |
| R8 | **Version:** no user-visible product change → **no** version bump required unless implementer touches user-facing strings (should not). |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | `src/plugin/main.ts` (or `src/main.ts` re-export) is entry; esbuild still bundles. |
| AE2 | `classify.ts` lives under `pipeline/`; home under `home/`; enrich under `pipeline/enrich/`. |
| AE3 | Import graph: no `pipeline/*` file imports from `home/` or `settings/`. |
| AE4 | Existing unit tests pass without behavior rewrites (path-only test import updates OK). |
| AE5 | Agent reading architecture knows where a new enrich step vs new home card goes. |

### Scope Boundaries

**In**

- Folder creation + file moves + import updates  
- Extract command registration + orchestration helpers out of fat `main`  
- Architecture / CLAUDE path updates  
- STATUS claim for multiplayer  

**Out**

- Product features (quality stamp, new UI)  
- Context shortlist / BM25  
- Full Clean Architecture ports/adapters  
- Renaming public plugin id / command ids  
- Reformatting unrelated code  

---

## Planning Contract

### Settled decisions (session)

| KTD | Decision | Class | Rejected | Reason |
|---|---|---|---|---|
| KTD1 | Hybrid: `pipeline/` + feature pkgs + thin `plugin/` | user-approved | Full Clean Architecture | Too much ceremony for single-bundle plugin |
| KTD2 | Hybrid over pure package-by-feature alone | user-approved | Feature-only packages | Pipeline stages are shared; pure features would cross-import |
| KTD3 | Keep business logic out of main | user-directed | Keep growing main | Expansion risk #1 |
| KTD4 | Phased mechanical restructure, this PR delivers full target tree | user-approved (LFG) | Multi-PR only skeleton | One coherent layout is easier for agents than half-moved tree |
| KTD5 | esbuild entry may stay `src/main.ts` via thin re-export of `plugin/main` | planner | Change build config first | Fewer moving parts; entry path stable |

### Target tree

```text
src/
  main.ts                 # re-export default from plugin/main (esbuild entry)
  plugin/
    main.ts               # Plugin class: lifecycle + wire-up only
    commands.ts           # addCommand registrations → call services
  pipeline/
    parse.ts
    context.ts
    classify.ts
    render.ts
    write.ts
    preview.ts
    backfill.ts
    daily.ts
    vocabulary.ts
    enrich/
      people.ts
      media.ts
      linkQuality.ts
      ideaRescue.ts
  home/
    atomsHomeView.ts
    atomsHomeData.ts
    runProgress.ts
  resurface/
    resurface.ts
  settings/
    settings.ts
    captureShortcut.ts
  platform/
    autorun.ts
    connectivity.ts
  shared/
    types.ts
```

### Technical approach

1. Create dirs; `git mv` files into place.  
2. Bulk-update relative imports (`./x` → `../shared/x`, etc.) across `src/` and `test/`.  
3. Split `main.ts`:  
   - Keep Plugin class in `plugin/main.ts` with fields needed by home (`settings`, progress callbacks, run*FromHome).  
   - Move `registerCommands` + large private run* methods that are pure orchestration into `plugin/commands.ts` **or** keep methods on class but defined in a mixin-style module that receives `plugin` — prefer **methods stay on class for Obsidian binding, bodies live in command modules that take `AtomsPlugin`**.  
4. Ensure `atomsHomeView` imports plugin type from `plugin/main` without cycles: use `import type` and ensure home does not load pipeline through main.  
5. Update architecture + CLAUDE.  
6. Run tests/build.

### Risks

| Risk | Mitigation |
|---|---|
| Circular imports (home ↔ main) | `import type` for plugin; home calls only public methods on plugin instance |
| Missed import after move | `npm run build` (tsc) fails loud |
| Accidental behavior change | No logic edits in moved files beyond import paths; extract-only for main |
| esbuild entry break | Keep `src/main.ts` re-export |

### Assumptions

- esbuild entry is `src/main.ts` (verify in `esbuild.config.mjs`).  
- Test imports use relative paths from `test/` to `src/`.  

---

## Implementation Units

### U1. Move files into hybrid tree + fix imports

**Goal:** Target tree exists; project typechecks.

**Files:** all `src/**`, `test/**`, `esbuild.config.mjs` (read-only unless entry change needed)

**Approach:** `git mv`; fix imports; keep `src/main.ts` as re-export if plugin moved.

**Test scenarios:**

- T1: `npm run build` succeeds  
- T2: `npm test` succeeds  

**Verify:** build + test green.

### U2. Thin plugin shell — extract command registration

**Goal:** `registerCommands` and command callbacks live in `plugin/commands.ts` (or equivalent); `plugin/main.ts` calls `registerAtomsCommands(this)`.

**Files:** `src/plugin/main.ts`, `src/plugin/commands.ts` (new)

**Approach:** Move `addCommand` blocks; callbacks still call plugin methods (may remain on class for now).

**Test scenarios:**

- T1: build green  
- T2: command ids strings unchanged (grep manifest/docs if listed)

**Verify:** build; grep command ids stable.

### U3. Thin plugin shell — extract bulk orchestration from main

**Goal:** Large private run methods (list unprocessed, dry-run, process, backfill, spikes, connectivity) move to modules under `plugin/` (e.g. `plugin/runs.ts`, `plugin/devSpikes.ts`) taking `AtomsPlugin` or a narrow deps interface. `main` only wires.

**Files:** `src/plugin/main.ts`, new `src/plugin/*.ts`

**Approach:** Prefer cut-paste of methods into functions `export async function runProcessUnprocessed(plugin: AtomsPlugin, …)`. Plugin class becomes thin wrappers if home needs `this.runX`.

**Test scenarios:**

- T1: existing unit tests green (orchestration mostly untested — characterization = build + test)  
- T2: line count of `plugin/main.ts` substantially below prior 1300 (target &lt; 400; stretch &lt; 300)

**Verify:** `wc -l src/plugin/main.ts`; build + test.

### U4. Architecture + agent rails

**Goal:** Docs match tree; agents know placement rules.

**Files:** `docs/architecture.md`, `CLAUDE.md` (seams + module map), optionally `AGENTS.md` one-liner

**Approach:** Replace module map; add “Where does new code go?” table; dependency rule KTD.

**Test scenarios:** none (docs)

**Verify:** paths in docs exist on disk.

### U5. Multiplayer claim hygiene

**Goal:** Issue #21 + STATUS row + draft PR for this branch.

**Files:** `STATUS.md`

**Verify:** STATUS lists this work; PR open.

---

## Verification Contract

```bash
npm test
npm run build
# optional if Obsidian open:
./scripts/verify.sh
```

Dependency check (manual): no `from "../home` or `from \"../home` inside `src/pipeline/`.

## Definition of Done

- [ ] U1–U4 complete  
- [ ] `npm test` + `npm run build` green  
- [ ] `plugin/main.ts` (or residual main) is router-scale  
- [ ] architecture + CLAUDE updated  
- [ ] Draft/ready PR with plan link  
- [ ] No product behavior changes intentional  

## Confidence

**High** for mechanical move. **Medium** for main extraction without cycles — mitigate with `import type` and function modules.
