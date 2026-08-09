---
title: "Hub projection for any hub - Plan"
date: 2026-08-09
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
type: feat
issue: 390
branch: feat/hub-projection-any-hub
module: pipeline/hub-projection
tags:
  - hub-projection
  - list-hubs
  - movies
  - classify
---

# Hub projection for any hub - Plan

## Goal Capsule

**Objective.** When Hub projection is on, the managed atom list writes to **any qualifying hub** (not only person hubs)—so a hand-authored Movies watchlist with `##` sections fills the same way a person hub does—while atoms stay flat and bodies stay sacred.

**Product authority.** Constitution write-type (d) and `docs/spec-amendments.md` managed-hub carve-out today say **person hubs only**; this feature widens that carve-out via the same PR family. Prior plan: `docs/plans/2026-07-28-001-feat-hub-projection-plan.md` (person-only ship; non-person deferred). Lists filing still creates one atom per dump (`docs/plans/2026-07-15-006-feat-second-brain-triage-and-lists-plan.md` KD3).

**Open blockers.** None. OQ1–OQ3 resolved below as KTDs.

**Product Contract preservation:** unchanged R/AE IDs from requirements-only; planning added R-trace KTDs only.

**Lane.** Full feature (constitution + pipeline + settings + classify). Claim Issue + STATUS + draft PR before code.

---

## Product Contract

### Summary

Extend opt-in hub projection so list hubs (Movies, packing lists, gift boards on person notes, etc.) get the same delimiter-bounded atom index person hubs already get. Membership stays hard links from atoms. Placement stays the user's existing `##` headings (or Unsorted). Classify context for sections is **broader** than projection targets so a first Movies link can form. Toggle-on runs one full regen for hubs that already have members; Notice is honest about filled vs skipped. Upgrade path tells already-on users that list hubs are now included.

### Problem Frame

Users keep list memory in hub notes (watchlists, trips, gift ideas). Process correctly creates atoms, but the hub body stays empty unless the note is a **person hub** and projection is on. Movie watchlists never qualify under person discovery. Soft keys (`movies`, `shows`, `watchlist`) also block orbit/invite paths, so “Make Movies?” never creates a substitute. The gap is hub **identity** and classify **context**, not the splice algorithm.

### Users

- Atoms users who already maintain (or will create) list-shaped notes with headings and want Process to keep those lists current.
- Same users who already use person-hub projection for gifts/preferences—behavior should stay familiar under one toggle.

### Requirements

| ID | Requirement |
|----|-------------|
| R1 | `enableHubProjection` remains default **off**. No silent vault writes when off. |
| R2 | When on, projection may write the managed block on any **qualifying hub**, not only person hubs. |
| R3 | A note is a **projection candidate** when outside denied paths **and** either (a) is a person hub under today's discovery rules, **or** (b) is hard-linked from ≥1 atom link-prose **and** already has ≥1 `##` heading. |
| R3c | **Non-person write brake:** for R3b only, actually write/regen the managed block when **any** of: ≥2 hard-linked member atoms; at least one member has a `hub-section` that matches an H2 on that hub; or the hub already has managed delimiters. A single accidental hard-link + bare Unsorted must not open a new managed block on ordinary outlined notes (Meeting Notes, Projects.md, etc.). Person hubs (R3a) keep today's behavior (no extra brake). |
| R4 | **Deny sets differ by path.** Shared safety deny for all projection: dailies, `Atoms/`, Templates, Archive, hidden/dotfolders. Person path (R3a) may keep the fuller person-discovery denylist. List path (R3b) must **not** blindly deny `Projects/` / `Recipes` / `Plans` solely because person discovery does—trip packing and project boards often live there. |
| R5 | No `hub: true` marker required for old hand-authored hubs. Existing Movies.md with sections works when linked + projection on. |
| R6 | Managed block rules unchanged: delimiters `<!-- atoms:generated v=1 -->` … `<!-- /atoms:generated -->`; human bytes outside sacred; unclosed/orphan delimiters skip that hub; taxonomy never invented by the model. |
| R7 | Membership = junk-filtered link-prose hard links to the hub title. No separate `hub:` field on atoms. |
| R8 | Classify/schema optional field is `hub_section`; atom FM stores `hub-section`. Normalizer fail-closes before FM write. **Per linked hub:** if that hub has the exact H2, place there; else Unsorted **on that hub only**. Shared H2 names across hubs do not force global uniqueness. |
| R9 | **Classify hub-section context** (≠ R3 write targets): person hubs under discovery **plus** non-denied vault notes with ≥1 `##` that are strong title/shortlist candidates for the capture or batch—**hard-link not required**. Must be able to include a real `Movies.md` before any atom links it. Cardinality/ranking = planning (OQ2). |
| R9b | **List-hub link repair (deterministic):** when capture is list/media-shaped and exactly one non-denied vault note with ≥1 `##` is a strong title match (e.g. Movies), post-classify may hard-link that hub and set `hub_section` when a section cue matches—mirror spirit of person/media enrich. AE1 must not depend on prompt luck alone. |
| R10 | Soft entity keys still do **not** alone light Also about / entity-invite orbits. Soft keys must not block hard-linking a real vault note of that title. |
| R11 | Turning Hub projection **from off → on** runs one full regen over atoms → hubs that already have hard-linked members (and pass R3/R3c). Notice names **filled** vs **skipped** (zero members / brake not met)—not “your whole vault is listed.” Does not require re-capture. Unlinked old movie atoms need Process/Update (with R9/R9b) or a later Update pass—not silent membership invention on toggle alone. |
| R11b | **Upgrade disclosure:** if `enableHubProjection` is already true on first run of the widened build, show a one-time calm Notice (and settings callout) that projection now includes list hubs under the same toggle. Do not silently expand write surface with zero UI. |
| R12 | Process, Update notes, and backfill regen **touched** hubs. Person-hub invite accept and entity-invite accept each regen the new hub when it qualifies (entity invite may still need user-added `##` before R3b). |
| R13 | Settings copy drops “person only”; describes list + person hubs, delimiter safety, toggle-on refresh of **already-linked** hubs, and Process/Update for new links. |
| R14 | Constitution + CONCEPTS + architecture hard-stop: managed block on **qualifying hubs**, not person-only. |
| R15 | Body sacred; flat `Atoms/` only; no append outside delimiters; no auto-create of hub notes for projection. |

### Key Decisions

| ID | Decision | Notes |
|----|----------|-------|
| K1 | Widen existing projection pipe (Approach A) | session-settled: user-approved — chosen over separate list-hub system and marker-first. |
| K2 | Projection candidate = person hub **or** (hard-linked + ≥1 `##` + not denied) | session-settled: user-directed — old notes compatible without markers; rejects pure any-hard-link. |
| K2b | Non-person write brake (R3c) | review best-judgment — chosen over confirm dialog and over unrestricted single-link write. |
| K3 | Full regen when toggle turns on for **already-linked** members | session-settled: user-directed magic; **honest scope** from review — not invent membership. |
| K4 | Classify auto-link + section when hub+## fit | session-settled: user-approved — chosen over projection-only and suggest-only. |
| K4b | Deterministic list-hub repair (R9b) | review best-judgment — AE1 not model-only. |
| K5 | Soft keys stay orbit-soft; real titled notes hard-linkable | session-settled: user-approved. |
| K6 | Toggle default stays off | Constitution hard-stop; write-safety. |
| K7 | Already-on upgrade Notice (R11b) | review best-judgment — trust for opt-in write carve-out. |
| K8 | Per-hub `hub_section` placement (R8) | review best-judgment — multi-hub collisions. |
| K9 | List deny set ≠ full person denylist (R4) | review best-judgment — packing under Projects/. |

### Scope Boundaries

**In**

- Projection membership + runner beyond `discoverPersonHubs`-only (R3/R3c).
- Classify hub-section context + list-hub repair (R9/R9b).
- Toggle-on full regen of already-linked hubs + honest Notice; upgrade Notice.
- Person-hub invite accept + entity-invite accept → projection when hub qualifies.
- Constitution/CONCEPTS/settings copy.

**Deferred**

- Auto-creating Movies.md or seeding default H2 taxonomy.
- Soft keys lighting Also about Movies without a real hub.
- Collections UI / Movies shelf in Home.
- Default-on projection.
- Checkboxes, packing progress, append of capture bodies into hubs.
- Toggle-on bulk reclassify of unlinked historical list atoms (use Process/Update + R9b instead).

**Outside product identity**

- Task app / due-date gravity in hub lists.
- Folder intelligence or moving atoms out of flat `Atoms/`.
- Rewriting capture bodies into hub prose.

### Acceptance Examples

| ID | Example |
|----|---------|
| AE1 | Vault has `Movies.md` with `## Want to watch` and `## Watched`. Hub projection on. Capture “want to watch Dune” → Process creates atom, hard-links Movies (model and/or R9b), `hub-section` Want to watch when section matches → managed block lists the atom under that H2. |
| AE2 | Toggle off → on with pre-existing atoms already hard-linked to Movies → full regen fills Movies; Notice reports filled. |
| AE2b | Toggle on with Movies.md present but **no** hard-linked atoms → Notice reports Movies skipped (zero members); no fake full vault fill. |
| AE3 | Note `Essay.md` hard-linked from an atom but no `##` → no managed block. |
| AE3b | Note `Meeting Notes.md` with `## Agenda`, one accidental hard-link, no matching `hub-section`, no prior delimiters → **no** new managed block (R3c). Second member or matching section or existing delimiters → may write. |
| AE4 | Person hub with `## Gift Ideas` keeps working as today when projection is on (no R3c brake). |
| AE5 | Soft key alone does not open Also about Movies; hard link to real `Movies.md` still projects when R3c met. |
| AE6 | Atom hard-links Movies (`## Ideas`) and Alex (`## Ideas`); `hub-section: Ideas` → under Ideas on **both**. Atom with `hub-section: Want to watch` only on Movies → Movies section; Alex Unsorted if linked. |
| AE7 | Already-on upgrade: first open after ship → one-time Notice that list hubs are included. |

### Success Criteria

- [ ] AE1–AE7 hold on throwaway vault with real capture → Process where relevant (not planted theater only).
- [ ] Unit coverage for R3/R3c, R9/R9b, R8 multi-hub placement, toggle-on plan, upgrade Notice gate.
- [ ] Constitution docs no longer claim person-only for the managed block.
- [ ] Settings + upgrade disclosure match behavior.

### Dependencies / Assumptions

- Splice algorithm in `hubProjection.ts` stays the pure core.
- Ask mirror already mirrors linked non-Atoms notes; projection writes remain local vault writes with existing Ask side-effect when mirror is on (full regen may sync more hubs—settings copy may mention).
- Entity invite still creates bare `# Title` hubs; without `##` they do not meet R3b until the user adds headings.

### Outstanding Questions

| ID | Question | Status |
|----|----------|--------|
| OQ1 | Deny-folder split | **Resolved → KTD1** |
| OQ2 | Classify context cardinality | **Resolved → KTD6** (cap 40 + rank) |
| OQ3 | Toggle-on sync vs background | **Resolved → KTD8** (sync + Notice) |
| OQ4 | Explicit “Refresh hub lists” in Update UI | **Deferred** — optional; not required for ship |

### Risks and Open Questions

| Risk | Mitigation |
|------|------------|
| Classify over-links generic titles | Fail-closed `hub_section`; R9b unique-match only; junk reasons; dogfood AE1 |
| Single-link pollution of outlined notes | R3c write brake |
| Toggle-on disappointment | Honest R11 Notice (AE2b) |
| Full regen cost / Ask sync burst | Single pass; Notice; OQ3 |
| Soft-key / invite confusion | Docs: soft = orbit UI; real note + ## = projection |
| Constitution drift | R14 same PR family |

### Constitution touch (same ship)

- `docs/architecture.md` write type (d) + hard-stop line: qualifying hubs, not person-only.
- `docs/spec-amendments.md` managed hub block section retitled/rewritten for qualifying hubs.
- `CONCEPTS.md` **Qualifying hub** + **Managed hub block** (already drafted in worktree; keep aligned with R3/R3c).

### Review log

- 2026-08-09 ce-doc-review: safe_auto + best-judgment applied (bootstrap R9/R9b, honest K3/R11, R3c brake, R8 multi-hub, R4 deny split, R11b upgrade Notice).

---

## Planning Contract

### Technical Approach

Keep `projectHubMarkdown` as the pure splice core. Widen **who loads into the hub Map** and **which titles count as touched**, not the block format.

Split three pure concepts:

1. **Safety denylist** — dailies, `Atoms/`, Templates, Archive, dotfolders (shared).
2. **Person denylist extras** — today's `PERSON_HUB_DENY_FOLDER_PARTS` extras (Projects/Recipes/Plans/…) used only by `discoverPersonHubs` / R3a.
3. **List hub candidates** — non-denied (safety only) markdown notes with ≥1 `##`, resolved by basename title; used for R3b + R9 context + R9b repair.

`runHubProjectionForHubs` loads person hubs (existing) **union** list hubs that appear in `touchedHubTitles` (or all list hubs with members on full regen). Apply R3c before `vault.modify` for non-person paths.

Classify: extend `VaultContext` with list-hub details (or rename `PersonHubDetail` → shared `HubSectionDetail` with `kind`). `normalizeHubSection` / `repairHubSection` / `formatPersonHubsForContext` consume the union. Add `enrichListHubLinks` after media enrich (R9b).

Settings: rename toggle copy; on off→on call full regen; device-local `hubProjectionListAckAt` (or settings field) for R11b one-shot Notice when already on.

### Key Technical Decisions

| ID | Decision | Notes |
|----|----------|-------|
| KTD1 | Shared `pathInSafetyDenylist` + keep person extras separate | Resolves OQ1 / R4. List path must allow Projects/. |
| KTD2 | `hubTitlesFromAtomContents(contents, allowedTitles)` — allowed = person titles ∪ list hub basenames present in vault under safety deny | Touched set no longer person-only. |
| KTD3 | Full regen = `touchedHubTitles` = all titles that have ≥1 membership key among atoms ∩ allowed hub titles | Toggle-on + optional future refresh. |
| KTD4 | R3c evaluated per hub in plan/runner before write | Pure helper `shouldWriteNonPersonHub(entries, hubHasDelimiters)`. |
| KTD5 | R8 multi-hub: when projecting hub H, entry.section applies only if H.sections contains it; else Unsorted for that hub's entry only | `planHubProjection` already per-hub; ensure section filter is per hub not global union drop. |
| KTD6 | R9 context: person details + up to N list hubs (default **40**, same as `PERSON_HUB_TOP_N`) ranked by BM25/title match against batch text when available; always include exact basename hits for media soft titles if file exists | Resolves OQ2 — bound cardinality. |
| KTD7 | R9b `enrichListHubLinks` after `enrichMediaLinks`; unique vault title match only; section cue reuse from `repairHubSection` | Fail closed on 0 or ≥2 title matches. |
| KTD8 | Toggle-on full regen **sync** with Notice (filled/skipped counts); no cancel UI v1 | Resolves OQ3. Huge vaults acceptable for v1; Notice only. |
| KTD9 | R11b: settings field `hubProjectionListDisclosureSeen` default false; on plugin load or settings open, if enableHubProjection && !seen → Notice + set true | Not a new privacy ack version. |
| KTD10 | Entity invite accept calls `runHubProjectionForHubs` when setting on (parity person invite) | R12. |
| KTD11 | Plus `classifyTemplate.mjs` prompt: list hubs + person hubs for hub_section; lockstep tests | Dual-surface parity. |
| KTD12 | Plugin version bump on ship (user-visible) | CLAUDE.md versioning. |

### Dependencies and Risks

| Dep / risk | Handling |
|------------|----------|
| Ask mirror uploads rewritten hubs | Existing path; disclosure already mentions Ask when on |
| Soft-key call sites blocking hard links | Audit `isSoftEntityKey` on link emit paths; R10 — do not filter Movies hard-link in classify enrich |
| Title collision two Movies.md | Prefer unique basename resolve; if multi-path same title, skip list projection for that title (Notice once) — same spirit as person top-N |
| Constitution PR | U6 same branch as code |

### Codebase Patterns to Follow

- Pure plan + vault runner: `runHubProjection.ts` / `hubProjection.ts` / tests
- Person enrich: `enrichPersonLinks` in `people.ts`
- Media shape: `isMediaShaped` / `enrichMediaLinks` in `media.ts`
- Settings toggle + save: `settings.ts` Filing section
- Person invite projection hook: `atomsHomeView.ts` ~1350
- Delimiter constants: `hubSections.ts`

---

## Implementation Units

### U1. Safety denylist + qualify / write-brake pure helpers

**Goal.** Codify R3/R3c/R4 without vault I/O.

**Requirements.** R3, R3c, R4, K2, K2b, KTD1, KTD4

**Dependencies.** None

**Files.**
- Create or extend: `src/pipeline/hubQualify.ts` (or expand `hubSections.ts` / `runHubProjection.ts` pure exports)
- Modify: `src/pipeline/enrich/people.ts` — extract safety vs person deny if cleaner
- Create: `test/hubQualify.test.ts`

**Approach.**
- `pathInSafetyDenylist(path)` — Atoms, Daily, Templates, Archive, Quick Notes, Excalidraw, Tags, Home, Index denylist titles as needed, dotfolders.
- `pathInPersonHubDenylist` keeps today's fuller list (or safety ∪ person extras).
- `shouldWriteNonPersonHub({ memberCount, hasMatchingHubSection, hubHasGeneratedDelimiters })` → boolean for R3c.
- `isListHubCandidate(path, contentOrSections)` — not safety-denied, has ≥1 H2 (or sections array non-empty).

**Test scenarios.**
- Happy: `Projects/Trip.md` safety-ok, person-denied.
- Happy: R3c false for 1 member, no section, no delimiters.
- Happy: R3c true for 2 members OR matching section OR delimiters present.
- Edge: `Atoms/x.md`, daily basename, `.obsidian` → safety deny.
- Edge: empty sections → not list candidate.

**Verification.** `npm test -- hubQualify`

---

### U2. Projection runner: load list hubs + generalized touch titles

**Goal.** Process/Update can project into Movies.md.

**Requirements.** R2, R3, R3c, R5–R8, KTD2–KTD5

**Dependencies.** U1

**Files.**
- Modify: `src/pipeline/runHubProjection.ts` — hub load, `hubTitlesFromAtomContents`, R3c gate, per-hub section apply
- Modify: `test/runHubProjection.test.ts`
- Optionally: `test/hubProjection.test.ts` only if splice behavior changes (should not)

**Approach.**
- `hubTitlesFromAtomContents(contents, hubTitles: string[])` already shape-compatible — pass union list.
- `runHubProjectionForHubs`: after person discover, also resolve each touched title to a vault file (basename match, safety deny, has sections); merge into hubs Map.
- Full-regen mode: `touchedHubTitles` optional omit → compute all titles with membership ∩ known hubs.
- Skip `vault.modify` for non-person when `!shouldWriteNonPersonHub`.
- KTD5: when building entries for hub H, set `section` only if entry.section ∈ H.sections.

**Test scenarios.**
- Happy: plan includes Movies hub entries from hard-linked atoms; person hub still works.
- Happy: R3c blocks single Unsorted-only non-person write.
- Happy: multi-hub shared H2 name places under each hub that has it.
- Edge: missing hub file → error entry, no throw.
- Edge: full regen plan includes only hubs with members.

**Verification.** `npm test -- runHubProjection hubProjection`

---

### U3. Wire call sites (write / refresh / backfill / invites)

**Goal.** Touched titles include list hubs; entity invite projects.

**Requirements.** R12, KTD2, KTD10

**Dependencies.** U2

**Files.**
- Modify: `src/pipeline/write.ts` — pass union hub titles into `hubTitlesFromAtomContents` (not only `personHubs`)
- Modify: `src/pipeline/refreshAtoms.ts` — same
- Modify: `src/pipeline/backfill.ts` — same
- Modify: `src/home/atomsHomeView.ts` — entity invite accept → `runHubProjectionForHubs` when enabled
- Modify: context builders if needed to expose list hub title list for touch (may come from U4)

**Approach.**
- Helper `collectProjectionHubTitles(app | ctx)` used by all sites: personHubs + discovered list hub basenames (or titles from atom membership resolved against vault).
- Prefer computing allowed titles once per run from vault scan (safety + H2) capped if needed.

**Test scenarios.**
- Unit: helper returns Movies when vault has Movies.md with H2.
- Prefer thin tests; vault-smoke optional in U7.

**Verification.** `npm test`; typecheck.

---

### U4. Classify context + normalize + list-hub enrich (R9/R9b)

**Goal.** First “want to watch Dune” can hard-link Movies + section.

**Requirements.** R8–R10, K4, K4b, KTD5–KTD7, KTD11, AE1

**Dependencies.** U1 (list candidate detection)

**Files.**
- Modify: `src/shared/types.ts` — `VaultContext` list hub details (extend `PersonHubDetail` or add `listHubDetails`)
- Modify: `src/pipeline/context.ts` — build list details + format for model
- Modify: `src/pipeline/classify.ts` — prompt language beyond person-only; `normalizeHubSection` / `repairHubSection` union sections; call enrich
- Create: `src/pipeline/enrich/listHubs.ts` — `enrichListHubLinks`
- Modify: `plus-service/src/classifyTemplate.mjs` — lockstep
- Modify: `test/runHubProjection.test.ts` or `test/classify.test.ts`, `test/media.test.ts`, new `test/listHubs.test.ts`
- Modify: `test/classificationContract.test.ts` if prompt freeze lines change

**Approach.**
- Context string: keep person block; add “List hubs” with indented H2s (cap KTD6).
- Prompt: hub_section for person **or** list hubs; never invent section names.
- `enrichListHubLinks(result, capture, listHubs)`: if media/list-shaped and unique basename match among listHubs, ensure link + optional section from cues / existing hub_section normalize.
- Soft keys: do not skip hard-link emit when vault note exists.

**Test scenarios.**
- Happy: Movies in context sections → normalize keeps Want to watch.
- Happy: enrichListHubLinks adds Movies link on “want to watch Dune” with unique Movies.md.
- Edge: two Movies.md paths → no enrich link.
- Edge: soft key alone without file → no link.
- Contract: plus-service template includes list-hub wording parity.

**Verification.** `npm test` + plus-service tests if in monorepo CI.

---

### U5. Settings: copy, toggle-on regen, upgrade Notice

**Goal.** Magic-honest UX for R11/R11b/R13.

**Requirements.** R1, R11, R11b, R13, KTD8, KTD9, KTD12

**Dependencies.** U2–U3

**Files.**
- Modify: `src/settings/settings.ts` — name/desc; onChange off→on full regen
- Modify: `src/shared/types.ts` — `hubProjectionListDisclosureSeen?: boolean` default false
- Modify: `src/plugin/main.ts` — onload check for R11b Notice once
- Modify: `src/pipeline/runHubProjection.ts` — export full-regen helper returning `{ filled, skipped }` counts for Notice
- Bump: `package.json`, `manifest.json`, `versions.json`

**Approach.**
- Copy (directional): “Hub projection” / “When on, Process and Update write a managed list of linked atoms at the end of person and list hub notes (notes with headings you already wrote). Your text outside the markers never changes. Turning this on refreshes hubs that already have linked atoms. Off by default.”
- Notice on enable: `Atoms: updated N hub lists (M skipped — no linked atoms yet)`.
- Upgrade: if `enableHubProjection && !hubProjectionListDisclosureSeen` → Notice once, set flag, save.

**Test scenarios.**
- Unit: full-regen counter math pure if extracted.
- Manual/CLI: toggle on fixture vault — Notice + Movies filled when pre-linked.

**Verification.** `npm test`; `npm run build`; settings smoke on test vault.

---

### U6. Constitution + CONCEPTS + settings inventory docs

**Goal.** R14 — no person-only drift.

**Requirements.** R14

**Dependencies.** Can parallel U1–U5; merge before ship

**Files.**
- Modify: `docs/architecture.md` write type (d) + hard-stop ~187
- Modify: `docs/spec-amendments.md` managed hub section
- Modify: `CONCEPTS.md` (already partially updated in worktree — align R3c)
- Optional: `docs/handoffs/2026-08-05-settings-off-by-default-rationale.md` note if still accurate

**Approach.** PR-only constitution edits on this branch with code.

**Test scenarios.** N/A docs — greppable person-only residual in those three files = fail.

**Verification.** Manual grep `person hubs only` in architecture/spec/CONCEPTS for managed-block claims.

---

### U7. Dogfood + vault smoke AE1–AE7

**Goal.** Product proof on throwaway vault.

**Requirements.** Success criteria, AE1–AE7

**Dependencies.** U1–U6

**Files.**
- Modify/extend: `test/hubProjection.vault-smoke.test.ts` if pure vault fixtures help
- Screenshots: `docs/qa/screenshots/hub-projection-any/` (Movies hub + atom) for PR
- QA note in PR body

**Approach.**
- test_vault: create Movies.md with H2s; Process capture; assert managed block.
- Toggle-on with pre-linked atom; Notice path.
- AE3b Meeting Notes single-link no write.

**Verification.** `./scripts/verify.sh` or focused CLI process; screenshots linked in PR.

---

## Verification Contract

| Gate | Command / action |
|------|------------------|
| Unit | `npm test` (hubQualify, runHubProjection, listHubs, classify/media contract) |
| Typecheck/build | `npm run build` |
| Plus lockstep | plus-service tests if template changed |
| Vault | test_vault Process AE1; toggle AE2/AE2b; AE3b brake |
| Docs | architecture/spec/CONCEPTS no stale person-only managed-block claim |
| Ship | version bump; draft PR `Closes #<issue>`; STATUS row |

---

## Definition of Done

- [ ] All units merged on `feat/hub-projection-any-hub`
- [ ] AE1–AE7 evidence (tests and/or CLI dogfood + screenshots)
- [ ] Constitution docs updated
- [ ] Settings copy + upgrade Notice verified
- [ ] Hard claim: Issue assigned, STATUS, draft PR with `Closes #N`
- [ ] No agent writes to personal Remote Vault

---

## Execution notes for ce-work

- Test-first on U1, U2, U4 pure helpers before vault wiring.
- Characterization: existing `test/hubProjection*.ts` and person-only tests must stay green (person path unchanged).
- Do not flip `enableHubProjection` default.
