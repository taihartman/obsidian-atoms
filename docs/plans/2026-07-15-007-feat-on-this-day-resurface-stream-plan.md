---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: On-this-day resurface stream on Atoms home"
date: 2026-07-15
type: feat
lane: amend
---

# feat: On-this-day resurface stream on Atoms home

## Goal Capsule

Show a **zero-guilt “From the brain” card** on Atoms home that re-surfaces **one** existing atom matching **on this day** (same calendar month–day as today, not created today). Body snippet is primary; Open + Next only. No review queue, no Anki, no badge counts.

**Extends:** Atoms home library (`atomsHomeData` / `atomsHomeView`).  
**Lane:** first slice of resurfacing stream (Phase 1 of recall design).

---

## Product Contract

### Requirements

| ID | Requirement |
|---|---|
| R1 | When ≥1 eligible atom matches on-this-day, home shows a **From the brain** card (not a queue). |
| R2 | Card shows **body snippet** prominently + title secondary + cue label “On this day”. |
| R3 | **Open** opens the atom note; **Next** shows another eligible atom this session (or hides if none left). |
| R4 | No badge of “N to review”; empty candidates → **no card** (not empty state guilt). |
| R5 | Eligibility: generated atom under atom folder; month–day of `source` or `created` matches today; full date ≠ today. |
| R6 | Skip / Next is session-local only (no permanent bury in v1). |
| R7 | Does not change classify/write/markers. |

### Key Technical Decisions

| ID | Decision | Rationale |
|---|---|---|
| KTD1 | Stream card, not queue | (session-settled: user-approved — stream over backlog; architecture + psych design) |
| KTD2 | Phase 1 cue = **on-this-day only** | Cheapest durable cue; connected/age deferred |
| KTD3 | Body snippet primary | Trust body over title (spec rot defense) |
| KTD4 | Pure helpers in `src/resurface.ts` + tests | Match home data purity |
| KTD5 | Version **0.4.2** on master line | User-visible home change |

### Scope Boundaries

**In:** pure date/snippet pick helpers; home card; CSS; tests; version.  
**Out:** connected-to-recent; age/quiet; device-local “don’t show for a week”; collections UI; Anki; embeddings.

### Implementation Units

### U1. Pure resurface helpers

**Files:** create `src/resurface.ts`, `test/resurface.test.ts`; may extend `atomsHomeData` extractors for `created` day.

**Approach:** `extractCreatedDay`, `monthDayKey`, `isOnThisDayMatch`, `bodySnippet`, `listOnThisDayCandidates`, `pickResurface(candidates, skipPaths)`.

**Tests:** same MM-DD different year matches; same calendar day today excluded; missing dates skipped; snippet truncates; pick respects skip set.

### U2. Home card UI + wire

**Files:** `src/atomsHomeView.ts`, `styles.css`; load path already lists atom files.

**Approach:** After progress/wait region, if candidate, render card; Open via leaf; Next increments skip set and re-picks without full vault reload if possible.

### U3. Version + architecture one-liner

**Files:** package/manifest/versions; `docs/architecture.md` future/v0.4+ UI bullet.

### Verification Contract

Unit tests for date logic; full suite green; manual: plant atom with source day = today MM-DD prior year → card appears.

### Definition of Done

U1–U3; AE: card shows body; Next cycles; no candidates → no card.
