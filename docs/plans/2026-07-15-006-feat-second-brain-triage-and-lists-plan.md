---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
title: "Second brain triage and list dumps - Plan"
date: 2026-07-15
type: feat
---

# Second brain triage and list dumps - Plan

## Goal Capsule

**Objective:** Align Atoms with a second-brain identity: dump freely, file list/memory material as atoms, mark pure logistics as noise, soft-retire the invisible “task” class — so the library becomes the brain you can search, while full recall (stream + collections) is named but not built in the first ship.

**Product authority:** This Product Contract. Architecture north star (Capture → File+link → Resurface) remains the long-term frame; this contract sets **first-ship** vs **later-loop** boundaries.

**Open blockers:** None for planning the first ship. Resurface UX and collection hubs are deferred product work, not planning blockers for triage/list filing.

---

## Summary

Atoms is a second brain, not a task app. The full product story is dump → file durable dumps as atoms → later recall via library/search, collections, and a resurfacing stream. **First ship** only fixes **filing**: list/media/preference dumps become atoms; pure chores become noise; `task` stays in the schema for existing markers but is soft-retired in classify guidance. One capture → one atom (not append-into Movies.md). Home library remains atoms-only.

---

## Product Contract

### Problem Frame

Users dump life into dailies (shows, movies, preferences, thoughts). Today the model can classify list-like dumps as **task**, which writes only `<!--linker:task-->` and never appears in Atoms home — so the “brain” has nothing to recall. External task apps already own chores. Without better triage, dumping feels lossy even when Process “succeeds.”

### Actors

| ID | Actor | Role |
|---|---|---|
| A1 | Solo vault owner (mobile-primary) | Captures via shortcut/daily; runs Preview/Process; browses Atoms home |
| A2 | (Future) same user on recall | Opens stream/collections — out of first-ship UI, in product story |

### Key Flows

| ID | Flow | First ship? |
|---|---|---|
| F1 | Dump list/media/preference → Process → atom in library + atom marker | Yes |
| F2 | Dump pure logistics → Process → noise marker only, no library row | Yes |
| F3 | Preview shows honest verdicts (atom/noise; task rare) | Yes |
| F4 | Open Movies collection / surprise resurface | No — deferred |

### Requirements

| ID | Requirement |
|---|---|
| R1 | List, media, watch/read/want, preference, and other **memory-worthy** dumps classify as **atom** (not task, not noise when content is keepable). |
| R2 | Pure logistics / chore captures classify as **noise** (not task by default). |
| R3 | **Soft-retire task:** schema and existing `<!--linker:task-->` markers remain valid processed state; classify guidance steers away from task except as a rare last resort if ever still emitted. No task inbox UI. |
| R4 | **One atom per dump** for list items: each capture becomes its own atom with a declarative title; body remains verbatim. |
| R5 | Prefer tags from Active vocabulary (and product-leaning labels such as media/watch/list when present or proposed carefully); do not invent a flood of tags. Linking to existing vault titles/hubs when they exist is good; **do not require creating Movies.md** or append-into-user-notes. |
| R6 | Atoms home library stays **atoms only** — no task/noise primary rows. |
| R7 | Product copy (settings, empty/help, or Preview language) may state that Atoms files memory, not to-dos — optional polish in first ship if cheap. |
| R8 | Re-run over already-marked captures remains 0 API when markers present (including historic task markers). |

### Acceptance Examples

| ID | Example |
|---|---|
| AE1 | Capture `- watch Past Lives` → Process → atom appears in Atoms library (title declarative; body has original text); marker is atom form, not `<!--linker:task-->`. |
| AE2 | Capture `- buy milk` → Process → noise marker only; no new atom file. |
| AE3 | Capture `- Severance S2` / show-list phrasing → atom, not noise/task. |
| AE4 | Existing daily with `<!--linker:task-->` still counts as processed; no reclassify loop. |
| AE5 | After first ship, user can find list atoms via Atoms home + Obsidian search without a Movies UI. |

### Key Decisions

| ID | Decision | Notes |
|---|---|---|
| KD1 | Full brain loop is the product story; first ship is **filing only** | (session-settled: user-directed — chosen over triage-only-without-story and over thin-slice-of-all-three first: eventually stream+collections+library, first release must make lists into atoms) |
| KD2 | Soft-retire task in classify; keep schema for legacy markers | (session-settled: user-directed — chosen over kill-task-soon and keep-task-as-common: avoid schema churn; no task inbox) |
| KD3 | One atom per dump for list items | (session-settled: user-directed — chosen over append-into-list-note and hub-note-plus-atom first ship) |
| KD4 | Pure logistics → noise | (session-settled: user-directed — chosen over rare-task-ok and atom-if-dumped: keep library high-signal; tasks live elsewhere) |
| KD5 | Brain, not task app | (session-settled: user-directed — chosen over competing with Reminders/Things: external apps own chores) |
| KD6 | Resurface stream + collection browse stay **later legs** of the same loop | Named in architecture; not first-ship UI |

### Scope Boundaries

**In (first ship)**

- Classify guidance / prompt / triage policy for list-memory vs logistics
- Active vocabulary and proposed-tag behavior for list/media domains as needed
- Preserve marker compatibility for atom / task / noise
- Optional minimal copy so “task” is not a user-facing promise

**Deferred for later**

- Resurfacing stream (on-this-day, connected-to-recent, age-on-recall)
- Collection / Movies / Shows hub UI and “open list view”
- Kill-task schema migration (atom \| noise only)
- Append-into user list notes; folder intelligence; always-on headless beyond existing auto-run
- Integration with external task apps

**Outside this product’s identity**

- Replacing Reminders/Things/Linear as a to-do system
- AI rewriting capture bodies into polished notes
- Auto-filing into arbitrary user folders

### Success Criteria

- List dumps like shows/movies/want-to show up as **atoms in the library** after Process (AE1, AE3).
- Chores do not pollute the library (AE2).
- Historic task markers remain safe (AE4).
- User understands Atoms as memory filing, not a hidden task list.
- Product story documents the full loop so resurface/collections plans don’t restart identity debates.

### Outstanding Questions

**Resolve before planning:** none.

**Deferred to planning**

- Exact prompt wording and vocabulary seed list for media/watch/list
- Whether any settings copy ships in the same unit as classify changes
- How strongly to penalize residual task emissions in tests/evals
- Version bump and regression suite for fixture classify samples

### Assumptions

- Solo personal vault; mobile-primary capture via existing shortcut.
- User keeps a real task app for logistics; noise is the right silent sink.
- Search + home library is acceptable recall until resurface ships.
- Existing atom render/marker pipeline is sufficient; first ship is intelligence + policy, not new write types.

### Sources

- Dialogue (2026-07-15): brain vs tasks; full loop vs first ship; soft-retire task; one atom per dump; logistics → noise
- `docs/architecture.md` — three-leg north star; resurface deferred; verdict table
- `docs/spec-amendments.md` — marker design for task/noise; rot / stream language
- `docs/solutions/architecture-patterns/home-native-progress-long-api-runs.md` — home as control surface
- `docs/solutions/logic-errors/marker-line-drift-batch-process.md` — process reliability
- Grounding dossier: `/tmp/compound-engineering/ce-brainstorm/brain-164457/grounding.md` (session scratch)

---

## Planning Contract

**Product Contract preservation:** Product Contract unchanged (requirements from ce-brainstorm).

**Depth:** Lightweight first ship — prompt + vocabulary + tests + version; no schema kill, no resurface UI.

### Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Soft-retire task via SYSTEM_PROMPT + schema description only | (session-settled: user-directed — schema stays for legacy markers) |
| KTD2 | Seed default Active vocabulary with media/list tags: `watch`, `movie`, `show`, `media`, `list` | Helps tags[] land without proposed_tag flood |
| KTD3 | No append-into Movies.md; no new write path | One atom per dump |
| KTD4 | Version **0.4.3** | Prompt/vocab is user-visible intelligence change |
| KTD5 | Characterise triage policy with unit tests on SYSTEM_PROMPT / schema strings | Live model eval is out of band; string contract is the shippable proof |

### Implementation Units

### U1. Classify triage prompt + schema copy

**Goal:** Model guidance matches second-brain first ship.

**Requirements:** R1–R4, R8, KD2–KD4  

**Files:**
- Modify: `src/classify.ts` — `SYSTEM_PROMPT`, `CLASSIFICATION_SCHEMA.properties.verdict.description`
- Test: `test/classify.test.ts`

**Approach:** Rewrite triage section: atom includes list/media/want/preference; noise for pure logistics; task rare/discouraged (legacy only). List dumps get declarative titles. People rule: chores stay noise, not person atoms.

**Test scenarios:**
- SYSTEM_PROMPT contains soft-retire language and list-as-atom guidance
- SYSTEM_PROMPT steers buy-milk style examples to noise, not task-as-default
- Schema description no longer presents task as equal first-class default
- Existing invariant tests still pass (atom needs title; task/noise empty title)

**Verification:** vitest classify tests green.

### U2. Default vocabulary seeds

**Goal:** New installs (and DEFAULT_SETTINGS) include list/media tags.

**Requirements:** R5  

**Files:**
- Modify: `src/types.ts` — `DEFAULT_SETTINGS.activeVocabulary` and spike vocabulary if needed
- Test: optional assert in classify or settings-adjacent; or pure export check in existing types-adjacent test if any — add to `test/classify.test.ts` or small types assertion

**Approach:** Add `watch`, `movie`, `show`, `media`, `list` without removing existing tags. Existing vaults keep their saved data.json vocab until user adds tags — document in architecture one-liner; optional migration is **out of scope** (avoid rewriting user vocab).

**Verification:** DEFAULT_SETTINGS includes the new tags.

### U3. Architecture + CONCEPTS + version 0.4.3

**Goal:** Durable docs and identifiable build.

**Requirements:** R6–R7 (docs), KTD4  

**Files:**
- `docs/architecture.md` — verdict/product stance one-liner
- `CONCEPTS.md` — already partially updated
- `package.json`, `manifest.json`, `versions.json`
- Optional: settings description one-liner if a Privacy/About string exists without redesign

**Verification:** build + tests; version 0.4.3 in manifest.

### Verification Contract

| Gate | Pass |
|---|---|
| Unit | Prompt/schema contract tests + existing classify suite |
| Build | `npm test` + `npm run build` |
| Manual (optional) | Preview on “watch X” / “buy milk” fixtures if API key present |

### Definition of Done

- U1–U3 complete
- AE1–AE4 intent covered by prompt contract + marker compatibility unchanged
- No task schema removal
- No resurface UI

### Deferred to Follow-Up Work

- Resurfacing stream
- Collection hub UI
- Kill-task schema migration
- Migrating existing user Active vocabulary automatically
