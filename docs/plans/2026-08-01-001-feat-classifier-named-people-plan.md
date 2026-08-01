---
title: "Classifier-named people behind person invites"
date: 2026-08-01
artifact_contract: ce-unified-plan/v1
artifact_readiness: needs-doc-review
product_contract_source: reverse-engineered-contract
execution: code
issue: 227
lane: full
type: feat
origin: docs/solutions/logic-errors/person-invite-verb-as-name.md
related:
  - 224
---

> **Method note — read before treating this as authority.** `ce-plan` did not run. The skill lives in
> private `taihartman/claude-skills`, which could not be attached from the remote container
> (`AGENTS.md` § Shared skills). This artifact conforms to the `ce-unified-plan/v1` **shape**
> reverse-engineered from the 54 plans already in `docs/plans/` — canonical section set, R/F/AE
> numbering, unit and gate tables — but the method that normally produces it was not executed, so
> `product_contract_source` is `reverse-engineered-contract`, not `ce-plan-bootstrap`. Per
> `CLAUDE.md` § Plan quality gate, run at least a light `ce-doc-review` before `ce-work`.

# feat: classifier-named people behind person invites

## Goal Capsule

**Objective.** Person invites name people the **model identified in the capture**, with a role, instead
of a regex guessing at the first capitalised token of the rendered title. One `people` field on the
existing classify call, persisted to atom frontmatter, consumed by all three surfaces that today
re-derive a name from prose.

**Authority.** Constitution (`CLAUDE.md` non-negotiables 1 *body sacred*, 2 *flat folder*, 6
*nothing destroyed*) > `docs/architecture.md` > this plan. `#224` / `0.6.60` shipped the containment
this plan replaces; that deny list survives as a guard, not as the mechanism.

**Stop conditions.** Do not fall back to a later capitalised token in the title. Do not bundle a
wordlist or POS tagger. Do not infer a missing subject from neighbouring daily bullets. Do not
rewrite atom titles (separate issue). Do not auto-create person hubs — the invite stays an offer.

**Product Contract preservation.** Bootstrapped from #224, the shipped `0.6.60` diff, and
`docs/solutions/logic-errors/person-invite-verb-as-name.md`. R1–R9 locked below.

**Claim required before implementation.** New GitHub Issue (assigned) + `STATUS.md` row + draft PR.
`#224` is the containment issue and is **not** this claim.

---

## Product Contract

### Problem

Atoms home offered **"Add Likes?"** for the atom `Likes Annie's fruit tape snack`. The capture elided
its subject, so the title led with a verb, and `resolvePersonInviteName` (`personInvite.ts:143`) takes
the leading capitalised token as the name. Its gate, `isPersonShapedCapture`, is satisfied by
`PREFERENCE_OR_RELATION_RE` (`enrich/people.ts:305`) matching **the same word** — so `Likes`
qualified itself. A rule whose candidate produces its own approval signal is self-confirming.

`0.6.60` denied ~200 verbs and determiners. Measured against the shipped fix, unlisted verbs still
resolve:

| Title | 0.6.60 resolves |
|---|---|
| `Skipped the gym because Nichita likes it` | `Skipped` |
| `Swapped Annie's snack, likes it better` | `Swapped` |
| `Ordered the boots Nichita likes` | `Ordered` |
| `Craving Annie's fruit tape always` | `Craving` |

English outnumbers the list. Two further problems no regex reaches: **role** is undecidable by
pattern (the dead `/* fall through */` arm at `personInvite.ts:118–131` is that giving out in the
source), and **three surfaces** re-derive the name independently — the home card, `write.ts:392`
peer grouping, and `atomsHomeView.ts:1227` `upgradePathSet` — so one bad name becomes three wrong
writes.

### Actors

| ID | Actor |
|---|---|
| A1 | Capture author on phone; subject often elided because they know who they meant |
| A2 | Same user on Atoms home, deciding whether a person hub should exist |
| A3 | Classify provider — device (`classify.ts`) or Plus host (`plus-service`) |

### Requirements

| ID | Requirement |
|---|---|
| R1 | `CLASSIFICATION_SCHEMA` gains `people: [{name, role}]`, `role ∈ subject \| mentioned \| recommender`, `additionalProperties: false`, added to `required` |
| R2 | Empty `people` is valid and expected — subject-less captures are the common case, not an error |
| R3 | Invite fires on `role: "subject"` only. `mentioned` may link to an **existing** hub; never invites. `recommender` replaces `RECOMMENDER_RE` |
| R4 | `name` must appear **verbatim** in the capture text or the entry is dropped (hallucination guard) |
| R5 | `isDeniedPersonName` still runs — `0.6.60` list is the backstop for model slips |
| R6 | Persisted to atom frontmatter (`atoms-people`); all three consumers read the field, none re-parse prose |
| R7 | Atoms without the field keep `0.6.60` behaviour exactly (legacy path); no regression on the existing library |
| R8 | `CURRENT_ATOMS_QUALITY` 7 → 8 so `atoms:update-notes` backfills older atoms |
| R9 | Device and Plus emit the same field — `plus-service/src/classifyTemplate.mjs` updated in the same PR |
| R10 | Not in scope: title rewriting, subject inference from siblings, hub auto-creation |

### Key flows

| ID | Flow |
|---|---|
| F1 | `likes Annie's fruit tape snack` → `people: [{Annie, mentioned}]` → no subject → **no card** |
| F2 | `Nichita likes long brown boots` → `[{Nichita, subject}]` → card (or hub link if hub exists) |
| F3 | `Christian told me to watch MHA` → `[{Christian, recommender}]` → no card |
| F4 | Legacy atom, no `atoms-people` → `0.6.60` heuristic path → unchanged behaviour |
| F5 | `atoms:update-notes` on a legacy atom → field filled → F1–F3 apply |

### Acceptance examples

| ID | Example |
|---|---|
| AE1 | The reported capture verbatim produces no People card on home |
| AE2 | `Mom wants to celebrate for her bday` still invites `Mom` |
| AE3 | Model returns a subject absent from the capture → dropped by R4; no card |
| AE4 | Two atoms whose titles both start with `Likes` are **not** peer-linked as the same person |
| AE5 | `Skipped the gym because Nichita likes it` → `Nichita` subject, `Skipped` never considered |
| AE6 | Plus-classified capture emits `people` identically to device-classified |

### Scope

**In:** schema + prompt + types + invariants; `plus-service` template snapshot; frontmatter
persistence; three consumers; quality bump + backfill; tests; version bump; QA evidence.

**Out:** title quality / verb-led titles (follow-up 1); `reconsider` routing for subject-less captures
(follow-up 1); retiring the deny list from the hot path (follow-up 2); entity invites
(`suggestEntityHubLabel` is a separate keyword path and is not touched).

---

## Planning Contract

### Key technical decisions

**KTD1 — `people` is model output, not derived.** The model already reads the capture and already
returns structured JSON. Morphology and role are what it is good at and what regex is bad at.

**KTD2 — role enum, not a bare name list.** `subject` vs `mentioned` is the whole reason `Annie` must
not become a hub invite. A flat `string[]` would reintroduce the bug at the consumer.

**KTD3 — frontmatter is the single source.** Prose is a *rendering*; re-parsing a rendering to recover
structure the pipeline already had is the defect class, not one instance of it. This is the half of
the fix that stops the next bug of this shape.

**KTD4 — schema trusted, content not.** Per `classify.ts:268`. R4 verbatim check + R5 deny list, both
dropping the *entry*, never the whole classification.

**KTD5 — no extra API call.** One field in the existing request. The `cache_control` breakpoint sits
on the system prompt (`classify.ts:458–468`), so the schema change invalidates the prefix **once**,
not per capture.

**KTD6 — absent ≠ empty.** Parse must distinguish "no `atoms-people` key" (legacy → heuristic path)
from "`atoms-people: []`" (model said nobody → no card). Collapsing them silently reinstates the bug
on every legacy atom.

### Architecture

`classify.ts` (schema/prompt/invariants) → `render.ts` (frontmatter write) → consumers
(`personInvite.ts`, `write.ts`, `home/atomsHomeView.ts`). Seams per `CLAUDE.md` § Architecture seams:
intelligence stays in links + titles; `plugin/main.ts` untouched.

### Patterns to follow

- Invariant style + `additionalProperties: false` from `classify.ts`.
- Frontmatter parse/stamp style from `atomQuality.ts` (`parseAtomsQuality`, `frontmatterBlock`).
- Possessive-aware matching already exists — reuse `captureMentionsKey` (`enrich/people.ts:320`) for R4.
- Deny choke point: keep every name branch routed through `isDeniedPersonName`.

### Assumptions

| ID | Assumption | If false |
|---|---|---|
| AS1 | Model reliably distinguishes subject from possessive owner | AE-level prompt examples; if still wrong, invite only when exactly one `subject` |
| AS2 | `atoms-people` in frontmatter does not disturb Ask mirror or hub projection | Verify against `mirror/` + `hubProjection.ts` in U2 |
| AS3 | `update-notes` re-classifies rather than only re-rendering | Confirm in `refreshAtoms.ts` before sizing U5 |

### Deferred open questions (non-blocking)

- Should a `mentioned` person with no hub ever surface a weaker "link to existing?" affordance?
- Should multiple `subject` entries (`Mom and Dad want…`) invite both, or neither? Current code
  under-invites on multi-person dumps; keep that until evidence says otherwise.

### Risks

| Risk | Mitigation |
|---|---|
| **Plus drift** — `plus-service/src/classifyTemplate.mjs:80` is a hand-synced snapshot of the prompt + schema (its own comment says "keep in sync with", `:3`), consumed at `anthropic.mjs:239` | Same-PR update, R9; a U1 deliverable, not a checklist item. Otherwise Plus subscribers silently classify on the old schema and land permanently on the legacy path |
| Model names a subject the capture never states | R4 verbatim guard |
| Nicknames / non-Latin names | Verbatim match is script-agnostic; alias matching in `enrichPersonLinks` unchanged |
| Legacy library regresses | R7 + KTD6 |
| Backfill cost on a large vault | `update-notes` is user-invoked and already gated; no auto-reprocess |

### Learnings to honor

- `docs/solutions/logic-errors/person-invite-verb-as-name.md` — self-confirming heuristics; guard at
  the one deny choke point, not per call site.
- `docs/solutions/logic-errors/partial-adoption-of-a-cited-solution-doc.md` — adopt the whole
  decision, not the convenient half.
- Non-negotiable 9 (dogfood honesty): prove this by appending captures and running Process, not by
  hand-seeding a hub.

---

## Implementation Units

### U1. Schema, prompt, invariants — device **and** Plus

**Goal.** Model emits `people` with roles; untrusted content filtered at the boundary.

**Files:** `src/pipeline/classify.ts` · `src/shared/types.ts` ·
`plus-service/src/classifyTemplate.mjs` · `test/classify*.test.ts`

**Approach.** Add the field per R1 with role descriptions; extend `SYSTEM_PROMPT` with the reported
capture as the worked example of "subject elided → empty is correct"; invariants per R4/R5 dropping
entries. Mirror the snapshot into `plus-service` in the same commit.

### U2. Frontmatter persistence

**Goal.** One durable source for the three consumers.

**Files:** `src/pipeline/render.ts` · `src/pipeline/atomQuality.ts` (parse helper) · `test/render*.test.ts`

**Approach.** Write `atoms-people`; parse returns `null` when absent and `[]` when empty (KTD6).
Round-trip names with apostrophes, diacritics, spaces. Check AS2 against mirror + hub projection.

### U3. Invite consumes the field

**Goal.** Card names a person or says nothing.

**Files:** `src/pipeline/personInvite.ts` · `test/personInvite.test.ts`

**Approach.** `resolvePersonInviteName` takes parsed people; regex demoted to
`resolvePersonInviteNameLegacy` for R7. Delete the dead recommender arm (`:118–131`).

### U4. The other two consumers

**Goal.** Peer links and hub upgrades stop re-parsing prose.

**Files:** `src/pipeline/write.ts` (`:392`) · `src/home/atomsHomeView.ts` (`:1227`) · tests

**Approach.** Group by frontmatter subject; legacy fallback preserved. AE4 is the regression test.

### U5. Backfill

**Goal.** The existing library converges without a forced reprocess.

**Files:** `src/pipeline/atomQuality.ts` (7 → 8) · `src/pipeline/refreshAtoms.ts` · tests

**Approach.** Confirm AS3 first. Assert a refreshed `Likes Annie's…` atom yields no invite (F5).

### U6. Shipping tail

`ce-simplify-code` → `ce-code-review` → `ce-compound` (extend the existing solution doc) →
`world-class-qa` + `adversarial-qa` → version bump → PR with `Closes #<issue>`.

---

## Verification Contract

| Gate | Command / evidence |
|---|---|
| Plugin unit | `npm test` |
| Typecheck + bundle | `npm run build` |
| Plus service | plus-service test entry — schema snapshot parity with `classify.ts` |
| Live dogfood | `test_vault`: append the reported capture verbatim → **Process** → no People card; append `Nichita likes …` → card appears |
| Backfill | `obsidian command id=atoms:update-notes` → legacy atom gains `atoms-people` → F5 |
| Peer links | Two `Likes …` atoms → no `same person` edge (AE4) |
| Platforms | No desktop-only branch; same code path phone + desktop |
| Screenshots | `obsidian vault="test vault" dev:screenshot` after `./scripts/install-to-vault.sh`; commit under `docs/qa/screenshots/<branch>/`, link by absolute raw URL |

**Execution direction:** test-first on the pure layer — invariants (U1), frontmatter round-trip (U2),
name resolution (U3). Consumers and backfill characterised after those are green.

> The session that drafted this had no Obsidian and no CLI. **No gate above has run.**

---

## Definition of Done

**Global**
- [ ] AE1–AE6 satisfied on dogfood, not unit tests alone
- [ ] R4 + R5 hold against a deliberately adversarial classification
- [ ] R7 verified: legacy atoms behave exactly as `0.6.60`
- [ ] `plus-service` snapshot matches `classify.ts` (R9)
- [ ] All listed tests green; `npm run build` clean
- [ ] `CURRENT_ATOMS_QUALITY` bumped; `update-notes` backfills
- [ ] Version bumped in the shipping commit; visible in Settings → Atoms
- [ ] Solution doc extended (`ce-compound`)
- [ ] PR body has `Closes #<issue>` + Core user stories + Edge cases & testing
- [ ] UI screenshots in the PR body via absolute raw URLs
- [ ] `STATUS.md` row cleared after merge

**Per unit**
- U1: schema + invariant tests; Plus snapshot in the same commit
- U2: round-trip incl. absent-vs-empty; AS2 checked
- U3: AE1/AE2/AE5 + existing `Mom`/`Dom`/CRG suite still green
- U4: AE4 regression
- U5: AS3 confirmed; F5 asserted
- U6: shipping tail run or explicitly recorded as skipped

---

## Appendix

### Follow-ups (separate issues)

1. **Verb-led titles are their own defect.** `Likes Annie's fruit tape snack` is not a declarative
   claim about anything identifiable. With `people: []` from U1 the pipeline can finally *detect* the
   subject-less case and route it to `reconsider` — the honest answer to a headless capture.
2. **Retire `PERSON_INVITE_NON_NAME_WORDS` from the hot path** once U5 has converged the library;
   keep it as the R5 backstop only.

### Research breadcrumbs (2026-08-01)

- Residual-gap table measured by running the shipped `0.6.60` `resolvePersonInviteName` against
  unlisted verbs — not asserted.
- Contract shape derived from 54 artifacts in `docs/plans/`: `Goal Capsule` (31), `Product Contract`
  (30), `Definition of Done` (27), `Implementation Units` (26), `Verification Contract` (24),
  `Planning Contract` (21).
- Public method background: compound engineering (Kieran Klaassen / Every) — plan → work → assess →
  codify, each unit of work making the next easier. `every.to/guides/compound-engineering` returned
  403 to the fetch; the in-repo artifacts were the authority used here.
