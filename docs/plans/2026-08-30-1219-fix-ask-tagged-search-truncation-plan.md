---
title: Ask tagged search must not hide tagged notes
type: fix
date: 2026-08-30
topic: ask-tagged-search-truncation
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
lane: light
origin: session handoff 2026-08-30 (John porch-neighbor miss)
issue: 609
---

# Ask tagged search must not hide tagged notes — Plan

**Lane:** light  
**Why:** WHAT is settled. The bug is a tagged `search_atoms` call that returned 5 of N `person` atoms because the query still had to clear the #331 floor. Two logic files plus instructions. No classify/auth widening.  
**Doc-review:** light (coherence + feasibility; product copy in MCP instructions).  
**Done when:** John-shaped fixture returns under `tags: ["person"]`; CRG-shaped tagged search still ranks query matches first; untagged floor unchanged; truncation fields on every search payload; plus-service tests green. Fly deploy after merge.

**Product Contract preservation.** Continues #331 floor + #339 honesty. Does not reopen embeddings (CLAUDE.md non-goal, Ask D7, #552 out of scope).

---

## Goal Capsule

Stop Ask from presenting a truncated tag-filtered search as a complete list. When a caller passes `tags`, every atom that carries those tags is eligible up to `limit`. Untagged search keeps the floor. Recency browse stays on `list_atoms`. Every search payload says how many rows the floor or the limit dropped.

## Problem Frame

Live Ask session, 139-note mirror. Correct atom: **"John is the porch neighbor who thought I was upstairs"** (`person`, created 2026-08-21, live). Body shares none of the query tokens `met` / `name` / `person`.

| Call | Query | Tags | Result |
|---|---|---|---|
| 1 | `met a guy recently introduction new person` | — | miss |
| 2 | `neighbor lives on my street met` | — | miss |
| 3 | `person met name` | `["person"]`, limit 25 | **5 hits, John absent** |
| 4 | `John` | — | hit, score 473, high |

Call 3 is this claim. `buildSearchHits` applies `matchesTagFilter` first, then `scoreSearch`. Null confidence or `score <= 0` drops the row. John's title/body have none of `met`/`name`/`person` as content words in a way that clears the multi-word coverage bar, so confidence is null. The five returned atoms all literally contain `met`.

The payload then said `returned: 5`, `limit: 25`, with `scope_note` about mirror partiality and **nothing about threshold truncation**. The host, under one-look, treated five as the full recent-contact list.

`list_atoms` already does tagged recency: `tags`, `sort_by: created`, `order: desc`. The host used `search_atoms` because stance leads with search.

Expand did not save it. Scoring already uses `expand` when the field is present. `retrieval` stays `lexical` until `expand_coverage >= 0.8` (`ASK_EXPAND_COVERAGE_FLOOR`). This session reported `0.424`, so the advertised mode never flipped. Even a fully expanded John row still misses calls 1–2 if the phrases share no tokens with "lives on my street."

Code anchors: `plus-service/src/store/askHelpers.mjs` (`scoreSearch`, `buildSearchHits`, `SEARCH_REL_FLOOR`), `plus-service/src/mcp/tools.mjs` (`search_atoms`), `plus-service/src/mcp/instructions.mjs`, `plus-service/src/ask/expandSearch.mjs` (`retrievalModeForCoverage`).

## Key Decisions

- **KTD1. Tags bypass the floor; they do not ignore the query.** When `tags` is non-empty, every atom that matches all requested tags is eligible up to `limit`. Rank by score desc, then `created` desc (nulls last, same as `list_atoms`). Do **not** switch tagged search to created-only and drop the query. `search_atoms(query: "CRG", tags: ["person"])` must still put CRG people first. *(recommended over the handoff's created-only browse: that would break tagged topical search)*
- **KTD2. Floor stays for untagged search.** Short or generic queries without `tags` do not get a bypass. Calls 1–2 remain the expand/paraphrase residual. No `confidence: low`. *(preserves #331 KD2)*
- **KTD3. Blank query + tags is browse; blank query without tags stays empty.** `scoreSearch` already returns null on a trimmed-empty query. With `tags`, that becomes created-desc members of the tag set. Without `tags`, do not dump the mirror.
- **KTD4. Tag-scope fills are labeled, not smuggled in as query hits.** Rows that would have been dropped by the floor and are kept only because of `tags` carry `match_signals: ["tag_scope"]` and `confidence: "medium"` (enum stays `high|medium`). Instructions: `tag_scope` means "in the requested tag set," not "this query matched." Fetch before quoting. *(chosen over a new `confidence: scoped` value: avoids widening the enum this claim)*
- **KTD5. Recency is `list_atoms`, not a new `search_atoms` sort.** Amend tool descriptions + instructions. "People I met recently" / "newest X" → `list_atoms(tags, sort_by: created, order: desc)`. Do not add `sort` to `search_atoms`.
- **KTD6. Truncation is a machine field on every search payload.** Empty and non-empty. Fields:
  - `omitted_below_threshold` — rows that had a tag match (or, untagged, any scored candidate) dropped by the absolute/relative floor
  - `omitted_by_limit` — eligible rows past `limit`
  - `tag_pool` — count matching all requested tags; `0` when `tags` absent
  - existing `returned` / `limit` stay
  When `tags` is set, `omitted_below_threshold` is `0` (floor not applied). Hint when `omitted_by_limit > 0`: more exist; page with `list_atoms`. Does not replace `scope_note`. Does not close #552 (three kinds of miss as a required object).
- **KTD7. One look still forbids a second `search_atoms`.** Carve `list_atoms` into the opener the same way `fetch_atom` / `list_tags` / `mirror_status` are carved today (`docs/solutions/logic-errors/an-opener-stop-rule-must-name-the-tool-it-stops.md`). A tagged search with `omitted_by_limit > 0` or a recency question may call `list_atoms` once. Do not restore "Do not keep calling tools."
- **KTD8. No plugin bump.** plus-service only. Fly deploy after merge for live MCP. No `create_atom` `where`/`context` field. No embeddings / hybrid. No People-hub special case in search (optional instruction mention only).

## Requirements

- **R1.** `search_atoms` with non-empty `tags` returns tagged atoms even when `scoreSearch` confidence is null, up to `limit`, ranked score then created.
- **R2.** Tagged topical search still ranks query matches above tag-scope fills (CRG + `person`).
- **R3.** Untagged search keeps absolute + relative floors. AE1-shaped junk still empties.
- **R4.** Blank query + tags → tag pool by created desc. Blank query, no tags → `results: []`.
- **R5.** Tag-scope fills include `match_signals` containing `tag_scope` and `confidence: "medium"`. Query matches keep their real confidence and existing signals; they do not gain `tag_scope`.
- **R6.** Every `search_atoms` JSON object includes `omitted_below_threshold`, `omitted_by_limit`, `tag_pool` (integer, `0` if no tags).
- **R7.** Tool description: tags = filter, not an extra query constraint that can hide members; weak query matches are omitted only when `tags` is absent; recency / "all people" → `list_atoms`.
- **R8.** Instructions: one look does not retry `search_atoms`; `list_atoms` is an allowed follow-up for recency, tag browse, and `omitted_by_limit > 0`. Never present `returned < tag_pool` as the complete set.
- **R9.** `list_atoms` description already covers tags + created sort; add a pointer from `search_atoms` toward it. No new list params.

## Acceptance Examples

- **AE-John.** Mirror has five `person` atoms whose body contains `met`, plus John (porch neighbor, `person`, no `met`/`name` in title/body, newest `created`). `search_atoms(query: "person met name", tags: ["person"], limit: 25)` returns John. `tag_pool` ≥ 6. `omitted_below_threshold` is 0. John has `tag_scope` in `match_signals`. The `met` atoms rank above him.

- **AE-CRG.** Same person pool. `search_atoms(query: "CRG", tags: ["person"])` ranks the climbing-gym people above John. John may still appear as a tag-scope fill if `limit` allows.

- **AE-untagged-floor.** AE1 corpus + untagged `retention hook loops YouTube Ross` still returns `[]`. `omitted_below_threshold` ≥ 0 (may be 0 if those rows never scored). No tag-scope rows.

- **AE-blank-browse.** `query: " "` + `tags: ["person"]` returns the person pool by created desc, John first among the John fixture. Same call without `tags` returns `[]`.

- **AE-limit.** 8 person atoms, `limit: 3`, tagged search: `returned: 3`, `tag_pool: 8`, `omitted_by_limit: 5`. Hint points at `list_atoms`.

- **AE-Alpha.** Existing store test: `query: "Alpha", tags: ["person"]` still returns only the person Alpha, not the decision Alpha.

## Implementation Units

### U1. `buildSearchHits` tagged eligibility + stats

**Goal.** Scoring helper owns the new contract.

**Files:** `plus-service/src/store/askHelpers.mjs`; `plus-service/test/ask-search-signal.test.mjs` (new cases; keep existing floor tests)

**Approach:**

1. Tag filter still ANDs.
2. If `tags` is non-empty, skip absolute skip (`!confidence || s <= 0`) and skip the relative floor. Keep the row. If confidence was null, set `confidence: "medium"`, `score: 0`, `match_signals: ["tag_scope"]`.
3. Sort: score desc, then created desc (reuse `createdSortKey`; nulls last), then title.
4. Return `{ hits, omitted_below_threshold, omitted_by_limit, tag_pool }` instead of a bare array. Count `tag_pool` before scoring. `omitted_below_threshold` is the number of tagged (or, untagged, scored) rows dropped by the floor **before** the limit slice. `omitted_by_limit` is eligible length minus `hits.length`.
5. Untagged path: identical floors to today. Stats still populated (`tag_pool: 0`).

**Test scenarios:** AE-John, AE-CRG, AE-untagged-floor, AE-blank-browse, AE-limit, AE-Alpha; relative floor still drops the weak tail on untagged multi-hit corpora; expandStrong still exempt from relative floor when untagged.

**Execution note:** Test-first on `buildSearchHits` with the John fixture before changing the MCP handler.

### U2. Store + MCP payload + instructions

**Goal.** Callers see stats; hosts stop treating a truncated tag search as complete.

**Files:**
- `plus-service/src/store/memory.mjs`
- `plus-service/src/store/askSqliteMethods.mjs`
- `plus-service/src/store/askPostgresMethods.mjs`
- `plus-service/src/mcp/tools.mjs`
- `plus-service/src/mcp/instructions.mjs`
- `plus-service/test/store-ask.test.mjs`
- `plus-service/test/http-ask-mcp.test.mjs`
- `plus-service/test/mcp-unmisreadable-shape.test.mjs`
- `plus-service/test/mcp-ask-write.test.mjs` (instruction locks)
- `plus-service/test/ask-search-expand.test.mjs` if it asserts a bare hits array

**Approach:**

1. `mirrorSearch` returns the U1 object. Update the handful of `.length` callers to `.hits`.
2. `search_atoms` handler reads `hits` + stats onto both empty and non-empty JSON. Empty tagged search with a populated `tag_pool` should not happen under R1 unless the tag is absent (`tag_pool: 0`); keep the `list_tags` empty hint for that case.
3. Tool description: tags filter the pool; floor applies only when `tags` is omitted; "all / newest / recently" → `list_atoms`.
4. Opener: `Do not retry search_atoms. fetch_atom, list_tags, list_atoms, and mirror_status still apply.` Assert the unscoped "Do not keep calling tools" stays absent. Read-rules bullet: do not present `returned` as the full tag set when `omitted_by_limit > 0` or `tag_pool > returned`. Recency bullet already names `list_atoms`; add that a tagged `search_atoms` is the wrong tool for "all people."

**Test scenarios:** in-process MCP JSON includes the three stats fields on empty and non-empty; instruction regex locks `list_atoms` in the opener and `tag_scope` / `omitted_by_limit`; store tag-filter test still passes via `.hits`.

### U3. Compound learning

**Goal.** Next session inherits why a non-empty tagged search can still be a lie.

**Files:** `docs/solutions/features/` (new row, sibling of `ask-search-silent-empty-and-index-expand.md`)

**Approach.** Dual of #331: floor + tagged filter without a truncation field produced **false completeness**, not false presence. Tags are a browse scope. Recency already lives on `list_atoms`.

## Out of scope

- Embeddings / hybrid / lowering `ASK_EXPAND_COVERAGE_FLOOR` (investigate as a follow-up; this session's `0.424` explains why `lexical_expanded` never advertised)
- `search_atoms` `sort` param
- `create_atom` encounter/`where`/`context` field
- People hub as a special retrieval path
- Closing #552 (typed miss object). Truncation fields are a step, not that card
- Plugin version, disclosures, ack bump

## Risks

- **Tag-scope medium looks like a query hit.** Mitigation: `tag_scope` signal + instruction line + tests that John is `tag_scope` and CRG matches are not.
- **Large tag pools.** `person` on a 139-note mirror is fine at limit 25; a future 2k-note mirror still truncates. `omitted_by_limit` + `list_atoms` paging is the answer, not raising max limit.
- **Store return-shape blast.** `mirrorSearch` today returns an array. Three store files + ~5 tests. Unwrap at those sites in the same unit as the helper change.

## Related

- `docs/solutions/features/ask-search-silent-empty-and-index-expand.md` — floor + honest empty; this is the non-empty dual
- `docs/solutions/logic-errors/an-opener-stop-rule-must-name-the-tool-it-stops.md` — carve `list_atoms` the same way
- `docs/plans/2026-08-06-002-feat-ask-search-atoms-agent-signal-plan.md` (#331)
- `docs/plans/2026-08-06-004-feat-ask-search-recall-and-agent-honesty-plan.md` (#339)
- `docs/plans/2026-08-04-005-feat-ask-mcp-created-and-list-pending-plan.md` — `list_atoms` already sorts by created
- #552 — related honesty work; do not swallow it

## Done when

- [ ] U1 John fixture green; untagged AE1 still empty
- [ ] U2 MCP stats + instruction locks green
- [ ] `cd plus-service && npm test` green
- [ ] Hard claim (Issue + STATUS + draft PR) before code; PR `Closes #<n>`
- [ ] Light doc-review on this plan before `ce-work`
- [ ] After merge: Fly deploy (MCP contract is server-side)

## Open for the owner (non-blocking if the KTDs above stand)

1. Accept KTD1 (keep query ranking under tags) vs the handoff's created-only tagged browse.
2. Claim + implement on a new branch from `master` (`fix/ask-tagged-search-truncation`). Do not land this on `feat/watchlist-hub-membership`.
