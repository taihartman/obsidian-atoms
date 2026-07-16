---
title: Belief Rehearsal OS - Plan
date: 2026-07-16
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
origin: docs/ideation/2026-07-16-open-ideation.html idea "Belief OS"
---

# Belief Rehearsal OS - Plan

## Goal Capsule

**Objective.** When the vault records a changed mind via supersession links, Atoms home makes that change the highest-priority rehearsal moment — old capture body first, newer claim second — plus a one-line subsequent-history ribbon on home open. Soft death (hiding retired claims by default) stays out of this release.

**Product authority.** Extends the existing multi-cue For you stream and reason-bearing links (R16 / KTD9). Does not invent a third write type, rewrite atom bodies, or create a review queue. Design fidelity: committed mocks under `docs/design-handoff/belief-rehearsal/`.

**Open blockers.** None for planning. Supersession density may be low in early dogfood; success criteria treat dormancy as acceptable, not failure.

## Product Contract

### Summary

Belief Rehearsal OS is the first product surface for epistemic rot defense. Classify already emits `revises` / `contradicts` in link reasons; this work makes those edges human-visible as **mind-change rehearsal** (For you hero) and **subsequent history** (home citator ribbon). The dinner-table sentence: *“It’s the second brain that shows me when I changed my mind.”*

### Problem Frame

Append-only filing leaves old confident titles equally live next to new ones. Users may not feel that yet; the product still amplifies rot by design. Second brains often become mausoleums of capture without belief update. The risk is not missing notes — it is trusting the wrong past self when the stream or library re-shows a fossil.

### Actors

- **Primary:** Solo vault owner, mobile-primary, using Atoms home For you and Open into notes.
- **Secondary:** Same user on desktop for dogfood and denser reading; no multi-user.

### Requirements

- R1. When at least one **hard supersession pair** exists (link reason contains revises or contradicts toward another atom title that exists), For you may show a **mind-change hero** card.
- R2. Mind-change ranks **above** on-this-day, connected, and quiet when a candidate pair is available.
- R3. At most **one** mind-change hero per calendar day (device-local), so on-this-day still breathes.
- R4. Card content: **old atom body snippet primary**; one quiet line that the newer claim revised or contradicted it (title or short pointer); actions Open (old and/or new — planning picks interaction detail), Next, and a non-guilt recovery that means “not a mind-change” for this pair.
- R5. Soft throttle applies: Open or Next on a mind-change card dampens re-showing that pair for the existing throttle window; recovery throttle is at least as long as soft throttle for that pair.
- R6. When no hard pair is eligible, **no mind-change card and no empty-state guilt** — fall through to existing cues unchanged.
- R7. **Citator ribbon (home only):** when the user views an atom in Atoms home that participates in hard supersession edges, show a one-line subsequent-history ribbon (Revised by / Revises / Contradicts chips with jump). No ribbon injected into Obsidian editor/note chrome.
- R8. Stream card may show a minimal citator hint consistent with the ribbon; full history is on home open.
- R9. Bodies remain sacred; writes remain atom files + markers only; no soft-death hide of library rows in this release.
- R10. First time a mind-change hero appears after install/upgrade, allow a **once-only** quiet peak moment (celebration restraint — no confetti, no badge debt); never a multi-step tutorial.
- R11. Committed design mocks in `docs/design-handoff/belief-rehearsal/` are the visual authority for home surfaces; implementation matches them at mobile width.
- R12. Success is measured on **rehearsal of real mind-change**, not on card impressions alone; low density = dormant feature, not failed feature.

### Scope Boundaries

**In scope**

- Detect hard supersession edges from existing atom link reasons (and collision-updated atoms).
- For you mind-change cue priority, card layout, throttle/recovery, 1/day cap.
- Home-open citator ribbon.
- Design handoff mocks (hero + open-with-ribbon).
- Dogfood-friendly density language in acceptance.

**Out of scope (this release)**

- Soft death / default hide of superseded atoms in library or stream.
- Consolidation MoC / constellation notes (separate ideation).
- Soft unfreeze reclassify, vault health trial-balance, ContextProvider shortlist.
- Editor/reading-view plugin chrome for citator.
- New classify schema fields or third write types.
- Anki grades, due counts, or multi-mind-change backlog UI.

### Key Decisions

- K1. **Stream + citator, not full Belief OS** (session-settled: user-approved — chosen over full soft death, stream-only, citator-only): first ship is rehearsal, not retirement.
- K2. **Mind-change above on-this-day** (session-settled: user-directed): when a hard pair exists, identity update beats calendar nostalgia.
- K3. **Old body + later line** (session-settled: user-directed): body-primary rot defense on the hero.
- K4. **Product-director amendments** (session-settled: user-approved after adversary pass — chosen over original lock without amendments): stream is primary product center; citator is one-line home chrome; hard tokens only; max one mind-change hero per day; recovery throttle; density/dormant success language; home-only citator.
- K5. **Hard tokens only:** only reasons that clearly mark revises or contradicts; generic relates does not qualify.
- K6. **Mocks required before implementation polish:** design-handoff HTML is durable authority, not a chat sketch.

### Success Criteria

- S1. With seeded supersession pairs in the throwaway vault, For you shows a mind-change hero when eligible and falls through cleanly when not.
- S2. Opening the hero and using Next / recovery never creates a review queue or badge count.
- S3. Home open of a superseding or superseded atom shows the citator ribbon; opening the note in Obsidian does not add plugin ribbon chrome.
- S4. After one mind-change hero in a day, further For you draws use other cues even if more pairs exist.
- S5. In real dogfood, if fewer than a handful of hard pairs appear over two weeks, treat the feature as **dormant** (correct empty behavior) rather than re-scoping into soft death.
- S6. Visual pass against `docs/design-handoff/belief-rehearsal/` at phone width passes for hero + home-open ribbon.

### Assumptions

- A1. Classify continues to emit revises/contradicts often enough over months for the feature to wake up; v1 does not re-tune the full prompt as the main deliverable.
- A2. Collision update path already consolidates same-title into one file; edges still readable for citator.
- A3. Primary dogfood device is phone via Sync; home remains the control surface.

### Non-Goals / Anti-Requirements

- Do not demote or hide library atoms solely because they were superseded.
- Do not show “N mind-changes due.”
- Do not rewrite old atom bodies to mark retirement.
- Do not require Preview before showing mind-change (stream is local graph read).

### Design Authority

| Mock | Path | Role |
|---|---|---|
| Mind-change hero | `docs/design-handoff/belief-rehearsal/mind-change-hero.html` | For you card hierarchy, copy, actions |
| Home open + citator | `docs/design-handoff/belief-rehearsal/home-open-citator.html` | Ribbon placement on home atom view |
| Index | `docs/design-handoff/belief-rehearsal/index.html` | Decisions + links |

### Outstanding Questions (for planning, not product forks)

- Exact Open behavior when both old and new exist (single Open vs dual targets).
- Precise parse rules for hard supersession tokens in free-text reasons.
- Whether Process done-summary should surface a supersession count (nice-to-have instrumentation).

### Product Contract preservation

Product Contract unchanged from brainstorm; planning added Implementation Units via code on branch `feat/belief-rehearsal-os`.

### Provenance

Seeded from ce-ideate surprise-me survivor “Belief OS,” then product-director adversary pass. Grounding dossier (session): `/tmp/compound-engineering/ce-brainstorm/1555050d/grounding.md`.


---

## Planning Contract

**Approach:** Extend `resurface.ts` pure stream with mind-change cue + pair/day gates; home UI renders mind-change hero and in-home open with citator ribbon. Design mocks under `docs/design-handoff/belief-rehearsal/`.

**Product Contract preservation:** unchanged R1–R12 / K1–K6 from brainstorm.

## Implementation Units

### U1. Parse hard supersession edges + mind-change candidates
**Goal:** Pure functions for edges, mind-change list, citator chips, day/pair helpers.
**Files:** `src/resurface.ts`, `test/resurface.test.ts`
**Status:** implemented on this branch

### U2. Stream priority + pick gates
**Goal:** mind-change before other cues; 1/day; pair throttle.
**Files:** `src/resurface.ts`, `test/resurface.test.ts`
**Status:** implemented

### U3. Home mind-change hero + home open citator
**Goal:** UI matching design handoff.
**Files:** `src/atomsHomeView.ts`, `styles.css`
**Status:** implemented

### U4. Version bump + concepts
**Files:** `manifest.json`, `package.json`, `versions.json`, `CONCEPTS.md`
**Status:** implemented

## Verification Contract

- `npm test` green (mind-change + existing resurface)
- `tsc -noEmit` clean
- Manual: seed vault with revises pair → For you mind-change → Open → citator

## Definition of Done

- R1–R12 product laws held in code comments / tests where pure
- Mocks committed as design authority
- Version 0.5.4 identifiable in Settings
