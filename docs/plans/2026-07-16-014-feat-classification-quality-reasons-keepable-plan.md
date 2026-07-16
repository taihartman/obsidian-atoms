---
title: "feat: Classification quality — reason-bearing links, keepable ideas, no empty media stubs"
date: 2026-07-16
type: feat
status: active
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
---

# feat: Classification quality — reason-bearing links, keepable ideas, no empty media stubs

## Goal Capsule

Live dogfood on Remote Vault produced correct plumbing (markers, verbatim bodies, person clustering) but weak **link reasons** (“preference about Nichita”), **empty media stubs** (unresolved work titles clicked into blank notes), **long titles**, and **keepable product ideas** soft-deleted as `task`/`noise`. Ship post-classify + prompt fixes so atoms look like the target-quality demo: substantive reasons, hub-first links, ideas stay atoms, media links only when a vault note already exists.

## Problem Frame

First live atoms are a star graph with category stickers, not a second brain. The model contract already asks for reason-bearing links and atom-for-keepable content; repair paths and prompt examples still emit the weak patterns we saw in production.

## Requirements

| ID | Requirement |
|---|---|
| R1 | Link reasons must carry substance: if wikilinks were stripped, the sentence still teaches something (not “preference about X” alone). |
| R2 | Person-hub repair must inject substantive default reasons, not boilerplate “preference or claim about [[Hub]]”. |
| R3 | Media enrich must **not** add `links[].note` for work titles that do not already exist in vault note titles (avoid empty-stub temptation). Still add media tags. |
| R4 | Captures that are product/app/build ideas (keepable) must become **atoms**, not `task`/`noise` — prompt + local rescue. |
| R5 | Title guidance: short declarative claims (~8–12 words / ~80 chars preferred); body holds the full capture. |
| R6 | Existing contracts hold: body sacred; never change title in enrich except rescue that invents a title only when promoting task/noise→atom from local heuristics; never invent person hubs. |
| R7 | Unit tests cover reason rewrite, media gate, idea rescue, and prompt contract strings. Version bump for user-visible quality. |

## Key Technical Decisions

1. **Post-classify reason rewrite (local, pure)** — Detect weak reason templates (e.g. `/^preference about/i`, `/^update about/i`, `/^preference or claim about/i`, `/^media work to watch/i`, bare “about [[Hub]]”) and rewrite using capture cues + link note. Do **not** burn an API retry. *(session-settled: user-directed — chosen over API retry loop: cheaper, deterministic, fixes repair-injected reasons too)*

2. **Media links only for existing titles** — `enrichMediaLinks` adds a work link only when `resolveWorkTitleAgainstVault` finds an existing title match; otherwise tags only. Unresolved work titles stay in the atom **title/body**, not as hollow edges. *(session-settled: user-directed — chosen over unresolved wikilinks that become empty stubs on click)*

3. **Idea rescue after invariants** — If verdict is `task` or `noise` and capture matches high-precision product-idea patterns (create website/app/game, multi-sentence build pitch), promote to `atom` with a short title derived from first line / work phrase. Prefer atom over loss. *(session-settled: user-approved — chosen over prompt-only: live dump lost Starbucks/Tetris ideas)*

4. **Prompt upgrades in `SYSTEM_PROMPT`** — Strengthen reason examples (good/bad), title length, product-idea→atom, media: link work only if title exists in Note titles. Align schema descriptions.

5. **People index (`People` note)** — When capture mentions CRG/workplace people and vault has a People/index-like title, model may link it; person enrich stays hub-only. Optional light boost: if person-shaped, no hub matched, and a note titled exactly `People` exists, add one index link with a substantive reason. Keep conservative (exact title `People` only).

6. **Demo seed** — Update `scripts/seed-demo-vault.mjs` + `docs/media/demo-vault` to target-quality **synthetic** names (Alex/Jordan style), not personal Remote Vault names. Quality patterns only.

7. **Version** — Bump to `0.6.6` (manifest + package + versions.json).

## Scope Boundaries

**In:** `classify.ts` prompt/schema, pure helpers (new module or under `media.ts`/`people.ts`/`classify.ts`), enrich paths, write/preview/backfill choke points already calling enrich, tests, demo seed, version.

**Out:** Append into curated hubs; embeddings; reprocessing Remote Vault history; parse multi-bullet voice dumps (follow-up); changing sentinel format.

## Implementation Units

### U1. Weak-reason detection + rewrite

**Goal:** Pure helpers rewrite boilerplate link reasons into substantive prose.

**Requirements:** R1, R2

**Files:**
- `src/linkQuality.ts` (new) — `isWeakLinkReason`, `rewriteWeakLinkReason`, `improveClassificationLinks`
- `test/linkQuality.test.ts` (new)
- `src/people.ts` — default repair reasons call into rewrite / better templates
- `src/classify.ts` — apply `improveClassificationLinks` after enrich

**Approach:**
- Weak patterns: starts with “preference about”, “preference or claim about”, “update about”, “relates to” alone, “media work to watch”, “about [[X]]” with little else.
- Rewrite using capture heuristics: games/playing → games list; interview/waiting → career status; color/likes → aesthetic/gift cue; recommended watch → watchlist + recommender if present; generic person → “durable fact about [[Hub]] from capture” only as last resort with more specific verbs when cues exist.
- `improveClassificationLinks(capture, result)` maps all links; rewrites weak ones; leaves strong ones alone.

**Test scenarios:**
- Weak “preference about [[Alex]]” + “Alex likes periwinkle” → reason mentions aesthetic/gift or likes, includes Alex.
- Strong “revises [[Old claim]]” unchanged.
- Media weak reason rewritten or dropped per U2.

**Verification:** vitest green for linkQuality + people enrich reason strings no longer match old boilerplate defaults.

---

### U2. Media enrich — existing titles only

**Goal:** Stop adding unresolved work-title links.

**Requirements:** R3

**Files:**
- `src/media.ts`
- `test/media.test.ts`

**Approach:**
- After resolve, only `links.push` when work title is found in `noteTitles` (case-insensitive exact or existing resolve hit that is in the list).
- If resolved string is not in vault titles, skip link; still apply tags.
- Default reason when linking: substantive (“watchlist: named work already in vault”) not “media work to watch”.

**Test scenarios:**
- Media capture + vault has “Arrival” → link Arrival.
- Media capture + empty titles → tags only, no links.
- Existing tests updated for new policy.

**Verification:** media tests green; classify path still tags watchlist dumps.

---

### U3. Idea rescue (task/noise → atom)

**Goal:** Keepable product ideas never soft-delete.

**Requirements:** R4, R6

**Files:**
- `src/ideaRescue.ts` (new) or section of `linkQuality.ts`
- `src/classify.ts` — after parse invariants, before or after enrich: if task/noise and `isKeepableIdea(capture)`, promote to atom with `shortTitleFromCapture`
- `test/ideaRescue.test.ts` or extend classify tests

**Approach:**
- High-precision: multi-line or long captures with create/build website/app/game/browser patterns; “I am curious what it would be like if we combined…”
- Title: first non-empty line truncated to ~80 chars, cleaned; or derived phrase “Starbucks drink tracker site idea” style only when short first line is a topic line.
- Do not rescue pure logistics (“buy milk”, “email landlord”).

**Test scenarios:**
- Starbucks-length website pitch as noise → atom with non-empty title.
- “buy milk” noise → stays noise.
- Already atom → unchanged.

**Verification:** rescue unit tests; no false promote on short chores.

---

### U4. SYSTEM_PROMPT + schema description alignment

**Goal:** Model emits better first-pass output.

**Requirements:** R1, R4, R5

**Files:**
- `src/classify.ts` — SYSTEM_PROMPT, schema reason/title descriptions
- `test/classify.test.ts` — contract string assertions

**Approach:** Update prompt sections for:
- Reason quality good/bad examples (session demo style)
- Title length preference
- Product/app ideas → atom
- Media: link work title only if it appears under Note titles; otherwise no work link
- Avoid inventing confident entity links from speech typos without vault title match

**Test scenarios:** Prompt contains new anchors (e.g. “reason must still teach”, “product idea”, “only if Note titles”).

**Verification:** classify.test contract tests updated and green.

---

### U5. Wire-up, demo seed, version 0.6.6

**Goal:** All classify/write/backfill paths get quality pass; ship demo + version.

**Requirements:** R7

**Files:**
- `src/classify.ts`, `src/write.ts`, `src/backfill.ts`, `src/preview.ts` (if they enrich outside classifyCapture — prefer single choke in classifyCapture + fixture path in write)
- `scripts/seed-demo-vault.mjs` — target-quality synthetic full mode
- `docs/media/demo-vault/**` — regenerated via seed or matched content
- `package.json`, `manifest.json`, `versions.json`
- `docs/architecture.md` — one-line note on media existing-title policy + reason rewrite

**Approach:**
- Fixture path in write must call same improve + media + people + idea rescue as live.
- seed:full produces hubs (Alex, People, App ideas), atoms with substantive reasons, dailies with markers, one rescued idea day.

**Verification:** `npm test` + `npm run build`; seed script runs without error; Settings version 0.6.6 after install.

## Verification Contract

1. `npm test` — all unit tests pass including new linkQuality / ideaRescue / media policy.
2. `npm run build` — typecheck + production bundle.
3. Optional: `node scripts/seed-demo-vault.mjs` then open `demo-vault` — backlinks on person hub show substantive reasons.
4. Dry-run on throwaway vault preferred before Remote Vault reprocess (out of scope to reprocess automatically).

## Definition of Done

- R1–R7 implemented and tested.
- Version 0.6.6.
- Plan units U1–U5 complete.
- PR opened with summary of quality bar vs prior dogfood failure modes.

## Assumptions

- No extra Anthropic round-trip for weak reasons (local rewrite only).
- Exact title `People` optional index link is enough for v1; no new hub discovery for indices.
- Personal names stay out of committed demo seed (synthetic only).

## Risks

| Risk | Mitigation |
|---|---|
| Idea rescue too aggressive | High-precision patterns + chore denylist tests |
| Media without work link feels incomplete | Title carries work name; tags remain |
| Reason rewrite still generic | Cue-based templates; tests for main dogfood shapes |
