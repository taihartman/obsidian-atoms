---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: Measurement Series - Plan
type: feat
date: 2026-08-21
---

# Measurement series - Plan

## Goal Capsule

- **Objective:** A recurring measurement of a durable thing (odometer, weight, meter reading) files as an atom, joins its series through a thing hub and a reading-to-reading link, opens a loop when the capture states a return intent, and offers to close that loop when a later reading arrives. Update notes repairs the owner's real 73042/73089 pair as the acceptance proof.
- **Authority:** This plan, `docs/architecture.md`, `docs/obsidian-api-conventions.md`, `docs/localization.md`, and the non-negotiables in `CLAUDE.md`.
- **Execution profile:** Full lane. Model-first intelligence, narrow heuristic seatbelts, invite-not-automation for hubs and loop closes.
- **Stop conditions:** Hard claim exists (#589, `STATUS.md` row, draft PR #590). Do not widen the noise gate for ordinary logistics; adversarial QA must prove "buy milk" / "call dentist at 3" still skip.
- **Tail ownership:** The implementation run owns simplify, code review, durable learning capture, world-class QA, adversarial QA, versioning, and PR evidence.

## Product Contract

### Summary

The second point of a measurement series is the moment the series becomes real. Today it is the moment the product calls it noise. After this plan: the reading files, links the thing and the prior reading, and if the earlier capture promised a return ("drive 60–70 miles and come back into QGS automotive"), Home asks — with the user's own numbers on screen, never a computed verdict — whether the errand is done.

### Problem Frame

Live dogfood 2026-08-18 → 2026-08-20 (#589): "My car is at 73089 miles" classified noise; Reconsider re-ran the same judgment; Keep as note filed a link-less island next to a link-less 73042 atom whose title is the pasted capture and whose stated return intent opened no loop. Retrieval had already put the prior reading in the shortlist — the verdict and the linking pressure were the misses, then the override path threw the shortlist away.

### Key Decisions (product)

- KD1. **Series anchor is the owned thing, not the vendor.** `My car` is the hub; `QGS automotive` links where mentioned. A vendor hub can earn its own invite later through the existing entity machinery.
- KD2. **Hub + chain, not either alone.** The hub gives exact-title linking and a browsable series; the chain (new reading links prior reading) survives a declined invite. Declining degrades gracefully to retrieval-based chaining — it never breaks the thread.
- KD3. **Invite fires at reading two.** Reading one is ambiguous; the series proves itself at the second point. No invites on a hunch.
- KD4. **Loop close is an offer, never automatic.** The live pair proves why: 73042 + 60–70 puts the return at ~73102–73112, and 73089 is short of it. The card shows both captures verbatim; the user judges. No arithmetic, no targets, no due anything — the task-app line holds.
- KD5. **Intelligence lives in the model, taught generally.** The prompt learns "a reading of a durable thing is a point in a series" with cross-domain examples. The heuristic rescue is a seatbelt: narrow, high-precision, shaped by the observed failure only.
- KD6. **Keep as note keeps your thread.** A user override is a verdict; the system still owes it the link-enrichment chain against the shortlist. Overrides must not mint islands.
- KD7. **Backfill rides Update notes.** Bump `CURRENT_ATOMS_QUALITY` so pre-feature atoms are eligible; the owner runs Update notes on their own vault (agents never touch it). The 73042/73089 pair repairing end-to-end is the feature's acceptance proof.

### Requirements

- R1. A capture that is a measurement of a durable thing classifies as atom with a short declarative title (never the pasted capture), even when it is a single line with no other keepable content.
- R2. When a prior reading of the same thing exists in the shortlist or a thing hub exists in Note titles, the new reading links it with a substantive reason naming the series relationship (continues/revises the series).
- R3. A capture stating a return/completion intent ("come back into X", "return to X", "bring it back in") opens a loop on that atom via the existing open-loop frontmatter.
- R4. When a later reading about the same thing arrives while such a loop is open, Home offers a close card showing both captures verbatim; accept records the redeem edge and quiets the loop; decline leaves it open and does not re-ask for the same pair.
- R5. On the second reading of a thing with no hub, Home offers a "Track [thing]?" invite in the existing invite card family; accept creates the hub and links both readings; decline snoozes per existing invite snooze rules.
- R6. Reconsider's Keep as note override runs the post-classify enrichment chain (entity/person/media/link quality) with the capture's shortlist context before filing.
- R7. Ordinary logistics stay noise: "buy milk", "call dentist at 3", lone timestamps, one-off errands with numbers. The noise gate does not widen for non-measurement captures.
- R8. Update notes repairs eligible pre-feature atoms to the new quality: series links, loop frontmatter where the body states a return intent, and title repair where the title is the pasted capture.
- R9. New user-facing copy follows the plugin's current convention: English in source (the plugin tree has no locale catalog yet, per `docs/localization.md`), centralized in copy functions where a shared one exists, voice rules enforced by `test/copyVoice.test.ts`.
- R10. Body stays verbatim everywhere; no folder movement; no computed service targets, dates, or reminders anywhere in the surface.

### Acceptance Examples

- AE1. Given `My miles in my car at 73042 I need to drive 60 to 70 miles and come back into QGS automotive` files on a fresh vault, when Process runs, then it is an atom with a short declarative title and an open loop, and no hub invite fires yet.
- AE2. Given AE1's atom exists, when `My car is at 73089 miles` is processed, then it files as an atom linking the 73042 atom with a series reason, Home offers "Track My car?", and Home offers the loop-close card showing both captures.
- AE3. Given the user declines the hub invite, when a third reading is processed, then it still links the prior reading through the shortlist and no invite re-fires within the snooze window.
- AE4. Given the loop-close card, when the user declines, then the loop stays open and the same pair does not re-offer.
- AE5. Given `buy milk`, `call dentist at 3`, and a lone timestamp, when Process runs, then all three still classify noise.
- AE6. Given the owner's real vault holds the two pre-feature island atoms, when the owner runs Update notes after upgrading, then the pair links, the 73042 atom gains its loop and a repaired title, and Home offers the hub invite and close card.
- AE7. Given a weight capture like `Weighed in at 178 this morning` with a prior weight atom in the vault, when Process runs, then it files as an atom and links the prior reading — the shape generalizes beyond vehicles without code changes.
- AE8. Given a noise verdict the model holds after Reconsider, when the user picks Keep as note, then the filed atom carries any same-thread links the enrichment chain finds — never `links: []` while a same-thread title sits in the shortlist.

### Success Criteria

- The originating pair repairs on the owner's vault via Update notes, run by the owner, with screenshots in the PR.
- Zero regressions on the existing noise fixture set; adversarial QA fails to sneak a chore through the measurement door.

### Scope Boundaries

**In scope**

- Prompt teaching (triage + series linking + return-intent awareness) in `classify.ts`.
- Narrow measurement rescue heuristic and its wiring next to `rescueKeepableIdea`.
- `looksLikeOpenLoop` return/completion intents.
- Loop-close offer card and thing-hub invite on Home (existing card families).
- Keep-as-note enrichment (R6), title repair for pasted-capture titles during Update notes, `CURRENT_ATOMS_QUALITY` bump.
- Copy per plugin convention (no catalog yet); version bump; docs (CONCEPTS entry for "measurement series"; solution doc).

**Out of scope**

- Any computed maintenance math, due mileage, reminders, or schedules (constitution: not a task app).
- Vendor/shop hubs beyond what existing entity invites already do.
- Charts, graphs, or numeric visualization of series.
- Auto-closing loops without the user's accept.
- Server/Ask changes: `/v1/classify` is passthrough; open_now derivation already reads loop state.

### Dependencies / Assumptions

- Plus classify forwards the client-built messages request (`ProxyClassifyBody.messagesRequest`), so prompt changes ship with the plugin — verified in `plusClient.ts`. If the service is found to override the system prompt server-side, that becomes a blocking follow-up before live claims.
- Existing invite machinery (`entityInvite.ts`, hub invite cards, snooze) is reusable for the thing-hub invite; existing redeem edges serve the close.

### Outstanding Questions

- None blocking. Vendor-hub invites and richer series surfaces (e.g., a readings section in the hub) are follow-up candidates.

## Planning Contract

### Key Technical Decisions

- KTD1. **Prompt over heuristics for recognition.** New triage guidance + few-shot examples in `SYSTEM_PROMPT`: a measurement of a durable thing is an atom because the series is the value; series linking is same-thread pressure (the existing "prefer a substantive link over silence" section gains the reading case). The rescue heuristic (`isMeasurementReading`) is number+unit+owned-noun shaped, high precision, and only promotes noise→atom — mirroring `rescueKeepableIdea`'s placement before invariants.
- KTD2. **Loop opening stays heuristic-side.** `looksLikeOpenLoop` gains STRONG_INTENT patterns for return/come-back/bring-back shapes. It already runs at render/write and in `askOutbox`, so both filing and Ask mirror pick it up with one change. Conservative bias preserved (prefer miss over false open).
- KTD3. **Close offer = new Home card in the existing invite family.** Detection: an atom with an open loop whose body names a thing that a newer atom also names (token overlap on the non-numeric nouns, or shared hub link). Accept writes the redeem edge exactly as Ask's redeem does; decline records a told-set entry (same pattern as Together news told-set) so the pair never re-asks.
- KTD4. **Thing-hub invite reuses the entity invite path.** `isEntityShaped` is not widened; a parallel `isMeasuredThingShaped` gate feeds the same invite grouping so the packing/trip precision is untouched. Fires only when ≥2 readings of the thing exist (KD3).
- KTD5. **Keep-as-note runs `applyClassificationQuality`.** The override path builds a synthetic atom result (title via `shortTitleFromCapture`) and passes it through the shared quality chain with the capture's shortlist context — one choke point, no parallel enrichment fork.
- KTD6. **Backfill = quality bump, not a new command.** `CURRENT_ATOMS_QUALITY` 8→9. `refreshAtoms` already re-classifies, re-enriches, and writes open-loop frontmatter; pasted-capture titles repair for free: re-classification yields the short title and the existing rename path (marker retarget + alias, collision policy) applies it.

### High-Level Technical Design

Recognition (prompt + `enrich/measurement.ts` seatbelt) → filing (unchanged render/write; loop via KTD2) → series linking (prompt pressure + `enrichEntityLinks` exact-title when hub exists) → Home offers (close card KTD3, hub invite KTD4) → repair (Reconsider override KTD5, Update notes KTD6). No new storage: loops are existing frontmatter, told-sets and snoozes follow existing device-local patterns.

### Implementation Constraints

- No `el.style.*`, `Platform.*` not `navigator`, `createEl`/`createSpan`, locale catalog for all copy (`docs/obsidian-api-conventions.md`, `docs/localization.md`).
- Test-first on pure logic: measurement heuristic, loop intents, close-pair detection, title-repair predicate.
- Verify with `./scripts/verify.sh` + CLI on the throwaway vault; demo-vault dogfood via capture→Process, not seeded hubs (dogfood honesty).

### Sequencing

U1 (recognition) → U2 (loops) → U3 (series linking + hub invite) → U4 (close card) → U5 (override + backfill) → U6 (docs, version, QA tail). U1 and U2 are independent; U4 depends on U2+U3.

## Implementation Units

### U1. Measurement recognition

Prompt: triage bullet + examples (odometer, weight, meter; counter-examples: "buy 2 gallons milk", "call dentist at 3"). `enrich/measurement.ts`: `isMeasurementReading` + noise→atom rescue wired beside `rescueKeepableIdea` in `classifyCapture` and `applyClassificationQuality`. Tests: fixture captures both ways; the live pair verbatim.

### U2. Return-intent loops

`looksLikeOpenLoop` patterns: `come back (in)?to`, `return to`, `go back to`, `bring (it|the car) back`. Tests including the 73042 capture verbatim; miss-bias cases ("came back from lunch" must not open).

### U3. Series linking + thing-hub invite

Prompt same-thread pressure for readings; `isMeasuredThingShaped` + reading-count gate feeding the entity-invite card; accept creates hub + links both readings; snooze on decline. Tests: chain forms with and without hub; invite only at reading two.

### U4. Loop-close offer card

Pair detection (open loop atom × newer same-thing atom), Home card (both captures verbatim, no arithmetic), accept → redeem edge, decline → told-set. Tests: the live pair offers; decline never re-asks; unrelated open loops don't pair.

### U5. Keep-as-note enrichment + Update notes repair

Reconsider override through `applyClassificationQuality`; quality bump 8→9. Title repair needs no new predicate: re-classification under the new prompt yields the short title, and `refreshAtoms` already renames, retargets the daily marker, and keeps the old title as an alias. Tests: override with same-thread shortlist title never files `links: []`; eligibility flips at bump; a good existing title survives refresh unchanged.

### U6. Shipping tail

Copy voice audit, `manifest.json`/`package.json`/`versions.json` bump, CONCEPTS "measurement series", solution doc (a reading is a point in a series — the second point is the trigger), simplify → code-review → compound → world-class QA + adversarial QA (noise gate attack), PR evidence with throwaway-vault screenshots; owner runs Update notes on their vault for AE6 evidence.

## Verification Contract

- Unit: vitest on all new pure logic; existing suites green.
- Product: capture→Process loop on throwaway vault reproducing AE1–AE5, AE7, AE8 with CLI evidence; screenshots for Home cards.
- AE6 is owner-run on the personal vault (agent never touches it) and recorded in the PR before merge-ready.
- Adversarial: attempt to file chores as measurements ("pay $1200 rent tomorrow" is an errand; "rent is $1200 now" is a reading — the pair must split correctly), attempt to open loops on past-tense returns, attempt duplicate close offers.

## Definition of Done

Shipping tail complete per CLAUDE.md; PR body `Closes #589` with core stories + edge cases + QA report link under `docs/qa/`; STATUS cleared on merge.

### Deferred to Follow-Up Work

- Vendor/shop hub invites from repeated mentions.
- A readings section rendered inside the thing hub.
- Series-aware resurfacing (an old reading resurfacing beside its newest point).
