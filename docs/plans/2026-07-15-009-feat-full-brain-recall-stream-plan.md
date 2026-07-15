---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
title: "Full brain recall stream - Plan"
date: 2026-07-15
type: feat
---

# Full brain recall stream - Plan

## Goal Capsule

Complete the third leg of the second brain: **resurface** filed atoms without a guilt queue. Expand “From the brain” beyond on-this-day into a multi-cue stream (calendar, associative, spacing) grounded in retrieval practice + cue-dependent memory. Dogfood in test vault as a real dumper.

## Product Contract (brainstorm)

### Problem Frame

Dump + file is incomplete if atoms only appear when you search. Without rehearsal, knowledge fossilizes (epistemic rot). Search is pull; a healthy brain also gets **unprompted cues**.

### Psychology (research summary)

| Principle | Implication for Atoms |
|---|---|
| **Cue-dependent recall** | Show body snippet + source day; calendar and graph are cues |
| **Retrieval practice** | Re-showing an atom is rehearsal — not a “task to clear” |
| **Spacing** | Prefer atoms not seen recently; soft throttle after show |
| **Episodic / on-this-day** | Same MM-DD across years |
| **Associative** | Notes linked to recently touched atoms |
| **Stream ≠ queue** | No badge counts; Next/skip free; nothing accumulates |

### Requirements

| ID | Requirement |
|---|---|
| R1 | From the brain card supports cues: **on-this-day**, **connected**, **quiet** (priority order). |
| R2 | Body snippet primary; title + cue label + date secondary. |
| R3 | Open / Next; session skip; **soft throttle** (device-local: don’t re-pick same path for ~7 days after shown). |
| R4 | No card when zero candidates after filters (no empty guilt). |
| R5 | Connected: share a link chip or inbound/outbound wikilink title with a recently modified atom. |
| R6 | Quiet: older memory-day / low mtime among atoms not throttled. |
| R7 | Pure helpers + unit tests; dogfood seed in test vault. |
| R8 | Version **0.5.0** (recall leg ships as product milestone). |

### Scope

**In:** multi-cue stream, throttle, tests, test-vault seed, architecture/CONCEPTS.  
**Out:** Anki grades, review queue, collection browser UI, embeddings, chat-over-vault.

### Implementation Units

### U1. Multi-cue pure resurface
Expand `src/resurface.ts` + tests.

### U2. Home card + throttle storage
Wire view; device-local skip set via `loadLocalStorage`/`saveLocalStorage`.

### U3. Test vault seed + dogfood script
Realistic dailies + atoms; install test vault; CLI smoke.

### U4. Docs + 0.5.0

## Definition of Done

- Unit tests for all three cues + priority + throttle
- Test vault has multi-year on-this-day + linked cluster + old quiet atom
- Home card can show non–on-this-day candidates when calendar empty
- 0.5.0 on master path ready for install
