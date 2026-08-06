---
title: Ask search_atoms agent signal - Plan
type: feat
date: 2026-08-06
topic: ask-search-atoms-agent-signal
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
lane: light
---

# Ask search_atoms agent signal - Plan

## Goal Capsule

**Objective.** Make Ask MCP `search_atoms` trustworthy for agent consumers: when nothing is a usable match, return a true empty with honest wording; when something is, label confidence so the agent knows what to `fetch_atom`.

**Product authority.** Continues the unmisreadable Ask contract (#150 shapes, #255/#259 absence, #256 `list_tags`). Does not reopen Ask D7 embeddings deferral or the CLAUDE.md embeddings non-goal.

**Open blockers.** None. Product Contract frozen. Before `ce-work`: hard claim (Issue + STATUS + draft PR). Floor bands pinned in KTD1–KTD3 below (fixture-calibrated in U1).

**Product Contract preservation.** Unchanged from post–doc-review requirements (R1–R15, AE1–AE8). Planning adds HOW only.

## Product Contract

### Summary

`search_atoms` today returns weak lexical coincidences with the same response shape as real hits. Agents cannot tell miss from match. This work fixes the **signal contract**: coverage-aware scoring, `confidence` labels, suppress weak hits by default, true empties that do not overclaim vault absence, light snippet cleanup, and dual-connector instructions. Embeddings, hybrid retrieval, and nested neighbors stay out.

### Problem Frame

`search_atoms` is consumed by Claude/ChatGPT agents, not humans skimming a results page. A human discards junk at a glance; an agent reasons about every row or burns another tool call.

Live dogfood (2026-08-06, ~73-note mirror) showed:

- Topic-absent queries still returned three atoms at score 24 (same score band as weak true hits).
- Establishing a real miss required a second tool (`list_tags`).
- Raw scores have no ceiling or cross-query meaning, so they cannot be thresholds.
- Snippets sometimes stutter (body/link-prose window, not a separate summary field).

Empty `results: []` already exists in the handler. The failure is **never reaching empty** when nothing is relevant, plus missing per-hit confidence when results do return.

### Key Decisions

- **KD1. Agent signal over ranking polish.** Primary outcome is an unambiguous “usable match exists?” answer. Better ordering among true hits is secondary. *(session-settled: user-approved — chosen over BM25-first and hybrid-first: false presence is the highest-impact failure)*
- **KD2. Suppress weak hits; empty is success.** Results below the usable bar are omitted. `results: []` is the correct response when nothing clears it — not an error. *(session-settled: user-approved — chosen over returning `confidence: low` rows: agents still reason about low rows)*
- **KD3. Labels, not normalized 0–1 scores.** Each returned hit carries `confidence: high | medium`. Labels are primary for agents. Raw numeric `score` is demoted (debug/compat only) or omitted from the agent-facing contract description so callers do not hardcode cutoffs. *(session-settled: user-approved — chosen over 0–1 normalization alone)*
- **KD4. Lexical only in this claim.** No embeddings, vector index, or hybrid RRF. Server hybrid remains a separate constitution/D7 reopen after this ships and dogfood still fails on vocabulary mismatch. *(session-settled: user-approved — chosen over bundling hybrid: carrying cost + constitution; floor still required under hybrid)*
- **KD5. Empty must not overclaim absence.** Empty means no confident **lexical** match **in this account’s mirror**, not “topic absent from the second brain / vault.” Vocabulary-miss atoms can still exist under different words. Wording must stay consistent with `scope_complete: false` honesty.
- **KD6. Structural confidence, not corpus-relative.** Labels derive from match kind (title/tag/phrase vs body coverage), not “top hit × fraction.” Meaning must hold across small and large mirrors.
- **KD7. Do not regress shipped honesty.** Keep non-authoritative snippets + `fetch_atom` as source of truth; revision `status` / `superseded_by` / `contradicted_by`; always-false `scope_complete` + `scope_note`.
- **KD8. Snippet polish is non-blocking light cleanup.** Word-boundary truncate; prefer capture body over link-prose region when structure is known. Not a new summary pipeline. Must not delay or expand the signal contract. `fetch_atom` reason stutter is deferred (separate amend), not optional scope in this claim.
- **KD9. Dual consumers.** Claude and ChatGPT MCP instructions/packs both document the new empty and confidence contract.

### Actors

- **A1. Coding agent (Claude / ChatGPT via Ask MCP)** — primary consumer; must decide fetch vs stop without extra disambiguation calls.
- **A2. Plus-service Ask mirror** — scores decrypted mirror rows; returns tool JSON.
- **A3. Human vault owner** — not a search UI user here; benefits indirectly when agents stop inventing context from junk hits.

### Key Flows

- F1. Confident hit
  - **Trigger:** Agent calls `search_atoms` with a query that matches title, tag, phrase, or strong body coverage.
  - **Outcome:** One or more results with `confidence: high|medium`, status fields intact; agent `fetch_atom`s before quoting.
  - **Covered by:** R1–R4, R10

- F2. True empty (no usable match)
  - **Trigger:** Query has no confident lexical match in the mirror (including today’s “score 24 coincidence” cases).
  - **Outcome:** `results: []` plus a short `hint` that states no confident match **in this mirror** and does not claim global vault absence; still includes `scope_complete: false` / scope note; distinct path when a tags filter was used (point at `list_tags` when appropriate).
  - **Covered by:** R5–R8, R11

- F3. Parent find before write/continue
  - **Trigger:** Agent searches for an existing atom to continue or link as parent.
  - **Outcome:** The correct parent still surfaces at medium+ when the query is a reasonable title/name/phrase for that atom. Floor must not force duplicate creates by hiding real parents.
  - **Covered by:** R9, AE4

- F4. Superseded best match
  - **Trigger:** Best match is `status: superseded` (or contradicted) with pointer fields.
  - **Outcome:** Hit still returns at its confidence with status + pointer; agent follows pointer rather than acting on stale body from snippet alone.
  - **Covered by:** R10, AE5

### Requirements

**Scoring and confidence**

- R1. Multi-word queries score by coverage of content words, not unbounded per-word body bonuses that let two incidental tokens look like a hit.
- R2. Proper nouns and distinctive tokens (person/place names) count as strong signal; they are not stripped as stopwords.
- R3. Every returned hit includes `confidence: high | medium` derived from match kind (e.g. exact/prefix title or exact tag → high; solid title contains or high body coverage → medium). Planning pins the exact bands against fixtures.
- R4. Hits that only clear a weak body/path coincidence band are **not returned** (suppressed). No `confidence: low` in the default response.

**Empty and honesty**

- R5. When nothing passes the usable bar, return `results: []` with the same account/mirror meta pattern as today.
- R6. Empty payload includes a short agent-facing `hint` (same field name as today’s empty path): no confident lexical match in this mirror_scope — confirm account via `mirror_status` if unexpected. It must not say the topic is absent from the user’s vault or second brain.
- R7. Tag-filtered empty remains distinct from plain empty: still steer to `list_tags` before concluding a tag is missing (preserve #256 behavior). Use `hint` (not a parallel `note` field).
- R8. Keep `scope_complete: false` and `scope_note` on both empty and non-empty responses.

**Safety rails**

- R9. Parent-find / continue lookup: fixtures prove a known parent title (and reasonable name/phrase variants) still returns medium+ so write path does not duplicate.
- R10. Superseded and contradicted atoms that clear the confidence bar still appear with `status` and pointer fields; floor does not drop them solely for revision status.
- R11. Tool description and MCP instructions (Claude + ChatGPT surfaces) teach: trust empty as “no confident match in mirror”; use `confidence` to decide fetch; never quote from snippets; never claim vault-wide absence from empty search.

**Snippets**

- R12. (Non-blocking.) Snippets truncate on a word boundary within the existing length budget; avoid obvious title/link-prose echo when the capture body region is identifiable. Signal contract (R1–R11, R14–R15) ships without waiting on R12.
- R13. Snippets remain non-authoritative (`authoritative: false` / truncated flags as today). `fetch_atom` stays source of truth for body claims.

**Eval and deploy**

- R14. Ship a fixed eval fixture set covering at least: true empty (topic absent), true high hit (title/tag), medium body hit, weak coincidence that must empty, parent-find title, superseded hit retained.
- R15. plus-service tests own the contract; Fly deploy is required for live MCP dogfood. Plugin version bump only if in-plugin Ask copy/instructions change; self-host doc updated if tool shape is documented there.

### Acceptance Examples

- AE1. Covers R1, R4, R5, R6  
  - **Given:** Mirror has only unrelated life notes (e.g. MRI job, Snapple).  
  - **When:** `search_atoms` query ≈ `retention hook loops YouTube Ross`.  
  - **Then:** `results: []`; `hint` does not claim vault absence; no score-24 junk rows.

- AE2. Covers R3, R11  
  - **Given:** Mirror contains a newsletter atom whose title/body clearly match.  
  - **When:** Query ≈ `newsletter use case Atoms app`.  
  - **Then:** Correct atom(s) return with `confidence` high or medium; weak coincidences (unrelated Nichita notes) are absent.

- AE3. Covers R7  
  - **Given:** Tag filter for a tag that does not exist (or exists with no match).  
  - **When:** `search_atoms` with `tags` yields empty.  
  - **Then:** Hint/note still points at `list_tags` before concluding tag absence (as today).

- AE4. Covers R9  
  - **Given:** Atom titled for a known continue parent exists in mirror.  
  - **When:** Agent searches with that title or a close name/phrase used in write flow.  
  - **Then:** Parent appears at medium+; not suppressed.

- AE5. Covers R10  
  - **Given:** Strong lexical match is `superseded` with `superseded_by`.  
  - **When:** Query matches that atom.  
  - **Then:** Result includes status + pointer at usable confidence.

- AE6. Covers R6, R8  
  - **Given:** Any empty or non-empty search.  
  - **When:** Agent reads the payload.  
  - **Then:** `scope_complete` is false; scope note present; empty `hint` never equates mirror miss with “not in vault.”

- AE7. Covers R3, R4, R14 (medium body-only)  
  - **Given:** One atom whose title/tags miss the query but body has strong multi-word coverage of distinctive content words.  
  - **When:** `search_atoms` with that body-shaped query.  
  - **Then:** That atom returns with `confidence: medium`; weak coincidence companions are absent.

- AE8. Covers R2, R9  
  - **Given:** Atom whose distinctive proper noun (person or place name) appears in title or body.  
  - **When:** Query is primarily that name (alone or with light context words).  
  - **Then:** Atom returns at medium+; name is not stripped as a stopword.

### Success Criteria

- An agent can treat empty as stop (no obligatory `list_tags` crutch for plain topic misses), while still not asserting vault-wide absence.
- True hits remain fetchable without drowning in coincidence rows.
- Parent-find and superseded honesty hold on the fixture set.
- Live dogfood on a real Plus mirror reproduces AE1/AE2 after Fly deploy.
- No regression on authoritative snippet contract or always-partial scope.
- **Accepted residual:** a synced atom can still miss a conceptual/synonym query (lexical-only). Empty then means no confident lexical match in mirror, not “topic absent from the second brain.” Hybrid/embeddings remain the path for that residual (out of this claim).

### Scope Boundaries

**In**

- plus-service `search_atoms` scoring, hit shape, empty `hint`, tool description, MCP instructions (both connectors as applicable)
- Eval fixtures + unit/integration tests
- Non-blocking snippet light cleanup (R12) if it fits the same PR without delaying signal work

**Deferred for later**

- Server embeddings / hybrid RRF / true FTS index rebuild
- Nested neighbors (or related titles) inside search hits
- Sharing classify BM25 implementation with Ask search
- Server-side LLM query expand or rerank
- Returning `confidence: low` rows behind a flag (unless planning finds a strong need)
- `fetch_atom` / neighbors link-reason stutter cleanup (separate amend)

**Outside this product’s identity (this claim)**

- Changing mirror allowlist or making `scope_complete` true
- Plugin-side local search UI
- On-device embeddings (already rejected for mobile/plugin)

### Dependencies / Assumptions

- Ask mirror already decrypts bodies for search (no new crypto path required for lexical work).
- `list_tags`, `mirror_status`, `fetch_atom`, revision status fields remain available; this work composes with them.
- D7 “no embeddings” and CLAUDE.md embeddings non-goal stay in force unless a future constitution PR reopens them.
- Hard claim required before code (Issue + STATUS.md + draft PR). Hot files are plus-service Ask helpers/tools/tests — no overlap with current STATUS claims (#307 www, #287 library, #320 sessions) as of plan write.

### Outstanding Questions

**Deferred to Planning** — resolved in Planning Contract (KTD1–KTD3, KTD6). Residual: self-host doc touch list (U4 grep).

**Deferred amend (not this claim):** `fetch_atom` / neighbors reason stutter.

**Resolve Before Planning**

- None.

### Sources / Research

- Live dogfood handoff (session 2026-08-06): false presence at score 24; agent consumer framing.
- `plus-service/src/store/askHelpers.mjs` — `scoreSearch`, `makeSnippet`, `buildSearchHits` (floor `s > 0` only).
- `plus-service/src/mcp/tools.mjs` — `search_atoms` handler + empty hints.
- `docs/plans/2026-07-27-001-feat-ask-brain-remote-mcp-plan.md` — D7 no embeddings; search v1 lexical.
- `docs/plans/2026-08-04-003-feat-ask-mcp-mirror-status-plan.md`, `docs/plans/2026-08-04-004-feat-ask-mcp-list-tags-plan.md` — absence and tag-empty honesty.
- Unmisreadable shapes lineage (#150) and MCP tool surface gaps handoff (`docs/handoffs/2026-08-04-mcp-tool-surface-gaps.md`).
- Classify retrieval research is analogy only: misses-are-absolute / no on-device embeddings (`docs/research/2026-07-29-retrieval-techniques.md`, `docs/research/2026-07-29-ondevice-and-providers.md`) — different path from Ask mirror search.

## Planning Contract

### Key Technical Decisions

- **KTD1. Content words + coverage gate (R1, R2).** Tokenize query on whitespace; lowercase. Drop only a small fixed stopword set (`a|an|the|and|or|of|to|in|on|for|with|is|are|was|were|be|been|it|this|that|at|as|by|from|into|about|than|then|so|if|or|not|no|do|does|did|can|could|should|would|will|just|very|also|too|my|your|our|their|me|you|we|they|i`). Keep all other tokens with length ≥ 2 (names like `ross` stay). Multi-word path: `coverage = matchedContentWords / contentWords` where a word matches if it appears in title, tags, or body. Do **not** award unbounded `hit * 12` for sparse body hits. Require `coverage ≥ 0.5` **or** (≥3 content words matched and ≥2 distinct fields among title/tags/body) before multi-word body contribution can alone qualify a hit. Single-token queries keep title/tag/phrase boosts as today.

- **KTD2. Confidence from match kind, not score bands (R3, R4, KD6).** Compute during scoring (not post-hoc from raw points):
  - **high:** exact title == query, or title starts with query, or exact tag == query, or full query phrase appears in title.
  - **medium:** title contains query as substring, or tag contains query, or (multi-word) coverage gate passes with at least one title or tag hit, or single-token body contains with existing body TF path, or multi-word coverage ≥ 0.67 on body alone with ≥2 content words of length ≥ 4.
  - **suppress (not returned):** everything else with score > 0 today (weak multi-word body/path only). No `confidence: low` in default payload.

- **KTD3. Keep numeric `score` for ranking only (KD3).** Hits still include `score` for stable sort (desc score, then title) among medium+/high. Tool description and instructions treat **`confidence` as primary**; never tell agents to threshold on score. Existing store tests that assert `score` ordering stay valid.

- **KTD4. Empty `hint` field name (R6, R7).** Reuse `hint` on empty search payloads (already used). Plain empty vs tags-filter empty keep distinct strings; both forbid vault-wide absence claims. Non-empty responses do not need a new top-level success note.

- **KTD5. Snippet polish non-blocking (R12).** Prefer capture-body region for snippet window when body has a blank-line split (reuse link-prose boundary concept from `askHelpers` link parsing: text before first blank line is capture-ish). Word-boundary truncate at max length. If either is awkward, ship signal without it.

- **KTD6. No schema/migration/plugin bump.** plus-service only unless self-host doc mentions search shape. Claude + ChatGPT both get `ASK_MCP_INSTRUCTIONS` from `instructions.mjs` (single surface). Fly deploy after merge for live dogfood.

- **KTD7. Test-first pure helpers.** New pure unit file for `scoreSearch` / confidence / `buildSearchHits` floor before wiring tools. Fixture cases map 1:1 to AE1–AE8.

### Approach

```
scoreSearch(doc, q) → { score, confidence: 'high'|'medium'|null }
  null confidence ⇒ buildSearchHits drops the row
buildSearchHits → hits with confidence + score + status + optional snippet
tools.mjs empty path → hint strings (KD5 honesty)
instructions.mjs → confidence + empty semantics
```

Follow existing pure-helper + store test patterns in `plus-service/test/store-ask.test.mjs` and `mcp-unmisreadable-shape.test.mjs`. Do not touch `src/pipeline/shortlist.ts` (BM25 classify).

### Assumptions

- Current multi-word `hit * 12` is the main source of score-24 junk; coverage gate kills AE1 without killing AE4/AE8.
- Proper nouns need no NER — stopword exclusion + len≥2 is enough for dogfood names.
- One shared `instructions.mjs` covers both connectors (no separate ChatGPT pack file required for this claim).

### Sequencing

U1 → U2 → U3 → U4 (U3 optional if timeboxed). U1 blocks all.

### Risks

| Risk | Mitigation |
|---|---|
| Floor too aggressive → parent-find miss | AE4 + AE8 fixtures; lower medium body threshold only if those fail |
| Floor too weak → junk remains | AE1 fixture must stay empty |
| Agents ignore confidence, still use score | Instructions + tool description demote score |
| Vocabulary-miss residual misread as product failure | Success criteria accepted residual; empty `hint` wording |

## Implementation Units

### U1. Pure scoring + confidence + floor fixtures

- **Goal.** `scoreSearch` returns usable confidence; weak multi-word junk scores suppress; AE1/2/4/5/7/8 expressible as pure unit tests.
- **Files:** `plus-service/src/store/askHelpers.mjs` (`scoreSearch`, possibly small helpers `contentWords`, `matchConfidence`); `plus-service/test/ask-search-signal.test.mjs` (new).
- **Approach.** Test-first. Export whatever pure helpers U2 needs. Preserve title-ranks-above-body behavior for true hits. Map fixtures:
  - AE1-shaped corpus + query → no medium+/high
  - AE2-shaped title/body hit → high or medium; junk companion suppressed
  - AE7 body-only strong coverage → medium
  - AE8 name query → medium+
  - AE4 title parent → medium+
  - AE5 superseded is status layer (U2) but score still medium+
- **Patterns:** `scoreSearch` today at `askHelpers.mjs:489-538`; floor at `buildSearchHits:778`.
- **Test scenarios:**
  1. Topic-absent multi-word query against MRI/Snapple-like docs → empty after floor
  2. Title exact / prefix → confidence high
  3. Exact tag match → high
  4. Newsletter-like title contains → medium or high; weak body-only coincidence docs out
  5. Body-only high coverage multi-word → medium
  6. Proper noun alone → medium+ on matching atom
  7. Two incidental stopword-stripped leftovers do not qualify
  8. Title still ranks above body-only when both qualify
- **Verification:** `cd plus-service && node --test test/ask-search-signal.test.mjs`
- **Traces:** R1–R4, R9, R14, AE1, AE2, AE4, AE7, AE8

### U2. `buildSearchHits` + tool empty `hint` + description

- **Goal.** Hits include `confidence`; suppress null; empty search `hint` honesty; tool description updated.
- **Files:** `plus-service/src/store/askHelpers.mjs` (`buildSearchHits`); `plus-service/src/mcp/tools.mjs` (`search_atoms`); `plus-service/test/mcp-unmisreadable-shape.test.mjs`; `plus-service/test/store-ask.test.mjs` (adjust if score-only assumptions break); `plus-service/test/mcp-list-tags.test.mjs` if empty-hint strings asserted.
- **Approach.** Drop rows with null confidence. Attach `confidence` on hit. Keep `score`. Empty handler: plain vs tags vs empty-mirror hints; plain empty says no confident lexical match in mirror_scope + mirror_status check; never vault absence. Description: confidence primary; snippets non-authoritative; empty is useful.
- **Test scenarios:**
  1. `buildSearchHits` AE1 empty results array
  2. Hit shape includes `confidence` high|medium
  3. Superseded strong match retains status + pointer (AE5)
  4. Tag-filter empty still mentions `list_tags` (AE3 / R7)
  5. Plain empty `hint` lacks “not in vault” / “does not exist” vault claims (AE6)
  6. `scope_complete: false` still present
  7. Existing title-ranks-above-body store test still green
- **Verification:** `cd plus-service && npm test`
- **Traces:** R5–R8, R10–R11, R15, AE3, AE5, AE6

### U3. MCP instructions + optional snippet polish

- **Goal.** Agents taught empty + confidence contract; optional R12 snippet cleanup.
- **Files:** `plus-service/src/mcp/instructions.mjs`; optionally `makeSnippet` in `askHelpers.mjs` + tests in `ask-search-signal.test.mjs`.
- **Approach.** Add bullets under Read rules: empty = no confident lexical match in mirror (not vault absence); prefer higher confidence when choosing fetch; do not invent from weak absence. Snippet: word boundary; prefer pre-blank-line region when identifiable — skip if non-trivial.
- **Test scenarios:**
  1. Instructions string contains confidence + empty-mirror wording (string includes test or doc-only if no harness)
  2. If snippet changes: truncate does not split mid-word; link-prose-heavy body prefers earlier window when query in capture region
- **Verification:** `cd plus-service && npm test`
- **Traces:** R11–R13, KD8/KTD5

### U4. Self-host / deploy notes (docs-only if needed)

- **Goal.** If `docs/ask-self-host.md` (or runbooks) describe search score semantics, align one paragraph. Record Fly deploy as shipping-tail step (not code).
- **Files:** touch only if grep finds score/search semantics; else skip unit.
- **Approach.** Grep first; minimal doc edit.
- **Test scenarios:** N/A docs
- **Verification:** human/agent Fly deploy + MCP dogfood AE1/AE2 after merge
- **Traces:** R15

## Verification Contract

```bash
cd plus-service && npm test
# focused while iterating:
cd plus-service && node --test test/ask-search-signal.test.mjs
```

No plugin `npm test` required unless instructions leak into plugin (they should not).

**Live (post-merge):** Fly deploy plus-service → Claude Ask connector → AE1 empty + AE2 hit dogfood on a real mirror. Evidence in PR or QA note.

**Execution direction:** test-first on pure scorer (U1) before tools wiring (U2).

## Definition of Done

- [ ] U1–U3 green under `plus-service` tests; U4 done or explicitly N/A
- [ ] AE1–AE8 covered by automated fixtures (or AE5/AE6 via shape tests)
- [ ] Tool description + instructions teach confidence + empty honesty
- [ ] No embeddings / no plugin version bump unless something user-visible in plugin changed (should not)
- [ ] Hard claim: Issue + STATUS row + draft PR with `Closes #N`
- [ ] After merge: Fly deploy + live AE1/AE2 note; clear STATUS
- [ ] Shipping tail: simplify → code-review → compound if learned → world-class-qa N/A UI (docs: N/A — no UI)

## Appendix

### Fixture seed sketches (implementer may refine titles)

| AE | Query | Corpus sketch | Expect |
|---|---|---|---|
| AE1 | `retention hook loops YouTube Ross` | MRI tech @ Clinton; Snapple preference | `[]` |
| AE2 | `newsletter use case Atoms app` | Newsletter idea atom + Snapple junk | newsletter medium+; junk out |
| AE7 | multi-word unique body phrase | body-only match atom | medium |
| AE8 | `Nichita` or place name | person atom | medium+ |
| AE4 | exact parent title | continue parent atom | medium+ |
| AE5 | match superseded title | parent + revises child | parent with status superseded |
